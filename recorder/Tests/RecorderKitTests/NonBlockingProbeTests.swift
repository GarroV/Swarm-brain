import Foundation
import XCTest
@testable import RecorderKit

private final class ProbeFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var time: TimeInterval = 0
    private var calls = 0
    private var health: [Bool] = []
    private var heartbeat = false

    func now() -> TimeInterval { lock.lock(); defer { lock.unlock() }; return time }
    func advance() { lock.lock(); time += 2; lock.unlock() }
    func called() { lock.lock(); calls += 1; lock.unlock() }
    func count() -> Int { lock.lock(); defer { lock.unlock() }; return calls }
    func changed(_ unavailable: Bool) { lock.lock(); health.append(unavailable); lock.unlock() }
    func events() -> [Bool] { lock.lock(); defer { lock.unlock() }; return health }
    func beat() { lock.lock(); heartbeat = true; lock.unlock() }
    func didBeat() -> Bool { lock.lock(); defer { lock.unlock() }; return heartbeat }
}

final class NonBlockingProbeTests: XCTestCase {
    private func waitUntil(_ ready: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(2)
        while !ready() && Date() < end {
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
        }
        return ready()
    }

    func testHungProviderKeepsMainResponsiveAndStartsOnlyOneRequest() {
        let fixture = ProbeFixture()
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        defer { release.signal() }
        let probe = NonBlockingProbe<Int>(timeout: 1, refreshInterval: 1, now: { fixture.now() }) {
            fixture.called()
            entered.signal()
            _ = release.wait(timeout: .now() + 3)
            return 42
        }
        probe.onAvailabilityChange { fixture.changed($0) }
        let initial = probe.poll()
        XCTAssertEqual(initial, .pending, "A synchronous HAL call blocks this read and returns a value instead of pending")
        guard initial == .pending else { return }
        XCTAssertEqual(entered.wait(timeout: .now() + 1), .success)
        DispatchQueue.main.async { fixture.beat() }
        fixture.advance()
        for _ in 0..<1_000 { XCTAssertEqual(probe.poll(), .timedOut) }
        XCTAssertEqual(probe.requestCount, 1, "Blocked calls must not accumulate in the serial worker queue either")
        XCTAssertEqual(fixture.count(), 1, "Timeout must not enqueue replacement HAL calls or accumulate blocked workers")
        XCTAssertTrue(waitUntil { fixture.didBeat() && fixture.events() == [true] }, "main queue must keep serving callbacks while the provider is blocked")

        release.signal()
        XCTAssertTrue(waitUntil { probe.poll() == .value(42) })
        XCTAssertTrue(waitUntil { fixture.events() == [true, false] })
        XCTAssertEqual(fixture.count(), 1)
    }

    func testSuccessfulValueIsCachedAndRefreshRemainsSingleFlight() {
        let fixture = ProbeFixture()
        let probe = NonBlockingProbe<Int>(timeout: 1, refreshInterval: 1, now: { fixture.now() }) {
            fixture.called()
            return fixture.count()
        }
        _ = probe.poll()
        XCTAssertTrue(waitUntil { probe.poll() == .value(1) })
        for _ in 0..<100 { XCTAssertEqual(probe.poll(), .value(1)) }
        XCTAssertEqual(fixture.count(), 1)
        fixture.advance()
        _ = probe.poll()
        XCTAssertTrue(waitUntil { probe.poll() == .value(2) })
        XCTAssertEqual(fixture.count(), 2)
    }

    func testDeadlineSignalsFailureWithoutAnotherPoll() {
        let fixture = ProbeFixture()
        let release = DispatchSemaphore(value: 0)
        defer { release.signal() }
        let probe = NonBlockingProbe<Int>(timeout: 0.02, refreshInterval: 1) {
            _ = release.wait(timeout: .now() + 3)
            return 42
        }
        probe.onAvailabilityChange { fixture.changed($0) }
        _ = probe.poll()
        XCTAssertTrue(waitUntil { fixture.events() == [true] })
        release.signal()
        XCTAssertTrue(waitUntil { fixture.events() == [true, false] })
    }
}
