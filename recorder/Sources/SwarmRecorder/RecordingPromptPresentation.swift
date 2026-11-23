import AppKit
import RecorderKit

/// Timer belongs to the offer, not to the recurring calendar/detection refresh.
final class RecordingPromptPresentation {
    private var lifetime: RecordingPromptLifetime
    private var timer: Timer?
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
            let t = Timer(timeInterval: max(0, deadline.timeIntervalSince(now)), repeats: false) { _ in
                onExpire()
            }
            RunLoop.main.add(t, forMode: .common)
            timer = t
        }
        return true
    }

    @discardableResult
    func clear() -> Bool {
        let active = isActive
        timer?.invalidate()
        timer = nil
        lifetime.clear()
        return active
    }

    deinit { timer?.invalidate() }
}
