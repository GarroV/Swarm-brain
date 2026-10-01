import XCTest
@testable import RecorderKit

// Неотправленные live-пометки не теряются (issue #613).
final class LiveNotesOutboxTests: XCTestCase {
    func testAcceptedNoteIsSent() {
        XCTAssertEqual(LiveNotesOutbox.delivery(forStatus: 200), .sent)
        XCTAssertEqual(LiveNotesOutbox.delivery(forStatus: 201), .sent)
    }

    func testNetworkAndTemporaryFailuresAreRetried() {
        // Сеть, протухший токен, перегрузка, сбой сервера — повтор, а не потеря.
        for code in [nil, 401, 408, 429, 500, 502, 503] as [Int?] {
            XCTAssertEqual(LiveNotesOutbox.delivery(forStatus: code), .retry, "код \(String(describing: code))")
        }
    }

    func testPermanentRefusalIsDropped() {
        // Встречи нет, прав нет, кривые данные — сколько ни повторяй, не примут.
        for code in [400, 403, 404, 409, 422] {
            XCTAssertEqual(LiveNotesOutbox.delivery(forStatus: code), .drop, "код \(code)")
        }
    }

    func testMergeDoesNotDuplicate() {
        let a = PendingNote(meetingId: "m1", offset: 10, text: "раз")
        let b = PendingNote(meetingId: "m1", offset: 20, text: "два")
        XCTAssertEqual(LiveNotesOutbox.merge([a], [a, b]), [a, b])
    }

    func testRoundTripAndBrokenFile() {
        let notes = [PendingNote(meetingId: "m1", offset: 5, text: "пометка")]
        let data = LiveNotesOutbox.encode(notes)
        XCTAssertNotNil(data)
        XCTAssertEqual(LiveNotesOutbox.decode(data ?? Data()), notes)
        XCTAssertEqual(LiveNotesOutbox.decode(Data("not json".utf8)), [])
    }
}
