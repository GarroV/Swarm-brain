import XCTest
@testable import RecorderKit

final class NoteSweepTests: XCTestCase {
    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Belgrade")!
        return c
    }()

    private func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        cal.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    func testDueOnceAfterNineNextDay() {
        let swept = at(23, 22)
        XCTAssertFalse(NoteSweep.isDue(lastSweep: swept, now: at(24, 8, 59), calendar: cal))
        XCTAssertTrue(NoteSweep.isDue(lastSweep: swept, now: at(24, 9), calendar: cal))
        XCTAssertTrue(NoteSweep.isDue(lastSweep: swept, now: at(26, 15), calendar: cal))   // Мак спал два дня
        XCTAssertFalse(NoteSweep.isDue(lastSweep: at(24, 9, 1), now: at(24, 18), calendar: cal))
    }

    func testFirstRunDoesNotSweep() {
        XCTAssertFalse(NoteSweep.isDue(lastSweep: nil, now: at(24, 12), calendar: cal))
    }

    func testSweptBeforeNineSameDayStillDue() {
        XCTAssertTrue(NoteSweep.isDue(lastSweep: at(24, 7), now: at(24, 9, 30), calendar: cal))
    }

    func testRemovesDoneThesesAndChecksKeepsTables() {
        let blocks: [NoteBlock] = [
            .thesis("а", done: true), .thesis("б"),
            .title("Поездка"), .check("билеты", done: true), .check("отель", done: false),
            .title("Готово всё"), .check("x", done: true),
            .title("Пустое название"),
            .table([["1", "2"]]),
        ]
        XCTAssertEqual(NoteSweep.removingDone(blocks), [
            .thesis("б"),
            .title("Поездка"), .check("отель", done: false),
            .title("Пустое название"),
            .table([["1", "2"]]),
        ])
    }

    func testAllDoneLeavesEmptyLine() {
        XCTAssertEqual(NoteSweep.removingDone([.thesis("а", done: true)]), [.empty])
    }
}
