import XCTest
@testable import RecorderKit

// Адрес API из config.json (переезд 13.10.2026). Ошибка молчаливая: не подменённый облачный
// адрес оставляет рекордер без сервера (402), подменённый чужой уводит записи не туда.
final class IngestBaseTests: XCTestCase {
    func testEmptyBecomesCurrent() {
        XCTAssertEqual(IngestBase.migrated(""), IngestBase.current)
    }

    func testCloudBecomesCurrent() {
        XCTAssertEqual(IngestBase.migrated("https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1"), IngestBase.current)
        XCTAssertEqual(IngestBase.migrated("https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/"), IngestBase.current)
    }

    func testOtherAddressKept() {
        XCTAssertEqual(IngestBase.migrated("https://api.swarm-team.app/functions/v1"), "https://api.swarm-team.app/functions/v1")
        XCTAssertEqual(IngestBase.migrated("http://127.0.0.1:54321/functions/v1"), "http://127.0.0.1:54321/functions/v1")
        XCTAssertEqual(IngestBase.migrated("https://other.supabase.co/functions/v1"), "https://other.supabase.co/functions/v1")
    }
}
