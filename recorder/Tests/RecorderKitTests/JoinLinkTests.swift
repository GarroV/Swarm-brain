import XCTest
@testable import RecorderKit

// Второй барьер вокруг ссылки на звонок (#193): её открывает рекордер, а приехала она из
// приглашения, которое мог создать кто угодно.
final class JoinLinkTests: XCTestCase {
    func testAcceptsHttpsMeetingLink() {
        XCTAssertEqual(JoinLink.safeURL("https://meet.google.com/abc-defg-hij")?.absoluteString,
                       "https://meet.google.com/abc-defg-hij")
    }

    func testRejectsEverythingButHttps() {
        for raw in ["javascript:alert(1)", "file:///Users/garva/secret", "http://ktalk.ru/room-42",
                    "ftp://example.com/x", "data:text/html,<script>"] {
            XCTAssertNil(JoinLink.safeURL(raw), raw)
        }
    }

    func testRejectsNothingAndGarbage() {
        for raw in [nil, "", "   ", "не ссылка", "https://"] {
            XCTAssertNil(JoinLink.safeURL(raw), raw ?? "nil")
        }
    }

    func testSchemeCaseDoesNotSmuggleAnythingThrough() {
        // «HTTPS» — та же схема; «JavaScript:» — нет.
        XCTAssertNotNil(JoinLink.safeURL("HTTPS://ktalk.ru/room-42"))
        XCTAssertNil(JoinLink.safeURL("JavaScript:alert(1)"))
    }
}
