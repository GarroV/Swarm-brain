import XCTest
@testable import RecorderKit

// Напоминание «Звонок идёт, но не записывается» (26.10.2026). Ошибка тут молчаливая: не напомнили —
// встреча потеряна; напомнили, когда пишет Скриба, — человек пишет вторую копию.
final class CallNudgeTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_000_000)

    func testDueOnlyAfterThreeMinutesOfCall() {
        XCTAssertFalse(CallNudge.isDue(callStartedAt: start, now: start.addingTimeInterval(179),
                                       isRecording: false, alreadyNudged: false))
        XCTAssertTrue(CallNudge.isDue(callStartedAt: start, now: start.addingTimeInterval(180),
                                      isRecording: false, alreadyNudged: false))
    }

    func testNotDueWhenRecordingNoCallOrAlreadyNudged() {
        let later = start.addingTimeInterval(600)
        XCTAssertFalse(CallNudge.isDue(callStartedAt: start, now: later, isRecording: true, alreadyNudged: false))
        XCTAssertFalse(CallNudge.isDue(callStartedAt: nil, now: later, isRecording: false, alreadyNudged: false))
        XCTAssertFalse(CallNudge.isDue(callStartedAt: start, now: later, isRecording: false, alreadyNudged: true))
    }

    func testBotOnNeighbourMeetingDoesNotCoverTheCallPersonIsIn() {
        // 26.10: бот писал «Сербию», человек сидел на «design sync».
        XCTAssertFalse(CallNudge.isCoveredByBot(liveKeys: ["serbia", "design"], currentKey: "design",
                                                recordedNow: ["serbia"]))
        XCTAssertTrue(CallNudge.isCoveredByBot(liveKeys: ["serbia", "design"], currentKey: "serbia",
                                               recordedNow: ["serbia"]))
    }

    func testUnknownCurrentCallIsCoveredOnlyWhenBotRecordsAll() {
        XCTAssertFalse(CallNudge.isCoveredByBot(liveKeys: ["serbia", "design"], currentKey: nil,
                                                recordedNow: ["serbia"]))
        XCTAssertTrue(CallNudge.isCoveredByBot(liveKeys: ["serbia", "design"], currentKey: nil,
                                               recordedNow: ["design", "serbia"]))
    }

    func testCallWithoutCalendarIsCoveredWhenBotRecordsSomething() {
        XCTAssertFalse(CallNudge.isCoveredByBot(liveKeys: [], currentKey: nil, recordedNow: []))
        XCTAssertTrue(CallNudge.isCoveredByBot(liveKeys: [], currentKey: nil, recordedNow: ["x"]))
    }
}
