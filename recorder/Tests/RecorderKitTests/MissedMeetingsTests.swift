import XCTest
@testable import RecorderKit

// Пропуски бота (T162, D022): bumblebee говорит, что scriba не пришёл на встречу, и зовёт его.
// Ошибка здесь молчаливая — баннер не пришёл или пришёл дважды, погашенный пропуск всплыл снова,
// отказ сервера превратился в пустую строку, — поэтому правила проверены тестами.
final class MissedMeetingsTests: XCTestCase {
    private func miss(_ id: String, invite: Bool = true, title: String? = "Weekly sync") -> MissedMeeting {
        MissedMeeting(id: id, reason: "not_picked_up", title: title, startsAt: nil, endsAt: nil,
                      canInvite: invite, message: LocalizedText(en: "en \(id)", ru: "ru \(id)"))
    }

    // ── Разбор ответа сервера ───────────────────────────────────────────────────
    func testDecodesServerResponseAsMeetingMissedSendsIt() throws {
        let json = """
        {"autojoin":true,"checked":false,"snapshot_at":"2026-09-28T07:00:00Z","misses":[
          {"id":"0b8e6f1e-2c1a-4f3e-9d6a-1f2e3d4c5b6a","reason":"not_arrived","title":null,
           "starts_at":"2026-09-28T09:00:00Z","ends_at":"2026-09-28T10:00:00Z",
           "join_url":"https://meet.google.com/abc-defg-hij","platform":"meet",
           "detected_at":"2026-09-28T09:01:00Z","can_invite":true,
           "message":{"en":"not in","ru":"не попал"}}]}
        """
        let list = try MissedList.decode(Data(json.utf8))
        XCTAssertTrue(list.autojoin)
        XCTAssertFalse(list.checked)
        XCTAssertEqual(list.misses.count, 1)
        XCTAssertEqual(list.misses[0].id, "0b8e6f1e-2c1a-4f3e-9d6a-1f2e3d4c5b6a")
        XCTAssertTrue(list.misses[0].canInvite)
        XCTAssertNil(list.misses[0].title)
        XCTAssertEqual(list.misses[0].endsAt, "2026-09-28T10:00:00Z")
        XCTAssertEqual(list.misses[0].message.text(.ru), "не попал")
    }

