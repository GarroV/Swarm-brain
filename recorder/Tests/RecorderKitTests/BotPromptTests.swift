import XCTest
@testable import RecorderKit

// Решение владельца 07.10.2026: бот в приоритете; если бот пишет встречу, которую пишет и рекордер,
// человек видит «Встречу записывает Скриба — продолжить запись рекордером?» и выбирает сам.
final class BotPromptTests: XCTestCase {
    func testAsksWhenBotRecordsTheSameCalendarMeeting() {
        XCTAssertTrue(BotPrompt.shouldAsk(recordingKey: "uid:2026-10-07", isCalendar: true,
                                          recordedNow: ["uid:2026-10-07"], alreadyAsked: false))
    }

    func testSilentWhenBotRecordsAnotherMeeting() {
        XCTAssertFalse(BotPrompt.shouldAsk(recordingKey: "uid:2026-10-07", isCalendar: true,
                                           recordedNow: ["other:2026-10-07"], alreadyAsked: false))
    }

    func testCallWithoutCalendarAsksOnAnyBotRecording() {
        XCTAssertTrue(BotPrompt.shouldAsk(recordingKey: "manual:abc", isCalendar: false,
                                          recordedNow: ["room:xyz"], alreadyAsked: false))
    }

    func testAsksOncePerRecording() {
        XCTAssertFalse(BotPrompt.shouldAsk(recordingKey: "uid:2026-10-07", isCalendar: true,
                                           recordedNow: ["uid:2026-10-07"], alreadyAsked: true))
    }

    func testSilentWithoutBotOrRecording() {
        XCTAssertFalse(BotPrompt.shouldAsk(recordingKey: "uid:2026-10-07", isCalendar: true,
                                           recordedNow: [], alreadyAsked: false))
        XCTAssertFalse(BotPrompt.shouldAsk(recordingKey: nil, isCalendar: false,
                                           recordedNow: ["room:xyz"], alreadyAsked: false))
    }
}
