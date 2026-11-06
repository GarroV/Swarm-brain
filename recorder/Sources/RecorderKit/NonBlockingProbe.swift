import Foundation

/// A synchronous OS provider runs on one dedicated worker; callers only read metadata.
/// A timed-out provider keeps its slot until it returns: retries cannot accumulate
/// blocked calls/threads. The timeout marks data unknown; it cannot cancel an OS call.
public final class NonBlockingProbe<Value: Sendable>: @unchecked Sendable {
    public enum State: Sendable { case pending, value(Value), timedOut }

    private let lock = NSLock()
    private let worker = DispatchQueue(label: "swarm.os-probe.worker", qos: .utility)
    private let events = DispatchQueue(label: "swarm.os-probe.events", qos: .utility)
    private let timeout: TimeInterval
    private let refreshInterval: TimeInterval
    private let now: @Sendable () -> TimeInterval
    private let provider: @Sendable () -> Value
    private var generation: UInt64 = 0
    private var inFlight: UInt64?
    private var startedAt: TimeInterval = 0
    private var receivedAt: TimeInterval?
    private var cached: Value?
    private var unavailable = false
    private var handler: (@Sendable (Bool) -> Void)?

    public init(timeout: TimeInterval, refreshInterval: TimeInterval,
                now: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
                provider: @escaping @Sendable () -> Value) {
        precondition(timeout > 0 && refreshInterval > 0)
        self.timeout = timeout
        self.refreshInterval = refreshInterval
        self.now = now
        self.provider = provider
    }

    public func onAvailabilityChange(_ handler: @escaping @Sendable (Bool) -> Void) {
        lock.lock()
        self.handler = handler
        if unavailable { publishLocked(true) }
        lock.unlock()
    }

    // Test/diagnostic observation counts submissions, including work not yet running.
    var requestCount: UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return generation
    }

    /// Starts a refresh if needed and returns immediately, even if the provider is stuck.
    public func poll() -> State {
        let time = now()
        var launch: UInt64?
        lock.lock()
        if inFlight != nil && time - startedAt >= timeout && !unavailable {
            unavailable = true
            publishLocked(true)
        }
        if inFlight == nil && (receivedAt == nil || time - receivedAt! >= refreshInterval) {
            generation &+= 1
            inFlight = generation
            startedAt = time
            launch = generation
        }
        let state: State
        if unavailable { state = .timedOut }
        else if let cached, let receivedAt, time - receivedAt <= refreshInterval + timeout { state = .value(cached) }
        else { state = .pending }
        lock.unlock()

        if let token = launch {
            worker.async { [self] in finish(token: token, value: provider()) }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) { [self] in
                deadline(token: token)
            }
        }
        return state
    }

    private func finish(token: UInt64, value: Value) {
        lock.lock()
        defer { lock.unlock() }
        guard inFlight == token else { return }
        inFlight = nil
        cached = value
        receivedAt = now()
        if unavailable {
            unavailable = false
            publishLocked(false)
        }
    }

    private func deadline(token: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        guard inFlight == token, now() - startedAt >= timeout, !unavailable else { return }
        unavailable = true
        publishLocked(true)
    }

    // Enqueue under the lock, deliver outside it: timeout/recovery cannot reorder.
    private func publishLocked(_ value: Bool) {
        guard let handler else { return }
        events.async { handler(value) }
    }
}

extension NonBlockingProbe.State: Equatable where Value: Equatable {}
