import XCTest
@testable import RecorderKit

final class AutoStopUnknownTests: XCTestCase {
    private func conversation() -> AutoStopRule {
        var rule = AutoStopRule()
        for _ in 0..<2 {
            _ = rule.observe(elapsed: 60, systemPeak: 0.5, micPeak: 0, realCall: true, roomPresence: nil)
        }
        return rule
    }

    func testUnknownDetectorCannotPretendMicrophoneWasReleased() {
        var rule = conversation()
        for _ in 0..<100 {
            XCTAssertNil(rule.observe(elapsed: 100, systemPeak: 0.5, micPeak: 0, realCall: nil, roomPresence: nil))
        }
        for _ in 0..<2 {
            XCTAssertNil(rule.observe(elapsed: 100, systemPeak: 0.5, micPeak: 0, realCall: false, roomPresence: nil))
        }
        XCTAssertEqual(rule.observe(elapsed: 100, systemPeak: 0.5, micPeak: 0, realCall: false, roomPresence: nil), .micReleased)
    }

    func testUnknownDetectorDoesNotDisableAudioSilenceRule() {
        var rule = conversation()
        for _ in 0..<35 {
            XCTAssertNil(rule.observe(elapsed: 100, systemPeak: 0, micPeak: 0, realCall: nil, roomPresence: nil))
        }
        XCTAssertEqual(rule.observe(elapsed: 100, systemPeak: 0, micPeak: 0, realCall: nil, roomPresence: nil), .bothSidesSilent)
    }

    func testUnknownDetectorDoesNotDisableHardCeiling() {
        var rule = AutoStopRule()
        XCTAssertEqual(rule.observe(elapsed: 4 * 60 * 60, systemPeak: 0.5, micPeak: 0.8, realCall: nil, roomPresence: nil), .hardLimit)
    }

    func testUnknownDetectorCannotTrigger75MinuteNoCallLimit() {
        var rule = AutoStopRule()
        for _ in 0..<100 {
            XCTAssertNil(rule.observe(elapsed: 75 * 60, systemPeak: 0, micPeak: 0, realCall: nil, roomPresence: nil))
        }
    }
}