    func testAutojoinOffDecodesEmpty() throws {
        let list = try MissedList.decode(Data(#"{"autojoin":false,"checked":false,"snapshot_at":null,"misses":[]}"#.utf8))
        XCTAssertFalse(list.autojoin)
        XCTAssertTrue(list.misses.isEmpty)
    }

    // ── Язык ────────────────────────────────────────────────────────────────────
    func testTextOnInterfaceLanguageFallsBackToOtherWhenEmpty() {
        XCTAssertEqual(LocalizedText(en: "E", ru: "Р").text(.ru), "Р")
        XCTAssertEqual(LocalizedText(en: "E", ru: "Р").text(.en), "E")
        XCTAssertEqual(LocalizedText(en: "E", ru: "  ").text(.ru), "E")
        XCTAssertEqual(LocalizedText(en: "", ru: "Р").text(.en), "Р")
    }

    func testUntitledMeetingIsNamedNotBlank() {
        XCTAssertEqual(MissedTexts.menuItem(nil, .ru), "Позвать бота на «встреча без названия»")
        XCTAssertEqual(MissedTexts.menuItem("  ", .en), "Invite the bot to \u{201C}untitled meeting\u{201D}")
        XCTAssertEqual(MissedTexts.invitedBody("Sync", .ru), "Приглашение отправлено — бот зайдёт на «Sync».")
    }

    // ── Что показать, что погасить ──────────────────────────────────────────────
    func testNewMissIsAnnouncedOnce() {
        let (t1, u1) = MissedTracker().applying([miss("a")])
        XCTAssertEqual(u1.announce.map(\.id), ["a"])
        let (t2, u2) = t1.applying([miss("a")])
        XCTAssertTrue(u2.announce.isEmpty, "второй опрос с тем же пропуском не даёт второго баннера")
        XCTAssertTrue(u2.withdraw.isEmpty)
        XCTAssertEqual(t2.open.map(\.id), ["a"])
    }

    func testMissGoneOnServerIsWithdrawn() {
        let (t1, _) = MissedTracker().applying([miss("a"), miss("b")])
        let (t2, u2) = t1.applying([miss("b")])
        XCTAssertEqual(u2.withdraw, ["a"])
        XCTAssertEqual(t2.open.map(\.id), ["b"])
        XCTAssertEqual(t2.announced, ["b"])
    }

    func testInvitedMissGoesOutAtOnceAndDoesNotComeBack() {
        let (t1, _) = MissedTracker().applying([miss("a"), miss("b")])
        let (t2, u2) = t1.invitedBot("a")
        XCTAssertEqual(u2.withdraw, ["a"])
        XCTAssertEqual(t2.open.map(\.id), ["b"])
        // Сервер ещё не успел сверить приглашение и вернул пропуск снова — не показываем.
        let (t3, u3) = t2.applying([miss("a"), miss("b")])
        XCTAssertTrue(u3.announce.isEmpty)
        XCTAssertEqual(t3.open.map(\.id), ["b"])
    }

    func testInvitedSetForgetsMissesServerNoLongerReturns() {
        let (t1, _) = MissedTracker().applying([miss("a")])
        let (t2, _) = t1.invitedBot("a")
        let (t3, _) = t2.applying([])
        XCTAssertTrue(t3.invited.isEmpty, "память о приглашениях не растёт вечно")
    }

    func testClearedWithdrawsEverythingShown() {
        let (t1, _) = MissedTracker().applying([miss("b"), miss("a")])
        let (t2, u2) = t1.cleared()
        XCTAssertEqual(u2.withdraw, ["a", "b"])
        XCTAssertTrue(t2.open.isEmpty)
    }

    func testMissThatReturnsAfterClosingIsAnnouncedAgain() {
        let (t1, _) = MissedTracker().applying([miss("a")])
        let (t2, _) = t1.applying([])
        let (_, u3) = t2.applying([miss("a")])
        XCTAssertEqual(u3.announce.map(\.id), ["a"])
    }

    func testNotInvitableMissIsStillShown() {
        let (t1, u1) = MissedTracker().applying([miss("p", invite: false, title: nil)])
        XCTAssertEqual(u1.announce.map(\.id), ["p"], "пропуск без кнопки (календарь не подключён) тоже говорится")
        XCTAssertEqual(t1.open.first?.canInvite, false)
    }

    // ── Отказ по-человечески ────────────────────────────────────────────────────
    func testServerRefusalOnInterfaceLanguage() {
        let body = Data(#"{"error":"This meeting is already over","error_ru":"Эта встреча уже закончилась","code":"meeting_over"}"#.utf8)
        XCTAssertEqual(MissedFailure.text(status: 409, body: body, lang: .ru), "Эта встреча уже закончилась")
        XCTAssertEqual(MissedFailure.text(status: 409, body: body, lang: .en), "This meeting is already over")
    }

    func testEnglishOnly4xxRefusalBeatsHttpCode() {
        let body = Data(#"{"error":"recorder token required"}"#.utf8)
        XCTAssertEqual(MissedFailure.text(status: 403, body: body, lang: .ru), "recorder token required")
    }

    func testServerCrashIsReportedByCodeNotAsRawEnglish() {
        let body = Data(#"{"error":"missed meetings unavailable"}"#.utf8)
        XCTAssertEqual(MissedFailure.text(status: 500, body: body, lang: .ru), "сервер ответил HTTP 500")
    }

    func testUnauthorizedWithoutTextPointsToToken() {
        XCTAssertEqual(MissedFailure.text(status: 401, body: Data("nope".utf8), lang: .ru),
                       "токен рекордера недействителен — обновите его в меню")
    }

    func testNoResponseIsOffline() {
        XCTAssertEqual(MissedFailure.text(status: nil, body: nil, lang: .ru),
                       "нет связи с сервером — попробуйте ещё раз")
    }

    func testNonJsonBodyNeverShownRaw() {
        let text = MissedFailure.text(status: 502, body: Data("<html>Bad Gateway</html>".utf8), lang: .en)
        XCTAssertEqual(text, "the server answered HTTP 502")
    }
}
