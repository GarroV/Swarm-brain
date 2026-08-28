import XCTest
@testable import RecorderKit

// Строка состояния: «что пишется прямо сейчас» у значка bumblebee.
// Канон — docs/decisions/2026-08-28-status-bar-on-air.md (решение владельца 28.08.2026).
final class StatusBarTitleTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_756_000_000)

    func testПокойБезТекста() {
        XCTAssertNil(StatusBarTitle.text(recording: false, title: "Планёрка", endsAt: now.addingTimeInterval(600), now: now))
    }

    func testНазваниеИОстаток() {
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: "VC", endsAt: now.addingTimeInterval(49 * 60), now: now),
            "VC · 49m left")
    }

    func testОстатокБольшеЧаса() {
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: "VC", endsAt: now.addingTimeInterval(77 * 60), now: now),
            "VC · 1h 17m left")
    }

    func testРовныйЧасБезНулевыхМинут() {
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: "VC", endsAt: now.addingTimeInterval(60 * 60), now: now),
            "VC · 1h left")
    }

    // Решение владельца: «0m left» и отрицательный остаток запрещены — они врут.
    func testВремяВышлоЗначитОnAir() {
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: "VC", endsAt: now.addingTimeInterval(-5 * 60), now: now),
            "VC · ON AIR")
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: "VC", endsAt: now, now: now),
            "VC · ON AIR")
    }

    // Меньше минуты — всё ещё «1m left», а не «0m left».
    func testМенееМинутыОкругляетсяВверх() {
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: "VC", endsAt: now.addingTimeInterval(20), now: now),
            "VC · 1m left")
    }

    func testЗвонокБезКалендаряТолькоOnAir() {
        XCTAssertEqual(StatusBarTitle.text(recording: true, title: nil, endsAt: nil, now: now), "ON AIR")
        XCTAssertEqual(StatusBarTitle.text(recording: true, title: "   ", endsAt: nil, now: now), "ON AIR")
    }

    func testКалендарнаяБезКонцаТожеOnAir() {
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: "Планёрка", endsAt: nil, now: now),
            "Планёрка · ON AIR")
    }

    // 15 символов — решение владельца: menu bar не переносит и не сжимает, лишняя ширина
    // выдавливает соседние иконки под чёлку.
    func testДлинноеНазваниеОбрезаетсяДо15() {
        let out = StatusBarTitle.text(
            recording: true, title: "Ro. Training system status",
            endsAt: now.addingTimeInterval(49 * 60), now: now)
        XCTAssertEqual(out, "Ro. Training s… · 49m left")
    }

    func testРовно15СимволовНеОбрезается() {
        let name = String(repeating: "a", count: 15)
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: name, endsAt: nil, now: now),
            "\(name) · ON AIR")
    }

    func testПереносыИЛишниеПробелыВНазванииНеЛомаютСтроку() {
        XCTAssertEqual(
            StatusBarTitle.text(recording: true, title: " Пла\nнёрка ", endsAt: nil, now: now),
            "Пла нёрка · ON AIR")
    }
}
