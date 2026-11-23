import AppKit
import RecorderKit

/// Timer belongs to the offer, not to the recurring calendar/detection refresh.
final class RecordingPromptPresentation {
    private var lifetime: RecordingPromptLifetime
    private var timer: Timer?
    private var presentedKey: String?
    var isActive: Bool { lifetime.key != nil }

    init(lifetime: TimeInterval) {
        self.lifetime = RecordingPromptLifetime(lifetime: lifetime)
    }

    func show(key: String, onExpire: @escaping () -> Void) -> Bool {
        let previous = lifetime.key
        let now = Date()
        guard lifetime.show(key: key, now: now), let deadline = lifetime.deadline else { return false }
        if previous != key || timer == nil {
            timer?.invalidate()
            let t = Timer(timeInterval: max(0, deadline.timeIntervalSince(now)), repeats: false) { [weak self] _ in
                onExpire()
                if key.hasSuffix(":backup") { BackupDiagnostics.prompt("offer_expired", key: key) }
                self?.presentedKey = nil
            }
            RunLoop.main.add(t, forMode: .common)
            timer = t
        }
        return true
    }

    func didPresent() {
        guard let key = lifetime.key, key != presentedKey else { return }
        presentedKey = key
        if key.hasSuffix(":backup") { BackupDiagnostics.prompt("offered", key: key) }
    }

    func noteDismissed() {
        if let key = presentedKey, key.hasSuffix(":backup") { BackupDiagnostics.prompt("dismissed", key: key) }
    }

    @discardableResult
    func clear() -> Bool {
        let active = isActive
        if let key = presentedKey, key.hasSuffix(":backup") { BackupDiagnostics.prompt("offer_removed", key: key) }
        presentedKey = nil
        timer?.invalidate()
        timer = nil
        lifetime.clear()
        return active
    }

    deinit { timer?.invalidate() }
}
