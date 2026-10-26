import XCTest
@testable import RecorderKit

// Галочка на доске: отмена до ухода строки не должна закрывать задачу. Ошибка молчаливая —
// человек передумал, а задача всё равно «выполнена».
final class BoardInteractionTests: XCTestCase {
    func testToggleThenCommitSends() {
        var t = CheckTracker()
        XCTAssertEqual(t.toggle("a"), .struck)
        XCTAssertTrue(t.isStruck("a"))
        XCTAssertTrue(t.commit("a"))
        XCTAssertFalse(t.commit("a"), "второй таймер на той же строке запрос не шлёт")
    }

    func testCancelBeforeDepartureSendsNothing() {
        var t = CheckTracker()
        _ = t.toggle("a")
        XCTAssertEqual(t.toggle("a"), .cancelled)
        XCTAssertFalse(t.isStruck("a"))
        XCTAssertFalse(t.commit("a"), "таймер, сработавший после отмены, ничего не делает")
    }

    func testRowHiddenWhileRequestInFlightAndBackOnFailure() {
        var t = CheckTracker()
        let tasks = [BoardTask(id: "a", title: "A"), BoardTask(id: "b", title: "B")]
        _ = t.toggle("a")
        XCTAssertEqual(t.visible(tasks).count, 2, "до ухода строка на месте (зачёркнутая)")
        XCTAssertTrue(t.commit("a"))
        XCTAssertEqual(t.visible(tasks).map(\.id), ["b"])
        t.failed("a")
        XCTAssertEqual(t.visible(tasks).map(\.id), ["a", "b"], "ошибка PATCH возвращает строку")
    }

    func testClickWhileInFlightDoesNotReopen() {
        var t = CheckTracker()
        _ = t.toggle("a"); _ = t.commit("a")
        XCTAssertEqual(t.toggle("a"), .struck)
        XCTAssertFalse(t.commit("a"))
        t.finished("a")
        XCTAssertEqual(t.visible([BoardTask(id: "a", title: "A")]).count, 1, "после finished сервер сам перестанет отдавать строку")
    }

    func testVoiceClipVerdict() {
        XCTAssertEqual(VoiceClip.verdict(duration: 0.2), .discard)
        XCTAssertEqual(VoiceClip.verdict(duration: 0.49), .discard)
        XCTAssertEqual(VoiceClip.verdict(duration: 0.5), .send)
        XCTAssertEqual(VoiceClip.verdict(duration: 12), .send)
    }

    func testVoiceFailureKeys() {
        func key(_ status: Int?, _ body: String? = nil) -> String {
            VoiceFailure.messageKey(status: status, body: body.map { Data($0.utf8) })
        }
        XCTAssertEqual(key(nil), "voice.err.offline")
        XCTAssertEqual(key(401), "voice.err.auth")
        XCTAssertEqual(key(422, #"{"code":"nothing_heard"}"#), "voice.err.nothing_heard")
        XCTAssertEqual(key(502, #"{"code":"transcription_unavailable"}"#), "voice.err.unavailable")
        XCTAssertEqual(key(413, #"{"code":"audio_too_large"}"#), "voice.err.too_long")
        XCTAssertEqual(key(403, #"{"code":"demo_not_allowed"}"#), "voice.err.demo")
        for code in ["length_required", "bad_request", "bad_date", "bad_audio", "unsupported_media"] {
            XCTAssertEqual(key(400, "{\"code\":\"\(code)\"}"), "voice.err.generic", code)
        }
        XCTAssertEqual(key(500, "not json"), "voice.err.generic")
        XCTAssertEqual(key(502, nil), "voice.err.unavailable", "без тела — по статусу")
        XCTAssertEqual(key(413, nil), "voice.err.too_long", "без тела — по статусу")
        XCTAssertEqual(key(403, nil), "voice.err.demo", "без тела — по статусу")
        XCTAssertEqual(key(422, nil), "voice.err.nothing_heard", "без тела — по статусу")
        // Каждый ключ ошибки должен существовать в словаре обоих языков.
        for code in ["nothing_heard", "transcription_unavailable", "audio_too_large", "demo_not_allowed", "x"] {
            for lang in BoardL10n.dictionaries.keys {
                XCTAssertNotEqual(BoardL10n.text(key(400, "{\"code\":\"\(code)\"}"), lang: lang), key(400, "{\"code\":\"\(code)\"}"))
            }
        }
    }
}
