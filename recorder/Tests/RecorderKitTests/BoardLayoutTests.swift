import XCTest
@testable import RecorderKit

// Раскладка доски: длинный столбец — тому, чего заметно больше.
final class BoardLayoutTests: XCTestCase {
    func testBalancedStaysStacked() {
        XCTAssertEqual(BoardLayout.arrangement(tasks: 3, meetings: 3, showMeetings: true), .stacked)
        XCTAssertEqual(BoardLayout.arrangement(tasks: 4, meetings: 2, showMeetings: true), .stacked)
        XCTAssertEqual(BoardLayout.arrangement(tasks: 0, meetings: 2, showMeetings: true), .stacked)
    }

    func testManyTasksGoLeftColumn() {
        XCTAssertEqual(BoardLayout.arrangement(tasks: 5, meetings: 2, showMeetings: true), .tasksColumn)
        XCTAssertEqual(BoardLayout.arrangement(tasks: 3, meetings: 0, showMeetings: false), .tasksColumn)
    }

    func testManyMeetingsPutNotesLeft() {
        XCTAssertEqual(BoardLayout.arrangement(tasks: 0, meetings: 3, showMeetings: true), .notesColumn)
        XCTAssertEqual(BoardLayout.arrangement(tasks: 1, meetings: 6, showMeetings: true), .notesColumn)
    }

    func testHiddenMeetingsNeverPutNotesLeft() {
        XCTAssertEqual(BoardLayout.arrangement(tasks: 0, meetings: 9, showMeetings: false), .stacked)
    }
}
