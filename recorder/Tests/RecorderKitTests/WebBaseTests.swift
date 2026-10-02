import XCTest
@testable import RecorderKit

// Адрес веба из config.json (issue #753, #758). Ошибка молчаливая: подмена чужого адреса уводит
// людей не туда, а не подменённый пустой оставляет «Открыть Рой» скрытым.
final class WebBaseTests: XCTestCase {
    func testEmptyBecomesCurrent() {
        XCTAssertEqual(WebBase.migrated(""), WebBase.current)
        XCTAssertEqual(WebBase.migrated("  "), WebBase.current)
    }

    func testLegacyBecomesCurrent() {
        XCTAssertEqual(WebBase.migrated("https://swarm-brain.pages.dev"), WebBase.current)
        XCTAssertEqual(WebBase.migrated("https://swarm-brain.pages.dev/"), WebBase.current)
    }

    func testOtherAddressKept() {
        XCTAssertEqual(WebBase.migrated("https://swarm-team.app"), "https://swarm-team.app")
        XCTAssertEqual(WebBase.migrated("http://localhost:3000"), "http://localhost:3000")
        XCTAssertEqual(WebBase.migrated("https://abc.swarm-brain.pages.dev"), "https://abc.swarm-brain.pages.dev")
    }
}
