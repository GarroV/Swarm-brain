import XCTest
@testable import RecorderKit

// Раскладка доски: задачи слева, встречи справа, блокнот — под коротким столбцом.
final class BoardLayoutTests: XCTestCase {
    func testNotesGoUnderShorterColumn() {
        XCTAssertEqual(BoardLayout.arrangement(tasks: 3, meetings: 10, showMeetings: true), .notesUnderTasks)
        XCTAssertEqual(BoardLayout.arrangement(tasks: 6, meetings: 2, showMeetings: true), .notesUnderMeetings)
    }

    func testEqualKeepsNotesUnderTasks() {
        XCTAssertEqual(BoardLayout.arrangement(tasks: 3, meetings: 3, showMeetings: true), .notesUnderTasks)
        XCTAssertEqual(BoardLayout.arrangement(tasks: 0, meetings: 0, showMeetings: true), .notesUnderTasks)
    }

    func testHiddenMeetingsPutNotesUnderTasksFullWidth() {
        XCTAssertEqual(BoardLayout.arrangement(tasks: 0, meetings: 9, showMeetings: false), .tasksOnly)
        XCTAssertEqual(BoardLayout.arrangement(tasks: 9, meetings: 0, showMeetings: false), .tasksOnly)
    }
}
