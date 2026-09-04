import XCTest
@testable import RecorderKit

// Проверка «влез ли значок в строку состояния» (issue #232). Ложное «влез» стоит дорого:
// человек остаётся без управления записью и без статуса, и приложение об этом не знает.
final class MenuBarFitTests: XCTestCase {
    private let zone = CGRect(x: 800, y: 950, width: 600, height: 24)

    func testЭлементВнутриЗоныВиден() {
        let item = CGRect(x: 1000, y: 950, width: 120, height: 24)
        XCTAssertTrue(MenuBarFit.isVisible(itemFrame: item, menuBarZone: zone))
    }

    func testЭлементЛевееЗоныСчитаетсяСкрытым() {
        // Уехал под вырез — ровно тот случай, из-за которого значок исчез во время записи.
        let item = CGRect(x: 600, y: 950, width: 120, height: 24)
        XCTAssertFalse(MenuBarFit.isVisible(itemFrame: item, menuBarZone: zone))
    }

    func testЧастичноЗаехавшийПодВырезСчитаетсяСкрытым() {
        let item = CGRect(x: 740, y: 950, width: 120, height: 24)
        XCTAssertFalse(MenuBarFit.isVisible(itemFrame: item, menuBarZone: zone))
    }

    func testНулевойШириныЭлементСкрыт() {
        let item = CGRect(x: 1000, y: 950, width: 0, height: 24)
        XCTAssertFalse(MenuBarFit.isVisible(itemFrame: item, menuBarZone: zone))
    }

    func testБезОкнаЭлементСкрыт() {
        XCTAssertFalse(MenuBarFit.isVisible(itemFrame: nil, menuBarZone: zone))
    }

    func testНаЭкранеБезВырезаСчитаемЧтоМестаХватает() {
        let item = CGRect(x: 1000, y: 950, width: 120, height: 24)
        XCTAssertTrue(MenuBarFit.isVisible(itemFrame: item, menuBarZone: nil))
    }
}
