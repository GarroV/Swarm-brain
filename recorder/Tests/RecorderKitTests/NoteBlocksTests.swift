import XCTest
@testable import RecorderKit

// Блокнот доски из блоков: файл, перенос старого текста, заголовок задачи из строки таблицы.
final class NoteBlocksTests: XCTestCase {
    func testRoundTripKeepsEveryKind() throws {
        let blocks: [NoteBlock] = [.thesis("Отписаться Борису"), .check("Проверить Хорватию", done: true),
                                   .table([["Страна", "Выручка"], ["RS", "12"]])]
        XCTAssertEqual(try NoteBlocks.decode(NoteBlocks.encode(blocks)), blocks)
    }

    func testRoundTripKeepsDoneThesis() throws {
        let blocks: [NoteBlock] = [.thesis("Кассы Словении", done: true), .thesis("Открыто")]
        XCTAssertEqual(try NoteBlocks.decode(NoteBlocks.encode(blocks)), blocks)
    }

    /// Файл первых часов 23.10.2026 (синтезированный Codable) читается без потерь.
    func testDecodesFirstFileFormat() throws {
        let old = #"{"blocks":[{"thesis":{"_0":"Кассы словении"}},{"check":{"_0":"Юрист","done":true}},{"table":{"_0":[["a","b"]]}}],"version":1}"#
        XCTAssertEqual(try NoteBlocks.decode(Data(old.utf8)),
                       [.thesis("Кассы словении"), .check("Юрист", done: true), .table([["a", "b"]])])
    }

    func testDoneToggleKeepsText() {
        XCTAssertEqual(NoteBlock.thesis("а").withDone(true), .thesis("а", done: true))
        XCTAssertEqual(NoteBlock.thesis("а", done: true).withText("б"), .thesis("б", done: true))
        XCTAssertFalse(NoteBlock.table([[""]]).withDone(true).isDone)
    }

    func testDecodeRejectsGarbage() {
        XCTAssertThrowsError(try NoteBlocks.decode(Data("{not json".utf8)))
    }

    func testMigrateOldTextNotepad() {
        let old = "Созвон\n• Отписаться Борису\n\n1. Цены\n☐ Позвонить юристу\n☑ Забронировать\n• \n"
        XCTAssertEqual(NoteBlocks.migrate(plainText: old), [
            .thesis("Созвон"), .thesis("Отписаться Борису"), .thesis("Цены"),
            .check("Позвонить юристу", done: false), .check("Забронировать", done: true),
        ])
    }

    func testEmptyNotepadHasOneEmptyThesis() {
        XCTAssertEqual(NoteBlocks.migrate(plainText: "\n \n"), [.empty])
        XCTAssertEqual(NoteBlocks.normalized([]), [.empty])
    }

    func testTableRowTaskTitle() {
        XCTAssertEqual(NoteBlocks.taskTitle(row: ["RS", " ", "сверить выручку"]), "RS — сверить выручку")
        XCTAssertNil(NoteBlocks.taskTitle(row: ["", "  "]))
    }

    func testConvertKeepsText() {
        XCTAssertEqual(NoteBlock.thesis("а").withText("б"), .thesis("б"))
        XCTAssertEqual(NoteBlock.check("а", done: true).withText("б"), .check("б", done: true))
        XCTAssertEqual(NoteBlock.newTable(rows: 1, columns: 2), .table([["", ""]]))
    }
}
