import AppKit
import Foundation

// Меню-бар приложение. MVP: ручная запись системного звука → claim(manual) → загрузка аудио.
// Состояния отражаются в иконке/меню. Авто-старт по календарю и онбординг токена — следующее.
final class AppDelegate: NSObject, NSApplicationDelegate {
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { config = try SwarmConfig.load() }
        catch { configError = "нет config.json (см. README)" }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        rebuildMenu()
        _ = Permissions.ensureScreenRecording()
        Task { _ = await Permissions.requestMicrophone() }
    }

    // ── UI ──────────────────────────────────────────────────────────────────────
    private func symbol() -> String {
        switch state {
        case .idle: return "mic"
        case .recording: return "record.circle"
        case .sending: return "arrow.up.circle"
        case .error: return "exclamationmark.triangle"
        }
    }

    private func statusText() -> String {
        if let e = configError { return "⚠️ \(e)" }
        switch state {
        case .idle: return "Готов"
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
                menu.addItem(NSMenuItem(title: "Записать встречу", action: #selector(recordTapped), keyEquivalent: "r"))
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
        if !Permissions.ensureScreenRecording() {
            setState(.error("нет доступа к записи экрана — выдай в System Settings → Privacy"))
            return
        }
        let startedAt = Date()
        let base = UUID().uuidString
        let sys = FileManager.default.temporaryDirectory.appendingPathComponent("swarm-\(base)-sys.m4a")
        let mic = FileManager.default.temporaryDirectory.appendingPathComponent("swarm-\(base)-mic.m4a")
        Task {
            // Идентичность встречи: идущее сейчас событие календаря (общий ключ → дедуп у всех
            // записавших); нет события → manual (своя встреча без авто-дедупа).
            let id = await MeetingIdentity.currentCalendar()
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
                try? FileManager.default.removeItem(at: res.system)
                if let m = res.mic { try? FileManager.default.removeItem(at: m) }
                setState(.idle)
            } catch {
                setState(.error("\(error)"))
            }
        }
    }
}
