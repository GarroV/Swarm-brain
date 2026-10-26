import XCTest
@testable import RecorderKit

// Разбор ответа доски. Ошибка молчаливая: мусор в поле не должен ронять доску (пустой экран у
// человека посреди дня), но и принимать чужое значение за настоящее нельзя.
final class BoardModelTests: XCTestCase {
    private func parse(_ json: String) -> BoardSnapshot? { BoardSnapshot.parse(Data(json.utf8)) }

    func testFullResponse() throws {
        let s = try XCTUnwrap(parse("""
        {"config":{"task_rows":7,"panel_width":800,"meetings_width":260,"notes_height":300,"refresh_seconds":45},
         "tasks":[{"id":"t1","title":"Позвонить","due_date":"2026-10-21","status":"open"}],
         "tasks_total":12,
         "meetings":[{"id":"m1","title":"Планёрка","starts_at":"2026-10-22T09:00:00.000Z",
                      "ends_at":"2026-10-22T09:30:00.000Z","join_url":"https://meet.google.com/x","is_now":true,"is_past":false}]}
        """))
        XCTAssertEqual(s.config, BoardConfig(taskRows: 7, panelWidth: 800, meetingsWidth: 260, notesHeight: 300, refreshSeconds: 45))
        XCTAssertEqual(s.tasks, [BoardTask(id: "t1", title: "Позвонить", dueDate: "2026-10-21", status: "open")])
        XCTAssertEqual(s.tasksTotal, 12)
        XCTAssertEqual(s.meetings.first?.joinURL, "https://meet.google.com/x")
        XCTAssertEqual(s.meetings.first?.isNow, true)
        XCTAssertNotNil(s.meetings.first?.start)
        XCTAssertNil(s.meetingsReason)
    }

    func testGarbageConfigFallsBackFieldByField() throws {
        let s = try XCTUnwrap(parse("""
        {"config":{"task_rows":"десять","panel_width":99999,"meetings_width":true,"notes_height":10.5,"refresh_seconds":30},
         "tasks":[],"meetings":[]}
        """))
        let d = BoardConfig.defaults
        XCTAssertEqual(s.config.taskRows, d.taskRows)
        XCTAssertEqual(s.config.panelWidth, d.panelWidth)
        XCTAssertEqual(s.config.meetingsWidth, d.meetingsWidth)
        XCTAssertEqual(s.config.notesHeight, d.notesHeight)
        XCTAssertEqual(s.config.refreshSeconds, 30, "живое поле рядом с мусором не должно потеряться")
    }

