import XCTest
@testable import RecorderKit

// Автосписки блокнота по началу строки и продолжение по Enter.
final class NotepadMarkupTests: XCTestCase {
    func testKindOfLineNumberedNeedsDotAndSpace() {
        XCTAssertEqual(NotepadMarkup.kind(ofLine: "3. пункт"), .numbered(3))
        XCTAssertNil(NotepadMarkup.kind(ofLine: "3.5 литра"))
        XCTAssertNil(NotepadMarkup.kind(ofLine: "3 пункт"))
    }

    func testAutoListTriggers() {
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "- ")?.kind, .bullet)
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "* ")?.kind, .bullet)
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "[] ")?.kind, .check)
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "[ ] ")?.kind, .check)
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "1. ")?.kind, .numbered(1))
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "12. ")?.kind, .numbered(12))
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "- ")?.replacing, 2)
        XCTAssertEqual(NotepadMarkup.autoList(linePrefix: "[ ] ")?.replacing, 4)
    }

    func testAutoListIgnoresMidLineAndLookalikes() {
        for s in ["", " ", "а - ", "text- ", "-- ", "1 ", "1.5 ", "a. ", "+1. ", "-1. ", "1.", "-", "[x] ", "1.. "] {
            XCTAssertNil(NotepadMarkup.autoList(linePrefix: s), "«\(s)» не должно превращаться в список")
        }
    }

    func testAutoBulletOnlyOnEmptyLine() {
        XCTAssertTrue(NotepadMarkup.autoBullet(line: "", typed: "О"))
        XCTAssertTrue(NotepadMarkup.autoBullet(line: "", typed: "проверить Хорватию"))
        XCTAssertFalse(NotepadMarkup.autoBullet(line: "Отпи", typed: "с"))
        XCTAssertFalse(NotepadMarkup.autoBullet(line: "• ", typed: "О"))
        for t in ["", " ", "\n", "-", "*", "[", "1"] {
            XCTAssertFalse(NotepadMarkup.autoBullet(line: "", typed: t), "«\(t)» не должно получать маркер")
        }
    }

    func testContinuation() {
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "• купить"), .insert("• "))
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "☐ позвонить"), .insert("☐ "))
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "☑ готово"), .insert("☐ "), "новый пункт чек-листа всегда пустой")
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "3. три"), .insert("4. "))
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "обычная строка"), .none)
        XCTAssertEqual(NotepadMarkup.continuation(forLine: ""), .none)
    }

    func testEmptyItemEndsList() {
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "• "), .endList(markerLength: 2))
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "10. "), .endList(markerLength: 4))
        XCTAssertEqual(NotepadMarkup.continuation(forLine: "☐ "), .endList(markerLength: 2))
    }

    func testTaskTitle() {
        XCTAssertEqual(NotepadMarkup.taskTitle(from: "  • Позвонить в Любляну  "), "Позвонить в Любляну")
        XCTAssertEqual(NotepadMarkup.taskTitle(from: "☐ Сверить агрегаторы"), "Сверить агрегаторы")
        XCTAssertEqual(NotepadMarkup.taskTitle(from: "2. второй пункт"), "второй пункт")
        XCTAssertEqual(NotepadMarkup.taskTitle(from: "\n\nперва я\nвторая"), "перва я")
        XCTAssertNil(NotepadMarkup.taskTitle(from: "   \n "))
        XCTAssertNil(NotepadMarkup.taskTitle(from: "• "))
        XCTAssertEqual(NotepadMarkup.taskTitle(from: String(repeating: "я", count: 500))?.count, 200)
    }
}
