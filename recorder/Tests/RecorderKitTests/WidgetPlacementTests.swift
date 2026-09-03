import XCTest
@testable import RecorderKit

// Куда садится капсула. Issue #197: дефолт приходился на правый верх, ровно в полосу
// управления веб-приложений (аватары, счётчики, кнопки) — капсула их накрывала. И позиция
// не помнилась: человек оттаскивал её каждый запуск заново.
final class WidgetPlacementTests: XCTestCase {
    // Экран 1440×900 с занятым меню-баром — привычная рабочая геометрия.
    private let screen = CGRect(x: 0, y: 0, width: 1440, height: 875)
    private let size = CGSize(width: 72, height: 110)

    // Владелец 03.09.2026: «надо виджет поднять чуть выше, я думаю на 2 таких же фрейма».
    // Прежнее требование «верх не выше 200 пунктов от края» (#197) этим и снято — оно
    // физически несовместимо с подъёмом, см. комментарий в WidgetPlacement.
    func testDefaultIsLiftedByTwoBannerHeights() {
        let o = WidgetPlacement.origin(saved: nil, size: size, in: screen)

        let withoutLift = screen.maxY - screen.height * WidgetPlacement.topFraction - size.height
        XCTAssertEqual(o.y, withoutLift + WidgetPlacement.defaultLift, accuracy: 0.5,
                       "дефолт не поднят на два фрейма")
    }

    func testDefaultStaysBelowTheMenuBarAndAboveTheDock() {
        let o = WidgetPlacement.origin(saved: nil, size: size, in: screen)

        // Под меню-бар не залезаем: подъём ограничен воздухом сверху.
        XCTAssertLessThanOrEqual(o.y + size.height, screen.maxY - WidgetPlacement.headerBand,
                                 "окно ушло под меню-бар")
        // И не сползает к доку — там оно мешает не меньше.
        XCTAssertGreaterThanOrEqual(o.y, screen.minY + 120, "окно сползло в док")
    }

    // Капсула (72×110) и баннер встречи (300×84) обязаны вставать на ОДНУ линию по верху:
    // подъём задан в пунктах, а не в размерах окна, иначе при переключении режима окно
    // прыгало бы по вертикали само собой.
    func testPillAndBannerShareTheSameTopLine() {
        let banner = CGSize(width: 300, height: 84)

        let pillTop = WidgetPlacement.origin(saved: nil, size: size, in: screen).y + size.height
        let bannerTop = WidgetPlacement.origin(saved: nil, size: banner, in: screen).y + banner.height

        XCTAssertEqual(pillTop, bannerTop, accuracy: 0.5, "верх капсулы и баннера разъехался")
    }

    // Маленький экран: подъём не должен выталкивать окно за верхнюю границу.
    func testLiftIsClampedOnAShortScreen() {
        let short = CGRect(x: 0, y: 0, width: 1280, height: 620)

        let o = WidgetPlacement.origin(saved: nil, size: size, in: short)

        XCTAssertLessThanOrEqual(o.y + size.height, short.maxY - WidgetPlacement.headerBand)
        XCTAssertGreaterThanOrEqual(o.y, short.minY, "окно уехало за нижний край")
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
