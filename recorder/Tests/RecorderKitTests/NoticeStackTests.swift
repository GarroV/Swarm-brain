import XCTest
@testable import RecorderKit

final class NoticeStackTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func notice(_ id: String, lifetime: TimeInterval? = 20) -> RecorderNotice {
        RecorderNotice(id: id, title: id, lifetime: lifetime)
    }

    func testNewestFirst() {
        var s = NoticeStack()
        s.post(notice("a"), now: now)
        s.post(notice("b"), now: now)
        XCTAssertEqual(s.visible.map(\.id), ["b", "a"])
    }
    func testSameIdReplacesInPlaceAndRefreshesExpiry() {
        var s = NoticeStack()
        s.post(notice("a"), now: now)
        s.post(notice("b"), now: now)
        s.post(RecorderNotice(id: "a", title: "new", lifetime: 20), now: now.addingTimeInterval(15))
        XCTAssertEqual(s.visible.map(\.title), ["b", "new"])
        XCTAssertTrue(s.expire(now: now.addingTimeInterval(25)))
        XCTAssertEqual(s.visible.map(\.id), ["a"])   // b истёк, обновлённая a живёт
    }
    func testExpiryOnlyForTimedNotices() {
        var s = NoticeStack()
        s.post(notice("timed", lifetime: 20), now: now)
        s.post(notice("sticky", lifetime: nil), now: now)
        XCTAssertFalse(s.expire(now: now.addingTimeInterval(19)))
        XCTAssertTrue(s.expire(now: now.addingTimeInterval(20)))
        XCTAssertEqual(s.visible.map(\.id), ["sticky"])
    }
    func testOverflowDropsOldest() {
        var s = NoticeStack()
        for id in ["a", "b", "c", "d"] { s.post(notice(id), now: now) }
        XCTAssertEqual(s.visible.map(\.id), ["d", "c", "b"])
    }
    func testDismiss() {
        var s = NoticeStack()
        s.post(notice("a"), now: now)
        s.dismiss(id: "a")
        XCTAssertTrue(s.visible.isEmpty)
    }
}
