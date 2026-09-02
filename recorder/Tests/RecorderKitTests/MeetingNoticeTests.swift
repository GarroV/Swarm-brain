import XCTest
@testable import RecorderKit

// Уведомление о встрече: что человек читает в баннере.
// Issue #193, решение владельца 02.09.2026: «хочу чтобы уведомления выглядели лаконичнее,
// аккуратнее, мягче + чтобы была кнопка перехода на встречу».
//
// Отсюда правила: НАЗВАНИЕ встречи — заголовок (главное, что человек ищет глазами), время
// слота видно целиком, служебных формулировок («— записать?») нет. Было:
//   title «Встреча через 5 мин» / body «„Weekly BD sync“ — записать?»
final class MeetingNoticeTests: XCTestCase {
    private let msk = TimeZone(identifier: "Europe/Belgrade")!
    private let ru = Locale(identifier: "ru_RU")

    /// 2026-09-02, 08:55 по Белграду.
    private func at(_ hour: Int, _ minute: Int) -> Date {
        var c = DateComponents()
        c.year = 2026; c.month = 9; c.day = 2; c.hour = hour; c.minute = minute
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = msk
        return cal.date(from: c)!
    }

    func testTitleIsTheMeetingNameAndSubtitleCarriesSlotAndCountdown() {
        let n = MeetingNotice.compose(title: "Weekly BD sync", start: at(9, 0), end: at(10, 0),
                                      now: at(8, 55), locale: ru, timeZone: msk)

        XCTAssertEqual(n.title, "Weekly BD sync")
        XCTAssertEqual(n.subtitle, "09:00 – 10:00 · через 5 мин")
    }

    func testOngoingMeetingSaysItIsRunning() {
        let n = MeetingNotice.compose(title: "Weekly BD sync", start: at(9, 0), end: at(10, 0),
                                      now: at(9, 12), locale: ru, timeZone: msk)

        XCTAssertEqual(n.subtitle, "09:00 – 10:00 · идёт")
    }

    func testLessThanAMinuteNeverSaysZero() {
        // «через 0 мин» врёт — как и `0m left` в строке состояния.
        let n = MeetingNotice.compose(title: "Стендап", start: at(9, 0), end: at(9, 15),
                                      now: at(8, 59), locale: ru, timeZone: msk)

        XCTAssertEqual(n.subtitle, "09:00 – 09:15 · через 1 мин")
    }

    func testMeetingWithoutNameStillReadsLikeAMeeting() {
        let n = MeetingNotice.compose(title: nil, start: at(9, 0), end: at(10, 0),
                                      now: at(8, 55), locale: ru, timeZone: msk)

        XCTAssertEqual(n.title, "Встреча")
        XCTAssertEqual(n.subtitle, "09:00 – 10:00 · через 5 мин")
    }

    func testBlankNameCountsAsNoName() {
        let n = MeetingNotice.compose(title: "   ", start: nil, end: nil,
                                      now: at(9, 0), locale: ru, timeZone: msk)

        XCTAssertEqual(n.title, "Встреча")
    }

    func testCallWithoutCalendarHasNoSlotToShow() {
        // Звонок без календаря: времени слота не существует, выдумывать нечего.
        let n = MeetingNotice.compose(title: "Идёт звонок", start: nil, end: nil,
                                      now: at(9, 0), locale: ru, timeZone: msk)

        XCTAssertEqual(n.subtitle, "идёт")
    }

    func testOpenEndedMeetingShowsOnlyItsStart() {
        let n = MeetingNotice.compose(title: "Созвон", start: at(9, 0), end: nil,
                                      now: at(8, 50), locale: ru, timeZone: msk)

        XCTAssertEqual(n.subtitle, "09:00 · через 10 мин")
    }

    func testSlotFollowsTheLocale() {
        // Продукт двуязычный: в английской локали время читается по-английски.
        let n = MeetingNotice.compose(title: "Weekly BD sync", start: at(9, 0), end: at(10, 0),
                                      now: at(9, 12), locale: Locale(identifier: "en_US"), timeZone: msk)

        // Буквально сравнивать нельзя: в 12-часовом формате macOS ставит перед AM узкий
        // неразрывный пробел (U+202F), и тест ломался бы от версии ICU, а не от кода.
        XCTAssertTrue(n.subtitle.contains("AM"), "английская локаль без AM/PM: «\(n.subtitle)»")
        XCTAssertTrue(n.subtitle.contains("10:00"), "нет конца слота: «\(n.subtitle)»")

        let sameSlotInRussian = MeetingNotice.compose(title: "Weekly BD sync", start: at(9, 0), end: at(10, 0),
                                                      now: at(9, 12), locale: ru, timeZone: msk).subtitle
        XCTAssertFalse(sameSlotInRussian.contains("AM"), "русская локаль обязана быть 24-часовой")
    }
}
