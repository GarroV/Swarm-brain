import XCTest
@testable import RecorderKit

final class AutoStopRuleTests: XCTestCase {
    @discardableResult
    private func tick(_ rule: inout AutoStopRule, elapsed: Double = 60,
                      system: Float = 0, mic: Float = 0, realCall: Bool = true,
                      room: AutoStopRule.RoomPresence? = nil) -> AutoStopRule.StopReason? {
        rule.observe(elapsed: elapsed, systemPeak: system, micPeak: mic, realCall: realCall, roomPresence: room)
    }

    private func conversation() -> AutoStopRule {
        var rule = AutoStopRule()
        tick(&rule, system: 0.5)
        tick(&rule, system: 0.5)
        return rule
    }

    func testLoudCallWithBlindDetectionSurvives76Minutes() {
        var rule = AutoStopRule()
        for _ in 0..<912 {
            XCTAssertNil(tick(&rule, elapsed: 76 * 60, system: 0.5, realCall: false), "#271: live speech must survive a blind mic detector")
        }
    }

    func testOwnMonologueIsNotBothSidesSilence() {
        var rule = conversation()
        for _ in 0..<179 {
            XCTAssertNil(tick(&rule, system: 0, mic: 0.8), "24.07: own speech is not silence")
        }
        XCTAssertEqual(tick(&rule, mic: 0.8), .otherSideSilent)
    }

    func testBothSidesSilentStopAt36TicksAfterConversation() {
        var rule = conversation()
        for _ in 0..<35 { XCTAssertNil(tick(&rule)) }
        XCTAssertEqual(tick(&rule), .bothSidesSilent)
    }

    func testLobbyDoesNotStopAfterThreeMinutes() {
        var rule = AutoStopRule()
        for _ in 0..<36 { XCTAssertNil(tick(&rule), "#379: waiting in the lobby is not a completed conversation") }
    }

    func testSingleSoundDoesNotTurnLobbyIntoConversation() {
        var rule = AutoStopRule()
        tick(&rule, system: 0.5)
        for _ in 0..<36 { XCTAssertNil(tick(&rule)) }
    }

    func testOtherSideBackstopDoesNotRequireConversationGate() {
        var rule = AutoStopRule()
        for _ in 0..<179 { XCTAssertNil(tick(&rule, mic: 0.8)) }
        XCTAssertEqual(tick(&rule, mic: 0.8), .otherSideSilent)
    }

    func testMicReleasedStopsAtThirdTickAfterConversation() {
        var rule = conversation()
        XCTAssertNil(tick(&rule, system: 0.5, realCall: false))
        XCTAssertNil(tick(&rule, system: 0.5, realCall: false))
        XCTAssertEqual(tick(&rule, system: 0.5, realCall: false), .micReleased)
    }

    func testMicReleasedInLobbyDoesNotStopRecording() {
        var rule = AutoStopRule()
        tick(&rule)
        for _ in 0..<36 { XCTAssertNil(tick(&rule, realCall: false)) }
    }

    func testHardLimitStopsEvenWithContinuousSpeechAndActiveCall() {
        for realCall in [true, false] {
            var rule = AutoStopRule()
            XCTAssertNil(tick(&rule, elapsed: 4 * 60 * 60 - 1, system: 0.5, realCall: realCall))
            XCTAssertEqual(tick(&rule, elapsed: 4 * 60 * 60, system: 0.5, realCall: realCall), .hardLimit)
        }
    }

    func test75MinuteLimitStillRequiresActualSilence() {
        var rule = AutoStopRule()
        for _ in 0..<35 { XCTAssertNil(tick(&rule, elapsed: 75 * 60, realCall: false)) }
        XCTAssertEqual(tick(&rule, elapsed: 75 * 60, realCall: false), .noCallLimit)
    }

    func test75MinuteLimitDoesNotApplyBeforeDeadlineOrDuringActiveCall() {
        for realCall in [true, false] {
            var rule = AutoStopRule()
            for _ in 0..<36 { XCTAssertNil(tick(&rule, elapsed: 75 * 60 - 1, realCall: realCall)) }
        }
        var rule = AutoStopRule()
        for _ in 0..<36 { XCTAssertNil(tick(&rule, elapsed: 75 * 60, realCall: true)) }
    }

    func testSingleBlipDoesNotResetBothSidesSilence() {
        var rule = conversation()
        for _ in 0..<35 { XCTAssertNil(tick(&rule)) }
        XCTAssertNil(tick(&rule, system: 0.5))
        XCTAssertEqual(tick(&rule), .bothSidesSilent)
    }

    func testTwoAudibleTicksResetBothSidesSilence() {
        for peaks: (Float, Float) in [(0.02, 0), (0, 0.12)] {
            var rule = conversation()
            for _ in 0..<35 { XCTAssertNil(tick(&rule)) }
            XCTAssertNil(tick(&rule, system: peaks.0, mic: peaks.1))
            XCTAssertNil(tick(&rule, system: peaks.0, mic: peaks.1))
            XCTAssertNil(tick(&rule))
        }
    }

    func testRoomClosureStopsOnFourthConfirmedGoneTick() {
        var rule = conversation()
        for _ in 0..<3 { XCTAssertNil(tick(&rule, system: 0.5, room: .gone)) }
        XCTAssertEqual(tick(&rule, system: 0.5, room: .gone), .roomClosed)
    }

    func testUnknownRoomDoesNotAddTicksOrEraseConfirmedAbsence() {
        var rule = conversation()
        for _ in 0..<3 { XCTAssertNil(tick(&rule, system: 0.5, room: .gone)) }
        for _ in 0..<10 { XCTAssertNil(tick(&rule, system: 0.5, room: .unknown)) }
        XCTAssertEqual(tick(&rule, system: 0.5, room: .gone), .roomClosed)
    }

    func testOpenOrNonRoomIdentityResetsRoomAbsence() {
        for presence: AutoStopRule.RoomPresence? in [.open, nil] {
            var rule = conversation()
            for _ in 0..<3 { tick(&rule, system: 0.5, room: .gone) }
            XCTAssertNil(tick(&rule, system: 0.5, room: presence))
            for _ in 0..<3 { XCTAssertNil(tick(&rule, system: 0.5, room: .gone)) }
            XCTAssertEqual(tick(&rule, system: 0.5, room: .gone), .roomClosed)
        }
    }

    func testRoomSignalNeedsPreviouslySeenCall() {
        var rule = AutoStopRule()
        for _ in 0..<10 { XCTAssertNil(tick(&rule, system: 0.5, realCall: false, room: .gone)) }
    }

    func testRoomClosureKeepsPriorityOverHardLimit() {
        var rule = conversation()
        for _ in 0..<3 { tick(&rule, system: 0.5, room: .gone) }
        XCTAssertEqual(tick(&rule, elapsed: 4 * 60 * 60, system: 0.5, room: .gone), .roomClosed)
    }

    func testFreshRecordingDoesNotInheritPreviousConversation() {
        var old = conversation()
        for _ in 0..<35 { tick(&old) }
        var next = AutoStopRule()
        XCTAssertNil(tick(&next))
    }
}
