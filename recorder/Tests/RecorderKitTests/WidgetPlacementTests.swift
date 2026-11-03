import XCTest
@testable import RecorderKit

// Куда садится капсула. Issue #197: дефолт приходился на правый верх, ровно в полосу
// управления веб-приложений (аватары, счётчики, кнопки) — капсула их накрывала. И позиция
// не помнилась: человек оттаскивал её каждый запуск заново.
final class WidgetPlacementTests: XCTestCase {
    // Экран 1440×900 с занятым меню-баром — привычная рабочая геометрия. На нём подъём
    // на два фрейма НЕ проходит целиком: упирается в воздух под меню-баром (headerBand),
    // и это правильное поведение — см. testLiftIsClampedOnAShortScreen.
    private let screen = CGRect(x: 0, y: 0, width: 1440, height: 875)
    // Рабочий монитор владельца (visibleFrame, замерено `--selftest-widget` 03.09.2026):
    // на нём подъём проходит полностью, поэтому именно здесь проверяем сам подъём.
    private let wideScreen = CGRect(x: 0, y: 51, width: 1710, height: 1022)
    private let size = CGSize(width: 72, height: 110)

    // Владелец 03.09.2026: «надо виджет поднять чуть выше, я думаю на 2 таких же фрейма».
    // Прежнее требование «верх не выше 200 пунктов от края» (#197) этим и снято — оно
    // физически несовместимо с подъёмом, см. комментарий в WidgetPlacement.
    func testDefaultIsLiftedByTwoBannerHeights() {
        let o = WidgetPlacement.origin(savedTopRight: nil, size: size, in: wideScreen)

        let withoutLift = wideScreen.maxY - wideScreen.height * WidgetPlacement.topFraction - size.height
        XCTAssertEqual(o.y, withoutLift + WidgetPlacement.defaultLift, accuracy: 0.5,
                       "дефолт не поднят на два фрейма")
    }

    // На узком экране подъём законно срезается ограничителем сверху — но именно
    // ограничителем, а не «подъёма не было»: окно обязано встать вплотную к границе.
    func testLiftIsClampedByTheHeaderBandOnANarrowScreen() {
        let o = WidgetPlacement.origin(savedTopRight: nil, size: size, in: screen)

        XCTAssertEqual(o.y + size.height, screen.maxY - WidgetPlacement.headerBand, accuracy: 0.5)
    }

    func testDefaultStaysBelowTheMenuBarAndAboveTheDock() {
        let o = WidgetPlacement.origin(savedTopRight: nil, size: size, in: screen)

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

        let pillTop = WidgetPlacement.origin(savedTopRight: nil, size: size, in: screen).y + size.height
        let bannerTop = WidgetPlacement.origin(savedTopRight: nil, size: banner, in: screen).y + banner.height

        XCTAssertEqual(pillTop, bannerTop, accuracy: 0.5, "верх капсулы и баннера разъехался")
    }

    // Маленький экран: подъём не должен выталкивать окно за верхнюю границу.
    func testLiftIsClampedOnAShortScreen() {
        let short = CGRect(x: 0, y: 0, width: 1280, height: 620)

        let o = WidgetPlacement.origin(savedTopRight: nil, size: size, in: short)

        XCTAssertLessThanOrEqual(o.y + size.height, short.maxY - WidgetPlacement.headerBand)
        XCTAssertGreaterThanOrEqual(o.y, short.minY, "окно уехало за нижний край")
    }

    func testDefaultHugsTheRightEdge() {
        let o = WidgetPlacement.origin(savedTopRight: nil, size: size, in: screen, rightInset: 18)

        XCTAssertEqual(o.x, screen.maxX - size.width - 18, accuracy: 0.5)
    }

    // ── Переход между режимами (капсула ↔ баннер): окно одно, значит и место одно ──────────

    func testMorphKeepsTheRightEdge() {
        let pill = CGRect(x: 1350, y: 700, width: 72, height: 110)   // внутри screen
        let banner = CGSize(width: 300, height: 102)

        let o = WidgetPlacement.morphOrigin(from: pill, to: banner, in: screen)

        XCTAssertEqual(o.x + banner.width, pill.maxX, accuracy: 0.5, "правый край съехал")
    }

