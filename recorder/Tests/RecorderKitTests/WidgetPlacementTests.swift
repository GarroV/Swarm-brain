import XCTest
@testable import RecorderKit

// Куда садится капсула. Issue #197: дефолт приходился на правый верх, ровно в полосу
// управления веб-приложений (аватары, счётчики, кнопки) — капсула их накрывала. И позиция
// не помнилась: человек оттаскивал её каждый запуск заново.
final class WidgetPlacementTests: XCTestCase {
    // Экран 1440×900 с занятым меню-баром — привычная рабочая геометрия.
    private let screen = CGRect(x: 0, y: 0, width: 1440, height: 875)
    private let size = CGSize(width: 72, height: 110)

    func testDefaultSitsBelowTheHeaderStrip() {
        let o = WidgetPlacement.origin(saved: nil, size: size, in: screen)

        // Верх капсулы уходит вниз минимум на 200 пунктов от верха экрана: полоса аватаров,
        // счётчиков и кнопок веб-приложений живёт выше этой границы.
        XCTAssertLessThanOrEqual(o.y + size.height, screen.maxY - 200,
                                 "капсула всё ещё в полосе управления")
        // Но и не сползает к доку — там она мешает не меньше.
        XCTAssertGreaterThanOrEqual(o.y, screen.minY + 120, "капсула сползла в док")
    }

    func testDefaultHugsTheRightEdge() {
        let o = WidgetPlacement.origin(saved: nil, size: size, in: screen, rightInset: 18)

        XCTAssertEqual(o.x, screen.maxX - size.width - 18, accuracy: 0.5)
    }

    func testSavedPositionWins() {
        let saved = CGPoint(x: 300, y: 400)

        let o = WidgetPlacement.origin(saved: saved, size: size, in: screen)

        XCTAssertEqual(o, saved, "перетащенную позицию обязаны помнить")
    }

    func testSavedPositionIsPulledBackOnScreen() {
        // Капсула была у правого края широкого монитора, монитор отключили.
        let saved = CGPoint(x: 1420, y: 800)

        let o = WidgetPlacement.origin(saved: saved, size: size, in: screen)

        XCTAssertLessThanOrEqual(o.x + size.width, screen.maxX, "правый край за экраном")
        XCTAssertLessThanOrEqual(o.y + size.height, screen.maxY, "верх за экраном")
        // Именно втягиваем к ближайшему краю, а не отправляем в дефолт: человек поставил
        // капсулу справа наверху — там она и остаётся, просто целиком видимой.
        XCTAssertEqual(o.x, screen.maxX - size.width, accuracy: 0.5)
        XCTAssertEqual(o.y, screen.maxY - size.height, accuracy: 0.5)
    }

    func testSavedPositionOnAVanishedScreenFallsBackToDefault() {
        // Внешний монитор слева отключён — сохранённые координаты отрицательные и с текущим
        // экраном не пересекаются вообще. Капсула обязана вернуться на видимое место,
        // иначе человек решит, что приложение умерло.
        let saved = CGPoint(x: -1900, y: 300)

        let o = WidgetPlacement.origin(saved: saved, size: size, in: screen)

        XCTAssertEqual(o, WidgetPlacement.origin(saved: nil, size: size, in: screen))
        XCTAssertNotEqual(o, saved, "капсула осталась за пределами экрана")
    }
}
