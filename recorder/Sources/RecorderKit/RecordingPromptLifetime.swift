import Foundation

/// One recording offer lasts five minutes. Polling the same call never renews it.
public struct RecordingPromptLifetime {
    public static let defaultLifetime: TimeInterval = 5 * 60
    public private(set) var key: String?
    public private(set) var deadline: Date?
    private let lifetime: TimeInterval

    public init(lifetime: TimeInterval = Self.defaultLifetime) {
        self.lifetime = lifetime
    }

    public mutating func show(key: String, now: Date) -> Bool {
        if self.key != key {
            self.key = key
            deadline = now.addingTimeInterval(lifetime)
        }
        return deadline.map { now < $0 } ?? false
    }

    public mutating func clear() {
        key = nil
        deadline = nil
    }
}