    func testMorphKeepsTheTopLine() {
        let pill = CGRect(x: 1350, y: 700, width: 72, height: 110)   // внутри screen
        let banner = CGSize(width: 300, height: 102)

        let o = WidgetPlacement.morphOrigin(from: pill, to: banner, in: screen)

        XCTAssertEqual(o.y + banner.height, pill.maxY, accuracy: 0.5, "верх окна съехал")
    }

    // Окно перетащили к левому краю: расти влево некуда — прижимаемся, но за экран не уходим.
    func testMorphClampsAtTheLeftEdge() {
        let pill = CGRect(x: 4, y: 500, width: 72, height: 110)
        let banner = CGSize(width: 300, height: 102)

        let o = WidgetPlacement.morphOrigin(from: pill, to: banner, in: screen)

        XCTAssertGreaterThanOrEqual(o.x, screen.minX, "окно уехало за левый край")
    }

    // Переход в обратную сторону (баннер → капсула) обязан быть симметричным: правый край
    // и верх на месте, иначе капсула «отпрыгивает» от того места, где человек её видел.
    func testMorphIsSymmetricBackToPill() {
        let banner = CGRect(x: 1122, y: 700, width: 300, height: 102)   // внутри screen
        let pill = CGSize(width: 72, height: 110)

        let o = WidgetPlacement.morphOrigin(from: banner, to: pill, in: screen)

        XCTAssertEqual(o.x + pill.width, banner.maxX, accuracy: 0.5)
        XCTAssertEqual(o.y + pill.height, banner.maxY, accuracy: 0.5)
    }

    func testSavedPositionWins() {
        let anchor = CGPoint(x: 372, y: 510)   // правый верхний угол перетащенной капсулы

        let o = WidgetPlacement.origin(savedTopRight: anchor, size: size, in: screen)

        XCTAssertEqual(o, CGPoint(x: anchor.x - size.width, y: anchor.y - size.height),
                       "перетащенную позицию обязаны помнить")
    }

    func testBannerPillCyclesDoNotDriftWindowLeft() {
        // Регресс 03.11.2026: капсула за несколько дней уползла с правого края в середину.
        // Цикл: капсула → баннер (растёт влево) → запомнили → скрыли → снова капсула.
        let banner = CGSize(width: 300, height: 102)
        let start = WidgetPlacement.origin(savedTopRight: nil, size: size, in: screen)
        var pill = CGRect(origin: start, size: size)

        for _ in 0..<5 {
            let bannerFrame = CGRect(origin: WidgetPlacement.morphOrigin(from: pill, to: banner, in: screen),
                                     size: banner)
            let anchor = CGPoint(x: bannerFrame.maxX, y: bannerFrame.maxY)   // что сохраняет окно
            pill = CGRect(origin: WidgetPlacement.origin(savedTopRight: anchor, size: size, in: screen),
                          size: size)
        }

        XCTAssertEqual(pill.origin.x, start.x, accuracy: 0.5, "капсула дрейфует влево")
        XCTAssertEqual(pill.maxY, start.y + size.height, accuracy: 0.5, "капсула дрейфует по вертикали")
    }

    func testSavedPositionIsPulledBackOnScreen() {
        // Капсула была у правого края широкого монитора, монитор отключили.
        let anchor = CGPoint(x: 1420 + size.width, y: 800 + size.height)

        let o = WidgetPlacement.origin(savedTopRight: anchor, size: size, in: screen)

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
        let anchor = CGPoint(x: -1900 + size.width, y: 300 + size.height)

        let o = WidgetPlacement.origin(savedTopRight: anchor, size: size, in: screen)

        XCTAssertEqual(o, WidgetPlacement.origin(savedTopRight: nil, size: size, in: screen))
        XCTAssertEqual(o.x, screen.maxX - size.width - 18, accuracy: 0.5, "капсула осталась за пределами экрана")
    }
}
