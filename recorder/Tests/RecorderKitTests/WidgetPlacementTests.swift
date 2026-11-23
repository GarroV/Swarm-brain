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
        let o = WidgetPlacement.origin(savedInset: nil, size: size, in: wideScreen)

        let withoutLift = wideScreen.maxY - wideScreen.height * WidgetPlacement.topFraction - size.height
        XCTAssertEqual(o.y, withoutLift + WidgetPlacement.defaultLift, accuracy: 0.5,
                       "дефолт не поднят на два фрейма")
    }

    // На узком экране подъём законно срезается ограничителем сверху — но именно
    // ограничителем, а не «подъёма не было»: окно обязано встать вплотную к границе.
    func testLiftIsClampedByTheHeaderBandOnANarrowScreen() {
        let o = WidgetPlacement.origin(savedInset: nil, size: size, in: screen)

        XCTAssertEqual(o.y + size.height, screen.maxY - WidgetPlacement.headerBand, accuracy: 0.5)
    }

    func testDefaultStaysBelowTheMenuBarAndAboveTheDock() {
        let o = WidgetPlacement.origin(savedInset: nil, size: size, in: screen)

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

        let pillTop = WidgetPlacement.origin(savedInset: nil, size: size, in: screen).y + size.height
        let bannerTop = WidgetPlacement.origin(savedInset: nil, size: banner, in: screen).y + banner.height

        XCTAssertEqual(pillTop, bannerTop, accuracy: 0.5, "верх капсулы и баннера разъехался")
    }

    // Маленький экран: подъём не должен выталкивать окно за верхнюю границу.
    func testLiftIsClampedOnAShortScreen() {
        let short = CGRect(x: 0, y: 0, width: 1280, height: 620)

        let o = WidgetPlacement.origin(savedInset: nil, size: size, in: short)

        XCTAssertLessThanOrEqual(o.y + size.height, short.maxY - WidgetPlacement.headerBand)
        XCTAssertGreaterThanOrEqual(o.y, short.minY, "окно уехало за нижний край")
    }

    func testDefaultHugsTheRightEdge() {
        let o = WidgetPlacement.origin(savedInset: nil, size: size, in: screen, rightInset: 18)

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

    // ── Память места: отступ от правого верхнего угла экрана (12.11.2026) ───────────────

    func testSavedInsetIsMeasuredFromTheTopRightCorner() {
        let frame = CGRect(x: 1200, y: 600, width: 72, height: 110)

        let inset = WidgetPlacement.inset(of: frame, in: screen)

        XCTAssertEqual(inset, WidgetInset(right: screen.maxX - frame.maxX, top: screen.maxY - frame.maxY))
    }

    func testSavedPositionWins() {
        let inset = WidgetInset(right: 300, top: 250)

        let o = WidgetPlacement.origin(savedInset: inset, size: size, in: screen)

        XCTAssertEqual(o, CGPoint(x: screen.maxX - 300 - size.width, y: screen.maxY - 250 - size.height),
                       "перетащенную позицию обязаны помнить")
    }

    // Главное требование: тот же угол на любом мониторе. Капсулу оставили в 300 пт от правого
    // и 250 пт от верхнего края — на другом мониторе (другой размер, другое начало координат
    // в общем пространстве) она в тех же 300 и 250 пт от ТЕХ ЖЕ углов.
    func testSameCornerOnAnotherMonitor() {
        let inset = WidgetPlacement.inset(of: CGRect(x: 1140 - 72, y: 625 - 110, width: 72, height: 110),
                                          in: screen)
        let second = CGRect(x: 1440, y: -300, width: 2560, height: 1380)   // второй монитор справа

        let o = WidgetPlacement.origin(savedInset: inset, size: size, in: second)

        XCTAssertEqual(second.maxX - (o.x + size.width), inset.right, accuracy: 0.5, "ушла от правого угла")
        XCTAssertEqual(second.maxY - (o.y + size.height), inset.top, accuracy: 0.5, "ушла от верхнего угла")
        XCTAssertTrue(second.contains(CGRect(origin: o, size: size)), "капсула вне монитора")
    }

    // Регресс 03.11.2026: цикл «капсула → баннер → капсула» не должен сдвигать место. Угол,
    // от которого окно растёт, при смене режима неподвижен, значит и отступ тот же.
    func testBannerPillCyclesDoNotChangeTheInset() {
        let banner = CGSize(width: 300, height: 102)
        let start = WidgetPlacement.origin(savedInset: WidgetInset(right: 40, top: 200), size: size, in: screen)
        let expected = WidgetPlacement.inset(of: CGRect(origin: start, size: size), in: screen)
        var pill = CGRect(origin: start, size: size)

        for _ in 0..<5 {
            let bannerFrame = CGRect(origin: WidgetPlacement.morphOrigin(from: pill, to: banner, in: screen),
                                     size: banner)
            let inset = WidgetPlacement.inset(of: bannerFrame, in: screen)
            pill = CGRect(origin: WidgetPlacement.origin(savedInset: inset, size: size, in: screen), size: size)
        }

        XCTAssertEqual(WidgetPlacement.inset(of: pill, in: screen), expected, "капсула дрейфует")
    }

    // Отступ от большого монитора на маленьком не должен выталкивать окно за экран.
    func testSavedInsetBiggerThanTheScreenIsClamped() {
        let o = WidgetPlacement.origin(savedInset: WidgetInset(right: 5000, top: 5000), size: size, in: screen)

        XCTAssertEqual(o.x, screen.minX, accuracy: 0.5, "левый край за экраном")
        XCTAssertEqual(o.y, screen.minY, accuracy: 0.5, "низ за экраном")
    }

    func testNonFiniteInsetFallsBackToDefault() {
        let o = WidgetPlacement.origin(savedInset: WidgetInset(right: .nan, top: 100), size: size, in: screen)

        XCTAssertEqual(o, WidgetPlacement.origin(savedInset: nil, size: size, in: screen))
    }

    func testInsetOfAWindowPartlyOffScreenIsNotNegative() {
        let frame = CGRect(x: screen.maxX - 40, y: screen.maxY - 50, width: 72, height: 110)

        let inset = WidgetPlacement.inset(of: frame, in: screen)

        XCTAssertEqual(inset, WidgetInset(right: 0, top: 0))
    }

    // ── Хранение: строка в UserDefaults ───────────────────────────────────────────────

    func testInsetRoundTripsThroughItsStoredString() {
        let inset = WidgetInset(right: 12.5, top: 340)

        XCTAssertEqual(WidgetInset(stored: inset.stored), inset)
    }

    // Старое значение (`widget.topRight`, сборка 39) лежало в формате NSStringFromPoint —
    // «{1710, 900}». Новый разбор его не принимает: абсолютные координаты возвращают баг.
    func testLegacyAbsoluteAnchorIsNotAccepted() {
        XCTAssertNil(WidgetInset(stored: "{1710, 900}"))
        XCTAssertNil(WidgetInset(stored: "709,300,1"))
        XCTAssertNil(WidgetInset(stored: "-5,10"))
        XCTAssertNil(WidgetInset(stored: "nan,10"))
        XCTAssertNil(WidgetInset(stored: ""))
    }
}
