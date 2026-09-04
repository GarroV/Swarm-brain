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

// ── Слияние состояния для heartbeat (issue #242) ─────────────────────────────
// Дефект был в том, что «звонка нет» (явный nil-ключ) подменялся ПРОШЛЫМ ключом: сохранённое
// состояние вечно отличалось от текущего, и heartbeat уходил на каждом тике детекта — 144
// запроса в час вместо тишины в простое.
extension PresenceBeaconTests {
    func testЯвноеСостояниеБеретсяКакЕсть() {
        let merged = PresenceBeacon.stateForHeartbeat(
            explicit: PresenceBeacon.State(onCall: false, meetingKey: nil),
            previous: PresenceBeacon.State(onCall: true, meetingKey: "x:2026-09-04"),
            recordingKey: nil)
        XCTAssertEqual(merged, PresenceBeacon.State(onCall: false, meetingKey: nil))
    }

    func testБезЯвногоСостоянияНаследуемПрошлое() {
        // Обычный heartbeat (старт, maintenanceTick) присутствие не знает — и не должен его гасить.
        let merged = PresenceBeacon.stateForHeartbeat(
            explicit: nil,
            previous: PresenceBeacon.State(onCall: true, meetingKey: "x:2026-09-04"),
            recordingKey: nil)
        XCTAssertEqual(merged, PresenceBeacon.State(onCall: true, meetingKey: "x:2026-09-04"))
    }

    func testКлючЗаписиВажнееПрошлого() {
        // Пишем встречу — ключ берём у записи: календарный детект в этот момент может смотреть
        // уже на следующий слот.
        let merged = PresenceBeacon.stateForHeartbeat(
            explicit: nil,
            previous: PresenceBeacon.State(onCall: true, meetingKey: "старый:2026-09-04"),
            recordingKey: "запись:2026-09-04")
        XCTAssertEqual(merged, PresenceBeacon.State(onCall: true, meetingKey: "запись:2026-09-04"))
    }

    func testБезПрошлогоИБезЯвногоСостоянияЗвонкаНет() {
        let merged = PresenceBeacon.stateForHeartbeat(explicit: nil, previous: nil, recordingKey: nil)
        XCTAssertEqual(merged, PresenceBeacon.State(onCall: false, meetingKey: nil))
    }
}
