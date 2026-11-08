import XCTest
@testable import RecorderKit

final class CalendarAutoStartTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func meeting(_ key: String = "cal:a", start: TimeInterval = -60, end: TimeInterval? = 1800) -> CalendarAutoStart.Meeting {
        .init(key: key, start: now.addingTimeInterval(start), end: end.map { now.addingTimeInterval($0) })
    }
    private func decide(_ meetings: [CalendarAutoStart.Meeting], enabled: Bool = true, call: Bool = true,
                        recording: Bool = false, recordedNow: [String] = [],
                        cancelled: Set<String> = []) -> CalendarAutoStart.Decision {
        CalendarAutoStart.decide(meetings: meetings, now: now, autoStartEnabled: enabled, callActive: call,
                                 isRecording: recording,
                                 recordedNow: recordedNow, cancelled: cancelled)
    }

    func testStartsWhenCallAndSlotRunning() {
        XCTAssertEqual(decide([meeting()]), .start(key: "cal:a"))
    }
    func testStartsOnJoinMidSlotNotAtSlotStart() {
        // Зашёл в звонок через семь минут после начала слота — старт сейчас, а не в 10:00.
        XCTAssertEqual(decide([meeting(start: -420)]), .start(key: "cal:a"))
    }
    func testStartsWhenJoiningWithinLeadBeforeSlot() {
        XCTAssertEqual(decide([meeting(start: 240)]), .start(key: "cal:a"))
    }
    func testNoCallNoStart() {
        XCTAssertEqual(decide([meeting()], call: false), .skip(.noCall))
    }
    func testOffCalendarCallDoesNotAutoStart() {
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
    func testOverlapGivesNoCountdown() {
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:b")]), .skip(.overlap))
    }
    func testOverlapOfRunningAndSoonStartingEvent() {
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:b", start: 120)]), .skip(.overlap))
    }
    func testSameKeyTwiceIsNotOverlap() {
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:a")]), .start(key: "cal:a"))
    }
    func testAlreadyRecording() {
        XCTAssertEqual(decide([meeting()], recording: true), .skip(.alreadyRecording))
    }
    func testRecordedByBotOrOtherRecorder() {
        XCTAssertEqual(decide([meeting()], recordedNow: ["cal:a"]), .skip(.recordedByOther))
    }
    func testCancelledKeyIsSkippedButNextMeetingStarts() {
        XCTAssertEqual(decide([meeting()], cancelled: ["cal:a"]), .skip(.cancelled))
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:b")], cancelled: ["cal:a"]), .start(key: "cal:b"))
    }
    func testDisabledOrMissingFlag() {
        XCTAssertEqual(decide([meeting()], enabled: false), .skip(.disabled))
    }
    func testBotRecordsOtherMeetingOfOverlap() {
        XCTAssertEqual(decide([meeting("cal:a"), meeting("cal:b")], recordedNow: ["cal:a"]), .start(key: "cal:b"))
    }

    // Автомат отсчёта
    func testCountdownRunsFiveSecondsThenFires() {
        let d = CalendarAutoStart.Decision.start(key: "cal:a")
        var (s, e) = AutoStartCountdown.step(.none, decision: d, now: now)
        XCTAssertEqual(e, .show(key: "cal:a", remaining: 5))
        (s, e) = AutoStartCountdown.step(s, decision: d, now: now.addingTimeInterval(1))
        XCTAssertEqual(e, .show(key: "cal:a", remaining: 4))
        (s, e) = AutoStartCountdown.step(s, decision: d, now: now.addingTimeInterval(4.2))
        XCTAssertEqual(e, .show(key: "cal:a", remaining: 1))
        (s, e) = AutoStartCountdown.step(s, decision: d, now: now.addingTimeInterval(5))
        XCTAssertEqual(e, .fire(key: "cal:a"))
        XCTAssertEqual(s, .none)
    }
    func testCountdownNeverFiresBeforeFiveSeconds() {
        let d = CalendarAutoStart.Decision.start(key: "cal:a")
        let (_, e) = AutoStartCountdown.step(.running(key: "cal:a", since: now), decision: d,
                                             now: now.addingTimeInterval(4.99))
        XCTAssertNotEqual(e, .fire(key: "cal:a"))
    }
    func testCountdownHidesWhenDecisionVanishes() {
        let (s, e) = AutoStartCountdown.step(.running(key: "cal:a", since: now), decision: .skip(.cancelled),
                                             now: now.addingTimeInterval(2))
        XCTAssertEqual(e, .hide)
        XCTAssertEqual(s, .none)
        XCTAssertEqual(AutoStartCountdown.step(.none, decision: .skip(.cancelled), now: now).1, .none)
    }
    func testCountdownRestartsForAnotherMeeting() {
        let (s, e) = AutoStartCountdown.step(.running(key: "cal:a", since: now), decision: .start(key: "cal:b"),
                                             now: now.addingTimeInterval(3))
        XCTAssertEqual(e, .show(key: "cal:b", remaining: 5))
        XCTAssertEqual(s, .running(key: "cal:b", since: now.addingTimeInterval(3)))
    }
}