    func testMissingOrWrongTypedSectionsGiveDefaults() throws {
        let s = try XCTUnwrap(parse(#"{"config":[1,2],"tasks":"нет","meetings":{"a":1}}"#))
        XCTAssertEqual(s.config, .defaults)
        XCTAssertTrue(s.tasks.isEmpty)
        XCTAssertTrue(s.meetings.isEmpty)
        XCTAssertEqual(s.tasksTotal, 0)
    }

    func testBrokenElementSkippedOthersKept() throws {
        let s = try XCTUnwrap(parse("""
        {"tasks":[{"id":"a","title":"Первая"},{"id":5,"title":"битая"},{"title":"без id"},
                  {"id":"b","title":"   "},{"id":"c","title":"Третья"}]}
        """))
        XCTAssertEqual(s.tasks.map(\.id), ["a", "c"])
    }

    func testTotalNeverBelowListedTasks() throws {
        let s = try XCTUnwrap(parse(#"{"tasks":[{"id":"a","title":"A"},{"id":"b","title":"B"}],"tasks_total":1}"#))
        XCTAssertEqual(s.tasksTotal, 2)
    }

    func testMeetingsReasonKept() throws {
        let s = try XCTUnwrap(parse(#"{"tasks":[],"meetings":[],"meetings_reason":"not_connected"}"#))
        XCTAssertEqual(s.meetingsReason, "not_connected")
    }

    func testNotJSONObjectIsNil() {
        XCTAssertNil(parse("<html>502</html>"))
        XCTAssertNil(parse("[1,2,3]"))
        XCTAssertNil(parse(""))
    }

    // MARK: обрезка и выделение

    func testTrimCutsToRowsAndCountsRest() {
        let tasks = (1...14).map { BoardTask(id: "t\($0)", title: "T\($0)") }
        let r = BoardList.trim(Array(tasks.prefix(10)), rows: 10, total: 14)
        XCTAssertEqual(r.visible.count, 10)
        XCTAssertEqual(r.more, 4, "хвост считается по total сервера, а не по длине присланного")
        let r2 = BoardList.trim(tasks, rows: 5, total: 14)
        XCTAssertEqual(r2.visible.count, 5)
        XCTAssertEqual(r2.more, 9)
    }

    func testTrimNoTailWhenEverythingFits() {
        let tasks = [BoardTask(id: "a", title: "A")]
        XCTAssertEqual(BoardList.trim(tasks, rows: 10, total: 1).more, 0)
        XCTAssertEqual(BoardList.trim([], rows: 10, total: 0).more, 0)
        XCTAssertEqual(BoardList.trim(tasks, rows: 0, total: 1).visible.count, 0)
    }

    func testHighlightLiveMeetingThenNextUpcoming() {
        let ms = [
            BoardMeeting(id: "old", title: nil, startsAt: "2026-10-22T07:00:00Z", endsAt: "2026-10-22T08:00:00Z"),
            BoardMeeting(id: "live", title: nil, startsAt: "2026-10-22T09:00:00Z", endsAt: "2026-10-22T10:00:00Z"),
            BoardMeeting(id: "next", title: nil, startsAt: "2026-10-22T11:00:00Z", endsAt: "2026-10-22T12:00:00Z"),
        ]
        let at = { (s: String) in BoardTime.parse(s)! }
        XCTAssertEqual(BoardList.highlightedMeetingID(ms, now: at("2026-10-22T09:30:00Z")), "live")
        XCTAssertEqual(BoardList.highlightedMeetingID(ms, now: at("2026-10-22T10:30:00Z")), "next")
        XCTAssertNil(BoardList.highlightedMeetingID(ms, now: at("2026-10-22T13:00:00Z")))
        XCTAssertTrue(BoardList.isPast(ms[0], now: at("2026-10-22T09:30:00Z")))
        XCTAssertFalse(BoardList.isPast(ms[2], now: at("2026-10-22T09:30:00Z")))
    }

    // MARK: «сегодня» и пояс клиента

    func testTodayFollowsClientTimeZoneNotUTC() {
        // 22:30 UTC 22 октября — в Белграде (+2) уже 23-е, в Лос-Анджелесе (−7) ещё 22-е.
        let now = BoardTime.parse("2026-10-22T22:30:00Z")!
        let belgrade = TimeZone(identifier: "Europe/Belgrade")!
        let la = TimeZone(identifier: "America/Los_Angeles")!
        XCTAssertEqual(BoardDay.today(now: now, timeZone: belgrade), "2026-10-23")
        XCTAssertEqual(BoardDay.today(now: now, timeZone: la), "2026-10-22")
        XCTAssertEqual(BoardDay.tomorrow(now: now, timeZone: belgrade), "2026-10-24")
        XCTAssertEqual(BoardDay.tzOffsetMinutes(now: now, timeZone: belgrade), 120)
        XCTAssertEqual(BoardDay.tzOffsetMinutes(now: now, timeZone: la), -420)
    }

    func testTomorrowCrossesMonthBoundary() {
        let now = BoardTime.parse("2026-10-31T10:00:00Z")!
        XCTAssertEqual(BoardDay.tomorrow(now: now, timeZone: TimeZone(identifier: "UTC")!), "2026-11-01")
    }

    func testDueLabel() {
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertEqual(BoardDay.dueLabel("2026-10-22", today: "2026-10-22", lang: "ru", timeZone: utc), "сегодня")
        XCTAssertEqual(BoardDay.dueLabel("2026-10-23", today: "2026-10-22", lang: "en", timeZone: utc), "tomorrow")
        XCTAssertTrue(BoardDay.dueLabel("2026-10-30", today: "2026-10-22", lang: "en", timeZone: utc).contains("30"))
        XCTAssertEqual(BoardDay.dueLabel("мусор", today: "2026-10-22", lang: "en", timeZone: utc), "мусор")
    }

    // MARK: запросы

    func testTodayURL() {
        let u = BoardRequests.todayURL(ingestBase: "https://api.swarm-team.app/functions/v1/", date: "2026-10-22", tzOffset: -300)
        XCTAssertEqual(u?.absoluteString, "https://api.swarm-team.app/functions/v1/swarm-api/board/today?date=2026-10-22&tz_offset=-300")
    }

    func testWebTokenURLIsSiblingFunctionNotSwarmApiRoute() {
        XCTAssertEqual(BoardRequests.webTokenURL(ingestBase: "https://api.swarm-team.app/functions/v1/")?.absoluteString,
                       "https://api.swarm-team.app/functions/v1/meeting-webtoken")
    }

    func testMultipartBodyHasFieldsAndAudio() throws {
        let body = BoardRequests.multipart(boundary: "BB", audio: Data([1, 2, 3]), filename: "voice.m4a", mime: "audio/mp4",
                                           fields: [("date", "2026-10-22"), ("tz_offset", "120")])
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("--BB\r\n"))
        XCTAssertTrue(text.contains("name=\"date\"\r\n\r\n2026-10-22\r\n"))
        XCTAssertTrue(text.contains("name=\"audio\"; filename=\"voice.m4a\""))
        XCTAssertTrue(text.contains("Content-Type: audio/mp4"))
        XCTAssertTrue(text.hasSuffix("\r\n--BB--\r\n"))
        XCTAssertNotNil(body.range(of: Data([1, 2, 3])))
    }

    func testTaskCreateBody() throws {
        let data = try XCTUnwrap(BoardRequests.taskCreateBody(title: "  Позвонить  ", description: "  ", country: "SI",
                                                              dueDate: "2026-10-23", assigneeTelegramId: 42))
        let o = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(o["title"] as? String, "Позвонить")
        XCTAssertNil(o["description"], "пустое описание не шлём")
        XCTAssertEqual(o["country"] as? String, "SI")
        XCTAssertEqual(o["assignee_telegram_id"] as? Int, 42)
        XCTAssertEqual(o["confirmed"] as? Bool, true)
        let none = try XCTUnwrap(BoardRequests.taskCreateBody(title: "x", description: "", country: nil, dueDate: "d", assigneeTelegramId: 1))
        XCTAssertNil((try JSONSerialization.jsonObject(with: none) as? [String: Any])?["country"])
    }

    func testCreatedTaskParsing() {
        let v = CreatedTask.parseVoice(Data(#"{"task":{"id":"t","title":"Агрегаторы","description":null,"country":"SI","due_date":"2026-10-23"},"heard":"по Словении"}"#.utf8))
        XCTAssertEqual(v, CreatedTask(id: "t", title: "Агрегаторы", country: "SI", dueDate: "2026-10-23", heard: "по Словении"))
        XCTAssertNil(CreatedTask.parseVoice(Data(#"{"error":"x"}"#.utf8)))
        XCTAssertEqual(CreatedTask.parseTask(Data(#"{"id":"t","title":"A"}"#.utf8))?.id, "t")
        XCTAssertEqual(BoardRequests.parseMeID(Data(#"{"telegram_id":744230399,"name":"x"}"#.utf8)), 744230399)
        XCTAssertEqual(BoardRequests.parseMarkets(Data(#"{"allowed_markets":["RS","SI"]}"#.utf8)), ["RS", "SI"])
    }
}
