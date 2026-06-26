import AppKit
import Foundation
import UserNotifications

// Меню-бар приложение. Авто-предложение записи с СОГЛАСИЕМ из двух источников:
//   • Календарь (Google, через сервер meeting-current) — с упреждением «встреча через N мин».
//   • Микрофон (CoreAudio) — запасной детект звонка, если встречи нет в календаре.
// Запись стартует только по явному действию пользователя, никогда молча.
// Идентичность/дедуп: календарное событие → комната из URL браузера → manual.
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem!
    private let recorder = AudioRecorder()
    private let widget = RecorderWidget()

    private var config: SwarmConfig?
    private var configError: String?
    // Типизированные сбои вместо общего .error(String): каждый даёт точный текст «куда идти»
    // в System Settings + кнопку «Повторить». .error(String) остаётся только для по-настоящему
    // непредвиденного (не классифицировали) — чтобы не прятать причину.
    //   • noScreenRecording — нет «Screen Recording» (<14.4, путь ScreenCaptureKit);
    //   • noSystemAudio     — нет «System Audio Recording» (14.4+, Core Audio process-tap);
    //   • noMic             — отказан доступ к микрофону;
    //   • offline           — сеть недоступна (claim/upload не прошли по транспорту);
    //   • tokenExpired      — HTTP 401, токен протух/отозван (ведём в бот /recordertoken).
    private enum State {
        case idle, recording, sending
        case noScreenRecording, noSystemAudio, noMic, offline, tokenExpired
        case error(String)
    }
    private var state: State = .idle
    // Последнее действие записи — чтобы «Повторить» после сбоя разрешений повторило именно его
    // (встреча из календаря / звонок / ручной старт), а не угадывало контекст заново.
    private var lastRecordIdentity: MeetingIdentity.Info?
    private var sysURL: URL?
    private var micURL: URL?
    private var recordStartedAt: Date?
    private var identity: MeetingIdentity.Info?
    // Сколько записей ждёт дозагрузки (UploadQueue) — показываем «N в очереди» в меню.
    private var queuedCount = 0

    // Календарное предложение.
    private var pendingMeeting: MeetingIdentity.Info?
    private var dismissedKeys: Set<String> = []   // «не записывать» / уже записали
    private var notifiedKeys: Set<String> = []     // по каким уже слали уведомление
    // Микрофонный запасной детект.
    private var callActive = false
    private var micWasActive = false
    private var callDismissedUntil: Date?
    private var watchTimer: Timer?
    private var maintTimer: Timer?
    // Авто-стоп по концу звонка (per-process детект во время записи).
    private var recWatchTimer: Timer?
    private var callSeenDuringRec = false
    private var silentTicks = 0
    // Тики подряд с «тихой» СИСТЕМНОЙ дорожкой (собеседники молчат). Считается независимо от
    // mic-детекта: ловит конец БРАУЗЕРНОГО звонка (Google Meet / Контур.Толк во вкладке), где
    // браузер держит микрофон непрерывно даже после выхода → realCall никогда не гаснет.
    private var systemSilentTicks = 0
    // Порог «тишины» системной дорожки 0…1: ниже него считаем, что собеседников не слышно.
    private static let systemSilenceLevel: Float = 0.02
    // Сколько тихих тиков (5с каждый) системной дорожки = конец звонка. 36 ≈ 3 мин непрерывной
    // тишины — в живом созвоне такое почти не встречается; компромисс ради фикса runaway-записей.
    private static let systemSilenceTicksToStop = 36
    // Дефолтный стоп: если активный созвон не детектится, запись не идёт дольше этого лимита.
    // Бэкстоп от runaway-записи (когда детект созвона молчит — напр. ручной старт без звонка).
    private static let maxNoCallSeconds: TimeInterval = 75 * 60   // 1ч15м

    private let notifyCategory = "MEETING_START"
    private let recordAction = "RECORD"

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { config = try SwarmConfig.load() }
        catch { configError = "нужен токен — вставь через меню" }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        rebuildMenu()
        // НЕ дёргаем ensureScreenRecording() на старте: системный промпт показывается один раз
        // за процесс, и если «съесть» его молча здесь — по клику «Записать» он уже не появится.
        // Микрофон спросить заранее безопасно (отдельный промпт).
        Task { _ = await Permissions.requestMicrophone() }

        widget.onStop = { [weak self] in self?.stopTapped() }
        widget.onRecord = { [weak self] in self?.widgetRecord() }
        widget.onDismiss = { [weak self] in self?.widgetDismiss() }
        // Живой уровень входа для полосы в виджете — читаем текущий уровень микрофона.
        widget.levelProvider = { [weak self] in self?.recorder.currentMicLevel() ?? 0 }
        // Вторая полоса — уровень системной дорожки (собеседники/коллеги), видно живой захват.
        widget.systemLevelProvider = { [weak self] in self?.recorder.currentSystemLevel() ?? 0 }

        setupNotifications()
        startWatching()

        // Дозагрузка на старте: если в прошлый раз приложение закрыли/упало с висящими записями
        // в pending/, заливаем их сейчас (meetingId переиспользуется, claim не повторяем).
        if let cfg = config, configError == nil {
            Task { await UploadQueue.shared.drain(config: cfg); await refreshQueueBadge() }
        }
    }

    // ── Авто-детект (календарь + микрофон) ───────────────────────────────────────
    private func setupNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let record = UNNotificationAction(identifier: recordAction, title: "Записать", options: [.foreground])
        let cat = UNNotificationCategory(identifier: notifyCategory, actions: [record], intentIdentifiers: [], options: [])
        center.setNotificationCategories([cat])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func startWatching() {
        let t = Timer.scheduledTimer(timeInterval: 25, target: self, selector: #selector(watchTick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        watchTimer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.watchTick() }

        // Периодическое обслуживание бэкапов (раз в 15 мин): дозагрузка, опрос статуса (удаление на done),
        // 24ч-потолок. Нужно для долгоживущего меню-бара — иначе бэкапы чистятся только при старте/записи.
        let maint = Timer.scheduledTimer(timeInterval: 900, target: self, selector: #selector(maintenanceTick), userInfo: nil, repeats: true)
        RunLoop.main.add(maint, forMode: .common)
        maintTimer = maint
    }

    @objc private func maintenanceTick() {
        guard let cfg = config, configError == nil else { return }
        Task { await UploadQueue.shared.drain(config: cfg); await refreshQueueBadge() }
    }

    @objc private func watchTick() {
        guard let cfg = config, configError == nil else { return }
        Task {
            let meeting = (try? await SwarmClient(config: cfg).currentMeeting()) ?? nil
            // Реальный созвон, а не просто занятый микрофон: фильтруем системные демоны
            // (CoreSpeech), иначе «звонок» виден всегда и сыпались бы ложные предложения записи.
            let micOn = CallDetector.realCallActive()
            DispatchQueue.main.async { [weak self] in self?.handleDetection(meeting: meeting, micActive: micOn) }
        }
    }

    private func handleDetection(meeting: MeetingIdentity.Info?, micActive: Bool) {
        let wasActive = micWasActive
        micWasActive = micActive
        guard case .idle = state else { return }

        // Календарь — приоритет (богаче: название, участники, упреждение).
        if let m = meeting, !dismissedKeys.contains(m.key) {
            callActive = false
            if pendingMeeting?.key != m.key {
                pendingMeeting = m
                if !notifiedKeys.contains(m.key) { notifiedKeys.insert(m.key); notifyMeeting(m) }
                rebuildMenu()
            }
            return
        }
        if pendingMeeting != nil { pendingMeeting = nil; rebuildMenu() }

        // Нет события календаря → запасной детект звонка по микрофону.
        if micActive && !wasActive {
            if let until = callDismissedUntil, Date() < until { return }
            if !callActive { callActive = true; postCallNotification(); rebuildMenu() }
        } else if !micActive, callActive {
            callActive = false
            rebuildMenu()
        }
    }

    private func meetingWhen(_ m: MeetingIdentity.Info) -> String {
        guard let iso = m.startISO, let start = ISO8601DateFormatter().date(from: iso) else { return "идёт" }
        let mins = Int(start.timeIntervalSinceNow / 60)
        return mins <= 0 ? "идёт" : "через \(mins) мин"
    }

    private func notifyMeeting(_ m: MeetingIdentity.Info) {
        let content = UNMutableNotificationContent()
        content.title = "Встреча \(meetingWhen(m))"
        content.body = "«\(m.title ?? "Без названия")» — записать?"
        content.categoryIdentifier = notifyCategory
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "meeting-\(m.key)", content: content, trigger: nil))
    }

    private func postCallNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Идёт звонок"
        content.body = "Записать встречу?"
        content.categoryIdentifier = notifyCategory
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "call-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil))
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == recordAction || response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            DispatchQueue.main.async { [weak self] in self?.acceptPrompt() }
        }
        completionHandler()
    }

    // ── UI ──────────────────────────────────────────────────────────────────────
    private var isRecording: Bool { if case .recording = state { return true }; return false }

    // Сетевой/транспортный сбой → состояние .offline (а не общая ошибка): URLError (нет связи,
    // таймаут) или SwarmError.transport (мы не дошли до HTTP-ответа).
    private func isOfflineError(_ error: Error) -> Bool {
        if error is URLError { return true }
        if case SwarmError.transport = error { return true }
        return false
    }

    // Состояния с собственным UI «путь в Settings/сеть + Повторить» (отдельно от idle/recording).
    private func isPermissionOrOfflineError(_ s: State) -> Bool {
        switch s {
        case .noScreenRecording, .noSystemAudio, .noMic, .offline, .error:
            return true
        default:
            return false
        }
    }

    private func statusText() -> String {
        if let e = configError { return "⚠️ \(e)" }
        switch state {
        case .idle:
            if let m = pendingMeeting { return "Встреча \(meetingWhen(m)): «\(m.title ?? "")»" }
            if callActive { return "Идёт звонок" }
            if queuedCount > 0 { return "Готов · \(queuedCount) в очереди" }
            return "Готов"
        case .recording: return "● Идёт запись"
        case .sending: return "Отправка…"
        case .noScreenRecording: return "🔴 Нет доступа «Screen Recording»"
        case .noSystemAudio: return "🔴 Нет доступа «System Audio Recording»"
        case .noMic: return "🔴 Нет доступа к микрофону"
        case .offline: return "🔴 Нет сети — повтори, когда появится"
        case .error(let m): return "Ошибка: \(m)"
        case .tokenExpired: return "🔴 Токен истёк/недействителен"
        }
    }

    // Текст «куда идти» в System Settings для каждого типа сбоя разрешений (для пункта меню).
    private func settingsHint(for s: State) -> String? {
        switch s {
        case .noScreenRecording, .noSystemAudio:
            return Permissions.captureSettingsPath
        case .noMic:
            return "System Settings → Privacy & Security → Microphone → включить SwarmRecorder"
        default:
            return nil
        }
    }

    private func rebuildMenu() {
        if let button = statusItem.button {
            button.image = RoyArt.menuBarImage(recording: isRecording)
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: statusText(), action: nil, keyEquivalent: ""))
        menu.addItem(.separator())

        // 401: токен протух — показываем явный путь «Получить новый токен» (ведёт в бот к
        // /recordertoken) + обычную вставку из буфера. Запись недоступна, пока токен невалиден.
        if case .tokenExpired = state {
            menu.addItem(NSMenuItem(title: "Получить новый токен", action: #selector(getNewTokenTapped), keyEquivalent: ""))
            menu.addItem(NSMenuItem(title: "Обновить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
            if queuedCount > 0 {
                menu.addItem(NSMenuItem(title: "⏳ \(queuedCount) в очереди (дозагрузим после токена)", action: nil, keyEquivalent: ""))
            }
        } else if isPermissionOrOfflineError(state) {
            // Типизированный сбой разрешений/сети: точный путь в Settings + «Повторить».
            if let hint = settingsHint(for: state) {
                let item = NSMenuItem(title: hint, action: nil, keyEquivalent: "")
                item.isEnabled = false
                menu.addItem(item)
            }
            switch state {
            case .noMic:
                menu.addItem(NSMenuItem(title: "Открыть настройки микрофона", action: #selector(openMicSettingsTapped), keyEquivalent: ""))
            case .noScreenRecording, .noSystemAudio:
                menu.addItem(NSMenuItem(title: "Открыть настройки записи", action: #selector(openRecordingSettingsTapped), keyEquivalent: ""))
            default:
                break
            }
            menu.addItem(NSMenuItem(title: "Повторить", action: #selector(retryTapped), keyEquivalent: "r"))
            if queuedCount > 0 {
                menu.addItem(NSMenuItem(title: "⏳ \(queuedCount) в очереди", action: #selector(drainQueueTapped), keyEquivalent: ""))
            }
        } else if configError == nil {
            switch state {
            case .recording:
                menu.addItem(NSMenuItem(title: "Остановить и отправить", action: #selector(stopTapped), keyEquivalent: "s"))
            case .sending:
                break
            default:
                if pendingMeeting != nil {
                    menu.addItem(NSMenuItem(title: "🔴 Записать встречу", action: #selector(recordMeetingTapped), keyEquivalent: "r"))
                    menu.addItem(NSMenuItem(title: "Не записывать", action: #selector(dismissMeetingTapped), keyEquivalent: ""))
                } else if callActive {
                    menu.addItem(NSMenuItem(title: "🔴 Записать звонок", action: #selector(recordCallTapped), keyEquivalent: "r"))
                    menu.addItem(NSMenuItem(title: "Не сейчас", action: #selector(dismissCallTapped), keyEquivalent: ""))
                } else {
                    menu.addItem(NSMenuItem(title: "Записать встречу", action: #selector(recordTapped), keyEquivalent: "r"))
                }
            }
            // Висящие дозагрузки видно всегда (даже во время записи): «N в очереди».
            if queuedCount > 0 {
                menu.addItem(NSMenuItem(title: "⏳ \(queuedCount) в очереди", action: #selector(drainQueueTapped), keyEquivalent: ""))
            }
            if let web = config?.webBaseURL, !web.isEmpty {
                menu.addItem(NSMenuItem(title: "Открыть Рой", action: #selector(openWeb), keyEquivalent: ""))
            }
            // Доступно всегда: перевставить токен (напр. если протух → 401). Раньше пункт
            // показывался только при отсутствии токена, и перевставить было неоткуда.
            menu.addItem(NSMenuItem(title: "Обновить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
        } else {
            menu.addItem(NSMenuItem(title: "Вставить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
        }
        // Бэкстоп: macOS-разрешение на запись системного звука можно открыть вручную в любой
        // момент (Core Audio process-tap при отказе иногда даёт тишину без ошибки → catch не сработает).
        menu.addItem(NSMenuItem(title: "Открыть настройки записи", action: #selector(openRecordingSettingsTapped), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Выйти", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        for item in menu.items where item.action != nil && item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
        statusItem.menu = menu
        syncWidget()
    }

    // Плавающий виджет следует за состоянием.
    private func syncWidget() {
        if configError != nil { widget.hide(); return }
        switch state {
        case .recording:
            widget.showRecording(startedAt: recordStartedAt ?? Date())
        case .idle:
            if let m = pendingMeeting {
                widget.showPending(title: m.title ?? "Встреча", when: meetingWhen(m))
            } else if callActive {
                widget.showPending(title: "Идёт звонок", when: "")
            } else {
                widget.hide()
            }
        case .sending, .error, .tokenExpired,
             .noScreenRecording, .noSystemAudio, .noMic, .offline:
            widget.hide()
        }
    }

    // Кнопка «Записать» в виджете — маршрутизируем по текущему контексту.
    @objc private func widgetRecord() {
        if pendingMeeting != nil { recordMeetingTapped() }
        else if callActive { recordCallTapped() }
        else { recordTapped() }
    }

    @objc private func widgetDismiss() {
        if pendingMeeting != nil { dismissMeetingTapped() }
        else if callActive { dismissCallTapped() }
    }

    private func setState(_ s: State) {
        state = s
        DispatchQueue.main.async { self.rebuildMenu() }
    }

    @objc private func openRecordingSettingsTapped() {
        Permissions.openScreenRecordingSettings()
    }

    @objc private func openMicSettingsTapped() {
        Permissions.openMicrophoneSettings()
    }

    // «Повторить» после типизированного сбоя: сбрасываем состояние и повторяем последнее
    // действие записи (тот же контекст: встреча/звонок/ручной старт). Сеть/разрешения к этому
    // моменту пользователь уже мог поправить через пункты выше.
    @objc private func retryTapped() {
        let id = lastRecordIdentity
        state = .idle
        rebuildMenu()
        beginRecording(identity: id)
    }

    @objc private func openWeb() {
        guard let web = config?.webBaseURL, let url = URL(string: web) else { return }
        NSWorkspace.shared.open(url)
    }

    // 401: подсказать получить новый токен из бота (команда /recordertoken), затем вставить.
    // Бот — Telegram, прямой deep-link в конфиге не хранится; ведём текстом к команде.
    @objc private func getNewTokenTapped() {
        let a = NSAlert()
        a.messageText = "Нужен новый токен"
        a.informativeText = "Токен истёк или отозван. Открой бота Swarm Brain в Telegram, набери /recordertoken, скопируй выданный smcp_-токен и нажми «Обновить токен из буфера»."
        a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    // Ручной запуск дозагрузки очереди (пункт «N в очереди»).
    @objc private func drainQueueTapped() {
        guard let cfg = config else { return }
        Task {
            await UploadQueue.shared.drain(config: cfg)
            await refreshQueueBadge()
        }
    }

    @objc private func pasteTokenTapped() {
        func info(_ title: String, _ text: String = "") {
            let a = NSAlert(); a.messageText = title; a.informativeText = text
            NSApp.activate(ignoringOtherApps: true); a.runModal()
        }
        let clip = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !clip.isEmpty else {
            info("Буфер пуст", "Скопируй токен из бота: /mytoken (тапни по smcp_-блоку — скопируется целиком).")
            return
        }
        guard clip.hasPrefix("smcp_"), clip.count >= 12 else {
            info("Это не похоже на токен", "В буфере: «\(clip.prefix(24))…». Нужен токен из /mytoken — начинается с smcp_.")
            return
        }
        do {
            try SwarmConfig.saveToken(clip)
            config = try SwarmConfig.load()
            configError = nil
            state = .idle
            rebuildMenu()
            info("Токен сохранён ✅", "smcp_…\(clip.suffix(4))")
            // Свежий токен → пробуем дозалить всё, что копилось при протухшем (включая 401-висяки).
            if let cfg = config {
                Task { await UploadQueue.shared.drain(config: cfg); await refreshQueueBadge() }
            }
        } catch {
            setState(.error("не сохранить токен: \(error)"))
        }
    }

    // ── Запись ───────────────────────────────────────────────────────────────────
    @objc private func recordTapped() {
        beginRecording(identity: MeetingIdentity.currentRoom())
    }
    @objc private func recordMeetingTapped() { acceptPrompt() }
    @objc private func recordCallTapped() { acceptPrompt() }

    private func acceptPrompt() {
        if let m = pendingMeeting {
            pendingMeeting = nil
            beginRecording(identity: m)
        } else {
            callActive = false
            beginRecording(identity: MeetingIdentity.currentRoom())
        }
    }

    @objc private func dismissMeetingTapped() {
        if let m = pendingMeeting { dismissedKeys.insert(m.key) }
        pendingMeeting = nil
        rebuildMenu()
    }
    @objc private func dismissCallTapped() {
        callDismissedUntil = Date().addingTimeInterval(10 * 60)
        callActive = false
        rebuildMenu()
    }

    private func beginRecording(identity id: MeetingIdentity.Info?) {
        guard config != nil else { return }
        if case .recording = state { return }
        // Запоминаем контекст для «Повторить» (встреча/звонок/manual).
        lastRecordIdentity = id
        // macOS 14.4+: системный звук через Core Audio process-tap — нужно «System Audio
        // Recording», НЕ «запись экрана»; TCC-промпт всплывёт сам при старте тапа.
        // Ниже 14.4 — старый путь ScreenCaptureKit, требует «запись экрана».
        if #available(macOS 14.4, *) {
            // ничего не гейтим — промпт системного звука покажется при старте
        } else if !Permissions.ensureScreenRecording() {
            setState(.noScreenRecording)
            Permissions.openScreenRecordingSettings()
            return
        }
        pendingMeeting = nil
        callActive = false
        let startedAt = Date()
        let base = UUID().uuidString
        let sys = FileManager.default.temporaryDirectory.appendingPathComponent("swarm-\(base)-sys.m4a")
        let mic = FileManager.default.temporaryDirectory.appendingPathComponent("swarm-\(base)-mic.m4a")
        Task {
            do {
                try await recorder.start(systemURL: sys, micURL: mic)
                sysURL = sys; micURL = mic
                recordStartedAt = startedAt
                identity = id
                setState(.recording)
                startCallEndWatch()
            } catch {
                // Сбой старта захвата системного звука = нет нужного TCC-разрешения. На 14.4+ это
                // «System Audio Recording», ниже — «Screen Recording»; ведём пользователя точно туда.
                setState(Permissions.usesSystemAudioCapture ? .noSystemAudio : .noScreenRecording)
                Permissions.openScreenRecordingSettings()
            }
        }
    }

    // ── Авто-стоп по концу звонка ────────────────────────────────────────────────
    // Во время записи раз в 5с смотрим, держит ли вход ДРУГОЕ приложение (CallDetector,
    // исключая нас). Как только конференц-приложение отпустило микрофон на ~15с подряд —
    // звонок завершён → останавливаем запись. Ловит и ранний конец (как Granola).
    private func startCallEndWatch() {
        callSeenDuringRec = false
        silentTicks = 0
        systemSilentTicks = 0
        recWatchTimer?.invalidate()
        let t = Timer.scheduledTimer(timeInterval: 5, target: self, selector: #selector(recWatchTick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        recWatchTimer = t
    }

    private func stopCallEndWatch() {
        recWatchTimer?.invalidate()
        recWatchTimer = nil
    }

    @objc private func recWatchTick() {
        guard case .recording = state else { stopCallEndWatch(); return }
        let elapsed = Date().timeIntervalSince(recordStartedAt ?? Date())

        // Уровень СИСТЕМНОЙ дорожки (собеседники). Считаем тихие тики ВСЕГДА, независимо от
        // mic-детекта: при браузерном звонке браузер держит мик непрерывно, и mic-правило ниже
        // не сработает — поэтому тишина системной дорожки тут единственный надёжный сигнал конца.
        let systemLevel = recorder.currentSystemLevel()
        if systemLevel < Self.systemSilenceLevel { systemSilentTicks += 1 } else { systemSilentTicks = 0 }

        // Реальный созвон = кто-то, КРОМЕ нас и системных демонов (CoreSpeech), держит мик.
        // На macOS <14 per-process детекта нет → realCall всегда false, работает только лимит ниже.
        var realCall = false
        if #available(macOS 14.0, *) {
            let info = CallDetector.othersUsingMicInfo()
            realCall = !info.isEmpty
            dbg("tick others=\(info.map { "\($0.pid):\($0.bundle)" }) seen=\(callSeenDuringRec) silent=\(silentTicks) sysLevel=\(String(format: "%.3f", systemLevel)) sysSilent=\(systemSilentTicks) elapsed=\(Int(elapsed))s")
        }

        // (0) Конец БРАУЗЕРНОГО звонка по тишине системной дорожки. Срабатывает ДАЖЕ когда
        // mic-холдер (браузер) всё ещё держит мик — НЕ гейтим на realCall==false. Требуем, чтобы
        // звонок хоть раз был замечен (callSeenDuringRec), чтобы не стопать «пустой» ручной старт.
        if callSeenDuringRec && systemSilentTicks >= Self.systemSilenceTicksToStop {
            autoStop(reason: "звонок завершён (тишина)")
            return
        }

        if realCall {
            callSeenDuringRec = true
            silentTicks = 0
            return
        }

        // Реального созвона сейчас нет — копим «тихие» тики (5с каждый).
        silentTicks += 1
        // (а) Созвон был и смолк ~15с → закончился → стоп.
        if callSeenDuringRec && silentTicks >= 3 {
            autoStop(reason: "звонок завершён")
            return
        }
        // (б) Дефолтный стоп: за 1ч15м активный созвон так и не детектился (или давно смолк) →
        // запись не должна тянуться дальше. Защита от runaway, когда детект молчит.
        if elapsed >= Self.maxNoCallSeconds && silentTicks >= 3 {
            autoStop(reason: "лимит 1ч15м без активного созвона")
            return
        }
    }

    // Единая остановка по авто-детекту: лог + уведомление + штатный стоп/отправка.
    private func autoStop(reason: String) {
        dbg("AUTO-STOP: \(reason)")
        stopCallEndWatch()
        postCallEndedNotification(body: "\(reason) — сохраняю встречу.")
        stopTapped()
    }

    // Диагностика в файл (читается снаружи) — временно, для отладки авто-стопа.
    private func dbg(_ s: String) {
        let line = "\(Date()) \(s)\n"
        let url = URL(fileURLWithPath: "/tmp/swarm-calldetect.log")
        guard let data = line.data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(data); try? h.close()
        } else {
            try? data.write(to: url)
        }
    }

    private func postCallEndedNotification(body: String = "Звонок завершён — сохраняю встречу.") {
        let content = UNMutableNotificationContent()
        content.title = "Запись остановлена"
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "callend-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil))
    }

    @objc private func stopTapped() {
        guard let cfg = config else { return }
        stopCallEndWatch()
        setState(.sending)
        let info = identity
        Task {
            do {
                let res = try await recorder.stop()
                let client = SwarmClient(config: cfg)
                let iso = ISO8601DateFormatter()
                let now = Date()
                let started = recordStartedAt ?? now
                let req: ClaimRequest
                if let info {
                    req = ClaimRequest(
                        identityKind: info.kind,
                        identityKey: info.key,
                        title: info.title ?? "Встреча",
                        startedAt: info.startISO ?? iso.string(from: started),
                        endedAt: info.endISO ?? iso.string(from: now),
                        attendees: info.attendees.isEmpty ? nil : info.attendees,
                        agentVersion: "0.1.0",
                        micStartOffset: res.micStartOffset,
                    )
                } else {
                    req = ClaimRequest(
                        identityKind: .manual,
                        identityKey: "manual:\(UUID().uuidString)",
                        title: "Запись \(DateFormatter.localizedString(from: now, dateStyle: .short, timeStyle: .short))",
                        startedAt: iso.string(from: started),
                        endedAt: iso.string(from: now),
                        agentVersion: "0.1.0",
                        micStartOffset: res.micStartOffset,
                    )
                }
                // Claim (с ретраем). meetingId переиспользуется очередью при дозагрузке.
                let claim = try await withRetry { try await client.claim(req) }
                if claim.shouldTranscribe {
                    // КРИТИЧНО против потери данных: ДО загрузки переносим записи в pending/<id>/
                    // с сайдкаром. Файлы удалятся только после подтверждённого ingest (в drain).
                    try await UploadQueue.shared.enqueue(
                        meetingId: claim.meetingId,
                        systemSegments: res.systemSegments,
                        micURL: res.mic,
                        micStartOffset: res.micStartOffset,
                        startISO: iso.string(from: started),
                        endISO: iso.string(from: now)
                    )
                } else {
                    // decision=defer — транскрибирует другой участник; наши файлы не нужны.
                    for s in res.systemSegments { try? FileManager.default.removeItem(at: s.url) }
                    if let m = res.mic { try? FileManager.default.removeItem(at: m) }
                }
                // Записанную встречу больше не предлагать.
                if let info { dismissedKeys.insert(info.key) }
                identity = nil
                setState(.idle)
                // Дозагрузка (этой записи + всех висящих) — в фоне с бэкоффом.
                await UploadQueue.shared.drain(config: cfg)
                await refreshQueueBadge()
            } catch let err as SwarmError where err.isAuthExpired {
                // 401: токен истёк/недействителен — отдельное состояние с подсказкой получить новый.
                identity = nil
                setState(.tokenExpired)
                await refreshQueueBadge()
            } catch where isOfflineError(error) {
                // Транспорт/сеть недоступна (claim/upload не прошли по сети). Запись уже могла лечь
                // в pending/ (если claim успел) — дозальётся при следующем drain; иначе «Повторить».
                identity = nil
                setState(.offline)
                await refreshQueueBadge()
            } catch {
                identity = nil
                setState(.error("\(error)"))
                await refreshQueueBadge()
            }
        }
    }

    // Подтянуть счётчик очереди и перерисовать меню (вызывать с любого потока).
    private func refreshQueueBadge() async {
        let n = await UploadQueue.shared.pendingCount()
        await MainActor.run { self.queuedCount = n; self.rebuildMenu() }
    }
}
