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
    private enum State { case idle, recording, sending, error(String) }
    private var state: State = .idle
    private var sysURL: URL?
    private var micURL: URL?
    private var recordStartedAt: Date?
    private var identity: MeetingIdentity.Info?

    // Календарное предложение.
    private var pendingMeeting: MeetingIdentity.Info?
    private var dismissedKeys: Set<String> = []   // «не записывать» / уже записали
    private var notifiedKeys: Set<String> = []     // по каким уже слали уведомление
    // Микрофонный запасной детект.
    private var callActive = false
    private var micWasActive = false
    private var callDismissedUntil: Date?
    private var watchTimer: Timer?
    // Авто-стоп по концу звонка (per-process детект во время записи).
    private var recWatchTimer: Timer?
    private var callSeenDuringRec = false
    private var silentTicks = 0

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

        setupNotifications()
        startWatching()
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
    }

    @objc private func watchTick() {
        guard let cfg = config, configError == nil else { return }
        Task {
            let meeting = (try? await SwarmClient(config: cfg).currentMeeting()) ?? nil
            let micOn = CallDetector.isMicActive()
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

    private func statusText() -> String {
        if let e = configError { return "⚠️ \(e)" }
        switch state {
        case .idle:
            if let m = pendingMeeting { return "Встреча \(meetingWhen(m)): «\(m.title ?? "")»" }
            if callActive { return "Идёт звонок" }
            return "Готов"
        case .recording: return "● Идёт запись"
        case .sending: return "Отправка…"
        case .error(let m): return "Ошибка: \(m)"
        }
    }

    private func rebuildMenu() {
        if let button = statusItem.button {
            button.image = RoyArt.menuBarImage(recording: isRecording)
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: statusText(), action: nil, keyEquivalent: ""))
        menu.addItem(.separator())

        if configError == nil {
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
            if let web = config?.webBaseURL, !web.isEmpty {
                menu.addItem(NSMenuItem(title: "Открыть Рой", action: #selector(openWeb), keyEquivalent: ""))
            }
            // Доступно всегда: перевставить токен (напр. если протух → 401). Раньше пункт
            // показывался только при отсутствии токена, и перевставить было неоткуда.
            menu.addItem(NSMenuItem(title: "Обновить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
        } else {
            menu.addItem(NSMenuItem(title: "Вставить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
        }
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
        case .sending, .error:
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

    @objc private func openWeb() {
        guard let web = config?.webBaseURL, let url = URL(string: web) else { return }
        NSWorkspace.shared.open(url)
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
        // macOS 14.4+: системный звук через Core Audio process-tap — нужно «System Audio
        // Recording», НЕ «запись экрана»; TCC-промпт всплывёт сам при старте тапа.
        // Ниже 14.4 — старый путь ScreenCaptureKit, требует «запись экрана».
        if #available(macOS 14.4, *) {
            // ничего не гейтим — промпт системного звука покажется при старте
        } else if !Permissions.ensureScreenRecording() {
            setState(.error("Нет доступа к записи экрана. Открыл настройки — включи SwarmRecorder и перезапусти приложение."))
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
                setState(.error("Не удалось начать запись: \(error). Первый запуск? Разреши «System Audio Recording» в System Settings → Privacy и попробуй снова."))
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
        guard #available(macOS 14.0, *) else { return } // per-process детект только 14.0+
        let info = CallDetector.othersUsingMicInfo()
        dbg("tick others=\(info.map { "\($0.pid):\($0.bundle)" }) seen=\(callSeenDuringRec) silent=\(silentTicks)")
        if !info.isEmpty {
            callSeenDuringRec = true
            silentTicks = 0
        } else if callSeenDuringRec {
            silentTicks += 1
            if silentTicks >= 3 { // ~15с тишины после звонка
                dbg("AUTO-STOP: звонок завершён")
                stopCallEndWatch()
                postCallEndedNotification()
                stopTapped()
            }
        }
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

    private func postCallEndedNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Запись остановлена"
        content.body = "Звонок завершён — сохраняю встречу."
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "callend-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil))
    }

    @objc private func stopTapped() {
        guard let cfg = config else { return }
        stopCallEndWatch()
        setState(.sending)
        Task {
            do {
                let res = try await recorder.stop()

                func fileSize(_ u: URL?) -> Int {
                    guard let u, let attrs = try? FileManager.default.attributesOfItem(atPath: u.path) else { return 0 }
                    return (attrs[.size] as? Int) ?? 0
                }
                let limit = 25 * 1024 * 1024
                if fileSize(res.system) > limit || fileSize(res.mic) > limit {
                    setState(.error("Запись длиннее ~2,4 ч (>25 МБ/дорожку — лимит Whisper). Нарезка очень длинных встреч — в планах."))
                    return
                }

                let client = SwarmClient(config: cfg)
                let iso = ISO8601DateFormatter()
                let now = Date()
                let started = recordStartedAt ?? now
                let req: ClaimRequest
                if let info = identity {
                    req = ClaimRequest(
                        identityKind: info.kind,
                        identityKey: info.key,
                        title: info.title ?? "Встреча",
                        startedAt: info.startISO ?? iso.string(from: started),
                        endedAt: info.endISO ?? iso.string(from: now),
                        attendees: info.attendees.isEmpty ? nil : info.attendees,
                        agentVersion: "0.1.0",
                    )
                } else {
                    req = ClaimRequest(
                        identityKind: .manual,
                        identityKey: "manual:\(UUID().uuidString)",
                        title: "Запись \(DateFormatter.localizedString(from: now, dateStyle: .short, timeStyle: .short))",
                        startedAt: iso.string(from: started),
                        endedAt: iso.string(from: now),
                        agentVersion: "0.1.0",
                    )
                }
                let claim = try await withRetry { try await client.claim(req) }
                if claim.shouldTranscribe {
                    _ = try await withRetry { try await client.uploadAudio(meetingID: claim.meetingId, systemURL: res.system, micURL: res.mic) }
                }
                // Записанную встречу больше не предлагать.
                if let info = identity { dismissedKeys.insert(info.key) }
                identity = nil
                try? FileManager.default.removeItem(at: res.system)
                if let m = res.mic { try? FileManager.default.removeItem(at: m) }
                setState(.idle)
            } catch {
                setState(.error("\(error)"))
            }
        }
    }
}
