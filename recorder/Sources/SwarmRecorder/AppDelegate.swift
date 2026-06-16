import AppKit
import Foundation
import UserNotifications

// Меню-бар приложение. Ручная запись + авто-детект идущей встречи (календарь) с ЗАПРОСОМ
// СОГЛАСИЯ: при обнаружении события показываем уведомление «записать?» и пункт меню — запись
// стартует только по явному действию пользователя, никогда молча.
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem!
    private let recorder = AudioRecorder()

    private var config: SwarmConfig?
    private var configError: String?
    private enum State { case idle, recording, sending, error(String) }
    private var state: State = .idle
    private var sysURL: URL?
    private var micURL: URL?
    private var recordStartedAt: Date?
    private var identity: MeetingIdentity.Info?

    // Авто-детект: идущая встреча, на которую ещё не дали согласие/отказ.
    private var ongoingPrompt: MeetingIdentity.Info?
    private var dismissedKeys: Set<String> = []   // встречи, по которым сказали «не записывать»
    private var notifiedKeys: Set<String> = []     // по которым уже слали уведомление
    private var watchTimer: Timer?

    private let notifyCategory = "MEETING_START"
    private let recordAction = "RECORD"

    func applicationDidFinishLaunching(_ notification: Notification) {
        installEditMenu()
        do { config = try SwarmConfig.load() }
        catch { configError = "нужен токен — вставь через меню" }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        rebuildMenu()
        _ = Permissions.ensureScreenRecording()
        Task { _ = await Permissions.requestMicrophone() }

        setupNotifications()
        startWatching()
    }

    // ── Авто-детект встречи (опрос календаря) ────────────────────────────────────
    private func setupNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let record = UNNotificationAction(identifier: recordAction, title: "Записать", options: [.foreground])
        let cat = UNNotificationCategory(identifier: notifyCategory, actions: [record], intentIdentifiers: [], options: [])
        center.setNotificationCategories([cat])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func startWatching() {
        // Опрашиваем календарь раз в 45с; запись стартуем только с согласия.
        let t = Timer.scheduledTimer(timeInterval: 45, target: self, selector: #selector(watchTick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        watchTimer = t
        // Первая проверка вскоре после запуска (дать время выдать доступ к календарю).
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.watchTick() }
    }

    @objc private func watchTick() {
        guard config != nil, configError == nil else { return }
        // Пока идёт запись/отправка — не предлагаем ничего.
        if case .idle = state {} else { return }
        Task {
            let info = await MeetingIdentity.currentCalendar()
            DispatchQueue.main.async { [weak self] in self?.handleOngoing(info) }
        }
    }

    private func handleOngoing(_ info: MeetingIdentity.Info?) {
        if case .idle = state {} else { return }
        guard let info, !dismissedKeys.contains(info.key) else {
            if ongoingPrompt != nil { ongoingPrompt = nil; rebuildMenu() }
            return
        }
        if ongoingPrompt?.key == info.key { return }   // уже предлагаем эту
        ongoingPrompt = info
        if !notifiedKeys.contains(info.key) {
            notifiedKeys.insert(info.key)
            postMeetingNotification(info)
        }
        rebuildMenu()
    }

    private func postMeetingNotification(_ info: MeetingIdentity.Info) {
        let content = UNMutableNotificationContent()
        content.title = "Встреча идёт"
        content.body = "«\(info.title ?? "Без названия")» — записать?"
        content.categoryIdentifier = notifyCategory
        content.sound = .default
        let req = UNNotificationRequest(identifier: "meeting-\(info.key)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }

    // Показывать баннер даже когда приложение «активно».
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // Нажали «Записать» в уведомлении (или тапнули само уведомление) → старт с согласия.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == recordAction || response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            DispatchQueue.main.async { [weak self] in
                guard let self, let p = self.ongoingPrompt else { return }
                self.beginRecording(identity: p)
            }
        }
        completionHandler()
    }

    // ── UI ──────────────────────────────────────────────────────────────────────
    private func symbol() -> String {
        switch state {
        case .idle: return ongoingPrompt != nil ? "record.circle" : "mic"
        case .recording: return "record.circle.fill"
        case .sending: return "arrow.up.circle"
        case .error: return "exclamationmark.triangle"
        }
    }

    private func statusText() -> String {
        if let e = configError { return "⚠️ \(e)" }
        switch state {
        case .idle: return ongoingPrompt != nil ? "Идёт встреча: «\(ongoingPrompt?.title ?? "")»" : "Готов"
        case .recording: return "● Идёт запись"
        case .sending: return "Отправка…"
        case .error(let m): return "Ошибка: \(m)"
        }
    }

    private func rebuildMenu() {
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: symbol(), accessibilityDescription: "Swarm")
            button.image?.isTemplate = true
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
                if ongoingPrompt != nil {
                    menu.addItem(NSMenuItem(title: "🔴 Записать эту встречу", action: #selector(recordOngoingTapped), keyEquivalent: "r"))
                    menu.addItem(NSMenuItem(title: "Не записывать эту встречу", action: #selector(dismissOngoingTapped), keyEquivalent: ""))
                } else {
                    menu.addItem(NSMenuItem(title: "Записать встречу", action: #selector(recordTapped), keyEquivalent: "r"))
                }
            }
            if let web = config?.webBaseURL, !web.isEmpty {
                menu.addItem(NSMenuItem(title: "Открыть Рой", action: #selector(openWeb), keyEquivalent: ""))
            }
        } else {
            menu.addItem(NSMenuItem(title: "Вставить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Выйти", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        for item in menu.items where item.action != nil && item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
        statusItem.menu = menu
    }

    private func setState(_ s: State) {
        state = s
        DispatchQueue.main.async { self.rebuildMenu() }
    }

    @objc private func openWeb() {
        guard let web = config?.webBaseURL, let url = URL(string: web) else { return }
        NSWorkspace.shared.open(url)
    }

    // LSUIElement-приложение без главного меню → в текстовых полях не работают ⌘V/⌘C/⌘X.
    // Ставим минимальное меню Edit: стандартные правки роутятся через responder chain
    // в редактор активного поля, поэтому вставка токена (⌘V) заработает.
    private func installEditMenu() {
        let mainMenu = NSMenu()
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        editItem.submenu = edit
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = mainMenu
    }

    // Токен берём ПРЯМО ИЗ БУФЕРА — без текстового поля (в меню-бар-приложении вставка в
    // NSTextField работала криво). Пользователь копирует токен в боте (тап по smcp_-блоку) →
    // жмёт этот пункт. Валидируем префикс smcp_, чтобы отсечь обрезки.
    @objc private func pasteTokenTapped() {
        func info(_ title: String, _ text: String = "") {
            let a = NSAlert()
            a.messageText = title
            a.informativeText = text
            NSApp.activate(ignoringOtherApps: true)
            a.runModal()
        }
        let clip = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !clip.isEmpty else {
            info("Буфер пуст", "Скопируй токен из бота: /mytoken (тапни по smcp_-блоку — скопируется целиком).")
            return
        }
        guard clip.hasPrefix("smcp_"), clip.count >= 12 else {
            info("Это не похоже на токен", "В буфере: «\(clip.prefix(24))…». Нужен токен из /mytoken — начинается с smcp_. Скопируй его целиком (тап по smcp_-блоку в боте).")
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
        guard config != nil else { return }
        // Ручной старт: идентичность — событие календаря, иначе комната из URL браузера
        // (Meet/Контур), иначе manual.
        Task {
            let cal = await MeetingIdentity.currentCalendar()
            DispatchQueue.main.async { [weak self] in
                let id = cal ?? MeetingIdentity.currentRoom()
                self?.beginRecording(identity: id)
            }
        }
    }

    @objc private func recordOngoingTapped() {
        beginRecording(identity: ongoingPrompt)
    }

    @objc private func dismissOngoingTapped() {
        if let p = ongoingPrompt { dismissedKeys.insert(p.key) }
        ongoingPrompt = nil
        rebuildMenu()
    }

    private func beginRecording(identity id: MeetingIdentity.Info?) {
        guard config != nil else { return }
        if case .recording = state { return }
        if !Permissions.ensureScreenRecording() {
            setState(.error("нет доступа к записи экрана — выдай в System Settings → Privacy"))
            return
        }
        ongoingPrompt = nil
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
            } catch {
                setState(.error("старт записи: \(error)"))
            }
        }
    }

    @objc private func stopTapped() {
        guard let cfg = config else { return }
        setState(.sending)
        Task {
            do {
                let res = try await recorder.stop()

                // Лимит OpenAI 25 МБ/дорожку (~2,3 ч при 24 кбит/с). Полная нарезка длинных
                // записей — отдельная итерация (edge без ffmpeg → резать на клиенте + multipart).
                // Пока честная ошибка вместо невнятного 413; временные файлы не удаляем.
                func fileSize(_ u: URL?) -> Int {
                    guard let u, let attrs = try? FileManager.default.attributesOfItem(atPath: u.path) else { return 0 }
                    return (attrs[.size] as? Int) ?? 0
                }
                let limit = 25 * 1024 * 1024
                if fileSize(res.system) > limit || fileSize(res.mic) > limit {
                    setState(.error("Запись длиннее ~2,3 ч (>25 МБ/дорожку). Нарезка длинных встреч — в планах."))
                    return
                }

                let client = SwarmClient(config: cfg)

                let iso = ISO8601DateFormatter()
                let now = Date()
                let started = recordStartedAt ?? now
                let req: ClaimRequest
                if let info = identity {
                    // Календарная встреча: общий ключ у всех записавших → сервер схлопывает в одну.
                    req = ClaimRequest(
                        identityKind: info.kind,
                        identityKey: info.key,
                        title: info.title ?? "Встреча",
                        startedAt: iso.string(from: info.start ?? started),
                        endedAt: iso.string(from: now),
                        attendees: info.attendees.isEmpty ? nil : info.attendees,
                        agentVersion: "0.1.0"
                    )
                } else {
                    req = ClaimRequest(
                        identityKind: .manual,
                        identityKey: "manual:\(UUID().uuidString)",
                        title: "Запись \(DateFormatter.localizedString(from: now, dateStyle: .short, timeStyle: .short))",
                        startedAt: iso.string(from: started),
                        endedAt: iso.string(from: now),
                        agentVersion: "0.1.0"
                    )
                }
                let claim = try await withRetry { try await client.claim(req) }
                if claim.shouldTranscribe {
                    _ = try await withRetry { try await client.uploadAudio(meetingID: claim.meetingId, systemURL: res.system, micURL: res.mic) }
                }
                // Если эту встречу больше не предлагать (мы её записали).
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
