import XCTest
@testable import RecorderKit

// Календарь при ручном старте (issue #379). Ложное «годится» привяжет запись к чужой/прошедшей
// встрече и склеит её с записями коллег; ложное «не годится» вернёт старый дефект — живая
// встреча пишется как manual и мимо склейки.
final class StartIdentityTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)   // опора для арифметики
    private func t(_ offsetMinutes: Double) -> Date { now.addingTimeInterval(offsetMinutes * 60) }

    func testИдущийСлотСоСвежимОтветомГодится() {
        XCTAssertTrue(StartIdentity.useCalendar(fetchedAt: t(-0.2), start: t(-10), end: t(50), now: now))
    }

    func testСлотНачнётсяЧерезПятьМинутГодится() {
        XCTAssertTrue(StartIdentity.useCalendar(fetchedAt: t(-0.2), start: t(5), end: t(65), now: now))
    }

    func testСлотДальшеУпрежденияНеГодится() {
        XCTAssertFalse(StartIdentity.useCalendar(fetchedAt: t(-0.2), start: t(20), end: t(80), now: now))
    }

    func testЗакончившийсяСлотНеГодится() {
        XCTAssertFalse(StartIdentity.useCalendar(fetchedAt: t(-0.2), start: t(-70), end: t(-10), now: now))
    }

    func testПротухшийОтветСервераНеГодится() {
        XCTAssertFalse(StartIdentity.useCalendar(fetchedAt: t(-5), start: t(-10), end: t(50), now: now))
    }

    func testБезОтветаСервераНеГодится() {
        XCTAssertFalse(StartIdentity.useCalendar(fetchedAt: nil, start: t(-10), end: t(50), now: now))
    }

    func testВстречаБезГраницСлотаГодитсяПоСвежести() {
        XCTAssertTrue(StartIdentity.useCalendar(fetchedAt: t(-0.5), start: nil, end: nil, now: now))
    }
}
