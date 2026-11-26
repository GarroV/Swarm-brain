import XCTest
@testable import RecorderKit

final class BrowserMeetingLinkTests: XCTestCase {
    private let room = "https://meet.google.com/abc-defg-hij"
    private let target = "https://accounts.google.com/AccountChooser?Email=work%40example.com&continue=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij%3Fauthuser%3Dwork%2540example.com"

    func testBothApiDecodersUseWorkAccountEntry() throws {
        for convert in [false, true] {
            let decoder = JSONDecoder()
            if convert { decoder.keyDecodingStrategy = .convertFromSnakeCase }
            let data = try JSONSerialization.data(withJSONObject: ["join_url": room, "open_url": target])
            let link = try decoder.decode(BrowserMeetingLink.self, from: data)
            XCTAssertEqual(link.url?.absoluteString, target)
        }
    }

    func testExplicitNullAndUnsafeEntryDoNotFallBack() throws {
        for value: Any in [NSNull(), "javascript:alert(1)", "http://meet.google.com/x"] {
            let data = try JSONSerialization.data(withJSONObject: ["join_url": room, "open_url": value])
            XCTAssertNil(try JSONDecoder().decode(BrowserMeetingLink.self, from: data).url)
        }
    }

    func testOlderServerUsesOriginalLink() throws {
        let data = try JSONSerialization.data(withJSONObject: ["join_url": room])
        XCTAssertEqual(try JSONDecoder().decode(BrowserMeetingLink.self, from: data).url?.absoluteString, room)
    }

    func testBoardDecodesWorkAccountLinkAndBlockedEntry() throws {
        for value: Any in [target, NSNull()] {
            let data = try JSONSerialization.data(withJSONObject: ["meetings": [["id": "m1", "title": "Meeting",
                "starts_at": "2026-11-24T10:00:00Z", "ends_at": "2026-11-24T11:00:00Z", "join_url": room, "open_url": value]]])
            let snapshot = try XCTUnwrap(BoardSnapshot.parse(data))
            XCTAssertEqual(snapshot.meetings.count, 1)
            XCTAssertEqual(snapshot.meetings.first?.joinURL, value as? String)
        }
    }
}
