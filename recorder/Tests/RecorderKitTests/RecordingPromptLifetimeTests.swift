import XCTest
@testable import RecorderKit

final class RecordingPromptLifetimeTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1000)

    func testSameCallExpiresAfterFiveMinutesDespitePolling() {
        var prompt = RecordingPromptLifetime()
        XCTAssertTrue(prompt.show(key: "call", now: start))
        XCTAssertTrue(prompt.show(key: "call", now: start.addingTimeInterval(299)))
        XCTAssertFalse(prompt.show(key: "call", now: start.addingTimeInterval(300)))
        XCTAssertFalse(prompt.show(key: "call", now: start.addingTimeInterval(600)))
    }

    func testDifferentCallGetsItsOwnDeadline() {
        var prompt = RecordingPromptLifetime()
        XCTAssertTrue(prompt.show(key: "first", now: start))
        XCTAssertTrue(prompt.show(key: "second", now: start.addingTimeInterval(301)))
        XCTAssertEqual(prompt.deadline, start.addingTimeInterval(601))
    }

    func testFinishingCallOrStartingRecordingClearsOffer() {
        var prompt = RecordingPromptLifetime()
        XCTAssertTrue(prompt.show(key: "call", now: start))
        prompt.clear()
        XCTAssertNil(prompt.key)
        XCTAssertNil(prompt.deadline)
        XCTAssertTrue(prompt.show(key: "call", now: start.addingTimeInterval(500)))
    }

    func testNotificationHugsTopRightOnEitherMonitor() {
        for screen in [CGRect(x: 0, y: 0, width: 1512, height: 920),
                       CGRect(x: -1920, y: 40, width: 1920, height: 1000)] {
            let size = CGSize(width: 300, height: 102)
            let origin = WidgetPlacement.notificationOrigin(size: size, in: screen)
            XCTAssertEqual(screen.maxX - origin.x - size.width, 18)
            XCTAssertEqual(screen.maxY - origin.y - size.height, 16)
        }
    }
}
