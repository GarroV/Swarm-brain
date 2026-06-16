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
        do { config = try SwarmConfig.load() }
        catch { configError = "нет config.json (см. README)" }

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

    // ── Запись ───────────────────────────────────────────────────────────────────
    @objc private func recordTapped() {
        guard config != nil else { return }
        // Ручной старт: подтянуть идентичность из календаря (если событие идёт).
        Task {
            let id = await MeetingIdentity.currentCalendar()
            DispatchQueue.main.async { [weak self] in self?.beginRecording(identity: id) }
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
