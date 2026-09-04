import XCTest
@testable import RecorderKit

// Когда рекордер обязан рассказать серверу, где сидит человек (issue #218, решение владельца
// 04.09.2026). Панель «Встречи сегодня» гасит ON AIR через 5 минут тишины, поэтому в звонке
// маяк обязан звучать чаще — но не на каждом тике детекта, иначе это 144 запроса в час.
final class PresenceBeaconTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)
    private func state(_ onCall: Bool, _ key: String?) -> PresenceBeacon.State {
        PresenceBeacon.State(onCall: onCall, meetingKey: key)
    }

    func testПервоеСостояниеОтправляетсяВсегда() {
        XCTAssertTrue(PresenceBeacon.shouldSend(
            previous: nil, current: state(false, nil), lastSentAt: nil, now: now))
    }

    func testНачалоЗвонкаОтправляетсяСразу() {
        XCTAssertTrue(PresenceBeacon.shouldSend(
            previous: state(false, nil), current: state(true, "x:2026-09-04"),
            lastSentAt: now, now: now))
    }

    func testКонецЗвонкаОтправляетсяСразу() {
        // Иначе панель светила бы ON AIR ещё пять минут после того, как все разошлись.
        XCTAssertTrue(PresenceBeacon.shouldSend(
            previous: state(true, "x:2026-09-04"), current: state(false, nil),
            lastSentAt: now, now: now))
    }

    func testПереходВДругуюВстречуОтправляетсяСразу() {
        XCTAssertTrue(PresenceBeacon.shouldSend(
            previous: state(true, "x:2026-09-04"), current: state(true, "y:2026-09-04"),
            lastSentAt: now, now: now))
    }

    func testВПокоеБезИзмененийМолчим() {
        // О «жив» и так скажет обычный heartbeat раз в 15 минут.
        XCTAssertFalse(PresenceBeacon.shouldSend(
            previous: state(false, nil), current: state(false, nil),
            lastSentAt: now, now: now.addingTimeInterval(3600)))
    }

    func testВЗвонкеБезИзмененийНеЧащеKeepAlive() {
        XCTAssertFalse(PresenceBeacon.shouldSend(
            previous: state(true, "x:2026-09-04"), current: state(true, "x:2026-09-04"),
            lastSentAt: now, now: now.addingTimeInterval(60)))
    }

    func testВЗвонкеПослеKeepAliveОтправляемСнова() {
        XCTAssertTrue(PresenceBeacon.shouldSend(
            previous: state(true, "x:2026-09-04"), current: state(true, "x:2026-09-04"),
            lastSentAt: now, now: now.addingTimeInterval(PresenceBeacon.keepAlive)))
    }
}
