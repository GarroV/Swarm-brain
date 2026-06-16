import AppKit
import Foundation
import UserNotifications

// Меню-бар приложение. Ручная запись + авто-детект ЗВОНКА ПО МИКРОФОНУ (без календаря) с
// ЗАПРОСОМ СОГЛАСИЯ: как только вход занят (идёт звонок) — уведомление «записать?» и пункт
// меню. Запись стартует только по явному действию пользователя, никогда молча.
// Идентичность для дедупа: комната из URL браузера (Meet/Контур) → manual.
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

    // Авто-детект звонка по микрофону.
    private var callActive = false              // идёт звонок, по которому предлагаем запись
    private var micWasActive = false            // прошлое состояние входа (для детекта старта)
    private var callDismissedUntil: Date?       // «не сейчас» → не предлагать до этого времени
    private var watchTimer: Timer?

    private let notifyCategory = "MEETING_START"
    private let recordAction = "RECORD"

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { config = try SwarmConfig.load() }
        catch { configError = "нужен токен — вставь через меню" }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        rebuildMenu()
        _ = Permissions.ensureScreenRecording()
        Task { _ = await Permissions.requestMicrophone() }

        setupNotifications()
        startWatching()
    }

    // ── Авто-детект звонка (опрос активности микрофона) ──────────────────────────
    private func setupNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let record = UNNotificationAction(identifier: recordAction, title: "Записать", options: [.foreground])
        let cat = UNNotificationCategory(identifier: notifyCategory, actions: [record], intentIdentifiers: [], options: [])
        center.setNotificationCategories([cat])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func startWatching() {
        let t = Timer.scheduledTimer(timeInterval: 8, target: self, selector: #selector(watchTick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        watchTimer = t
    }

    @objc private func watchTick() {
        guard config != nil, configError == nil else { return }
        handleMic(CallDetector.isMicActive())
    }

    private func handleMic(_ active: Bool) {
        let wasActive = micWasActive
        micWasActive = active
        // Во время записи/отправки не предлагаем (микрофон занят нами).
        guard case .idle = state else { return }

        if active && !wasActive {
            if let until = callDismissedUntil, Date() < until { return }   // «не сейчас» — cooldown
            if !callActive {
                callActive = true
                postCallNotification()
                rebuildMenu()
            }
        } else if !active, callActive {
            callActive = false
            rebuildMenu()
        }
    }

    private func postCallNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Идёт звонок"
        content.body = "Записать встречу?"
        content.categoryIdentifier = notifyCategory
        content.sound = .default
        let req = UNNotificationRequest(identifier: "call-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == recordAction || response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            DispatchQueue.main.async { [weak self] in self?.acceptCall() }
        }
        completionHandler()
    }

    // ── UI ──────────────────────────────────────────────────────────────────────
    private func symbol() -> String {
        switch state {
        case .idle: return callActive ? "record.circle" : "mic"
        case .recording: return "record.circle.fill"
        case .sending: return "arrow.up.circle"
        case .error: return "exclamationmark.triangle"
        }
    }

    private func statusText() -> String {
        if let e = configError { return "⚠️ \(e)" }
        switch state {
        case .idle: return callActive ? "Идёт звонок" : "Готов"
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
                if callActive {
                    menu.addItem(NSMenuItem(title: "🔴 Записать звонок", action: #selector(recordCallTapped), keyEquivalent: "r"))
                    menu.addItem(NSMenuItem(title: "Не сейчас", action: #selector(dismissCallTapped), keyEquivalent: ""))
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

    // Токен из буфера (без текстового поля — вставка в NSTextField в меню-бар-приложении
    // работала криво). Пользователь копирует токен в боте (тап по smcp_-блоку) → жмёт пункт.
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

    @objc private func recordCallTapped() {
        acceptCall()
    }

    private func acceptCall() {
        callActive = false
        beginRecording(identity: MeetingIdentity.currentRoom())
    }

    @objc private func dismissCallTapped() {
        callDismissedUntil = Date().addingTimeInterval(10 * 60)   // не предлагать 10 минут
        callActive = false
        rebuildMenu()
    }

    private func beginRecording(identity id: MeetingIdentity.Info?) {
        guard config != nil else { return }
        if case .recording = state { return }
        if !Permissions.ensureScreenRecording() {
            setState(.error("нет доступа к записи экрана — выдай в System Settings → Privacy"))
            return
        }
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
                // записей — отдельная итерация. Пока честная ошибка вместо невнятного 413.
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
                    // Комната (ссылка звонка): общий ключ у всех записавших → дедуп.
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
