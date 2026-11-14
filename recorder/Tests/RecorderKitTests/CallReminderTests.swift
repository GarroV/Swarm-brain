import XCTest
@testable import RecorderKit

final class CallReminderTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func meeting(_ key: String = "cal:a", start: TimeInterval = -60, end: TimeInterval? = 1800) -> CallReminder.Meeting {
        .init(key: key, start: now.addingTimeInterval(start), end: end.map { now.addingTimeInterval($0) })
    }
    private func decide(_ meetings: [CallReminder.Meeting], call: Bool = true, recording: Bool = false,
                        recordedNow: [String] = [], dismissed: Set<String> = []) -> CallReminder.Decision {
        CallReminder.decide(meetings: meetings, now: now, callActive: call, isRecording: recording,
                            recordedNow: recordedNow, dismissed: dismissed)
    }

    func testRemindsWhenCallAndSlotRunning() {
        XCTAssertEqual(decide([meeting()]), .remind(keys: ["cal:a"]))
    }
    func testRemindsOnJoinMidSlot() {
        // Зашёл в звонок через семь минут после начала слота — напоминаем сейчас, а не в 10:00.
        XCTAssertEqual(decide([meeting(start: -420)]), .remind(keys: ["cal:a"]))
    }
    func testRemindsWhenJoiningWithinLeadBeforeSlot() {
        XCTAssertEqual(decide([meeting(start: 240)]), .remind(keys: ["cal:a"]))
    }
    func testNoCallNoReminder() {
        XCTAssertEqual(decide([meeting()], call: false), .skip(.noCall))
    }
    func testOffCalendarCallGivesNoReminder() {
        XCTAssertEqual(decide([]), .skip(.noMeeting))
    }
    func testSlotFarInTheFuture() {
        XCTAssertEqual(decide([meeting(start: 600)]), .skip(.tooEarly))
    }
    func testMissingStartIsNotGuessed() {
        XCTAssertEqual(decide([.init(key: "cal:a", start: nil, end: nil)]), .skip(.tooEarly))
    }
    func testEnded() {
        XCTAssertEqual(decide([meeting(start: -3600, end: 0)]), .skip(.ended))
    }
    func testOverlapRemindsAboutAllBestFirst() {
        XCTAssertEqual(decide([meeting("cal:b"), meeting("cal:a")]), .remind(keys: ["cal:b", "cal:a"]))
    }
    func testOverlapOfRunningAndSoonStartingEvent() {
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:b", start: 120)]), .remind(keys: ["cal:a", "cal:b"]))
    }
    func testSameKeyTwiceIsOneMeeting() {
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:a")]), .remind(keys: ["cal:a"]))
    }
    func testAlreadyRecording() {
        XCTAssertEqual(decide([meeting()], recording: true), .skip(.alreadyRecording))
    }
    func testRecordedByBotOrOtherRecorder() {
        XCTAssertEqual(decide([meeting()], recordedNow: ["cal:a"]), .skip(.recordedByOther))
    }
    func testDismissedMeetingIsSkippedButTheOtherOneStaysInReminder() {
        XCTAssertEqual(decide([meeting()], dismissed: ["cal:a"]), .skip(.dismissed))
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:b")], dismissed: ["cal:a"]), .remind(keys: ["cal:b"]))
    }
    func testBotRecordsOtherMeetingOfOverlap() {
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:b")], recordedNow: ["cal:a"]), .remind(keys: ["cal:b"]))
    }
}
