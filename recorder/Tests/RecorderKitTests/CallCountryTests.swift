import XCTest
@testable import RecorderKit

// Экран страны во время созвона (27.10.2026). Молчаливые ошибки тут: показали задачи не той серии
// (ключ с датой вместо серии), переспросили после «Нет», зашли на сервер каждые 25 секунд.
final class CallCountryTests: XCTestCase {
    private func json(_ s: String) -> Data { Data(s.utf8) }

    func testSeriesKeyStripsDateTailOnly() {
        XCTAssertEqual(CallCountry.seriesKey(of: "a00c_R20260928T120000@google.com:2026-10-26"),
                       "a00c_R20260928T120000@google.com")
        XCTAssertEqual(CallCountry.seriesKey(of: "a00c@google.com"), "a00c@google.com")
        XCTAssertEqual(CallCountry.seriesKey(of: "room:meet.google.com/abc-defg-hij"), "room:meet.google.com/abc-defg-hij")
        XCTAssertEqual(CallCountry.seriesKey(of: ":2026-10-26"), ":2026-10-26", "пустой остаток — ключ как есть")
    }

    func testParseCountryWithTasksSkipsBrokenRows() {
        let info = CallCountryInfo.parse(json("""
        {"series_key":"k","country":"rs","suggested":"SI","markets":["RS","SI"],
         "tasks":[{"id":"1","title":"Договор","due_date":"2026-10-27","status":"open"},
                  {"id":"","title":"без id"},{"id":"2","title":"  "},{"id":"3","title":"Лицензия","due_date":null}]}
        """))
        XCTAssertEqual(info?.country, "RS")
        XCTAssertNil(info?.suggested, "при метке подсказка не нужна")
        XCTAssertEqual(info?.markets, ["RS", "SI"])
        XCTAssertEqual(info?.tasks.map(\.id), ["1", "3"])
        XCTAssertEqual(info?.tasks.first?.dueDate, "2026-10-27")
    }

    func testParseUnmarkedKeepsSuggestionAndDropsTasks() {
        let info = CallCountryInfo.parse(json(#"{"series_key":"k","country":null,"suggested":"SI","markets":["SI"],"tasks":[{"id":"1","title":"x"}]}"#))
        XCTAssertNil(info?.country)
        XCTAssertEqual(info?.suggested, "SI")
        XCTAssertEqual(info?.tasks, [])
    }

    func testParseRejectsNonObjectAndMissingKey() {
        XCTAssertNil(CallCountryInfo.parse(json("[]")))
        XCTAssertNil(CallCountryInfo.parse(json(#"{"country":"RS"}"#)))
        XCTAssertNil(CallCountryInfo.parse(json("not json")))
    }

    func testDecide() {
        let task = BoardTask(id: "1", title: "t")
        let marked = CallCountryInfo(seriesKey: "k", country: "RS", markets: ["RS"], tasks: [task])
        XCTAssertEqual(CallCountry.decide(marked, declined: false), .country(code: "RS", tasks: [task]))
        XCTAssertEqual(CallCountry.decide(marked, declined: true), .country(code: "RS", tasks: [task]),
                       "«Нет» гасит вопрос, а не размеченную страну")
        let guess = CallCountryInfo(seriesKey: "k", suggested: "SI", markets: ["RS", "SI"])
        XCTAssertEqual(CallCountry.decide(guess, declined: false), .ask(suggested: "SI"))
        XCTAssertEqual(CallCountry.decide(guess, declined: true), .none, "после «Нет» не переспрашиваем")
        XCTAssertEqual(CallCountry.decide(CallCountryInfo(seriesKey: "k"), declined: false), .none)
        XCTAssertEqual(CallCountry.decide(nil, declined: false), .none)
        let outside = CallCountryInfo(seriesKey: "k", suggested: "SI", markets: ["RS"])
        XCTAssertEqual(CallCountry.decide(outside, declined: false), .none, "страны нет среди рынков — не предлагаем")
    }

    func testCurrentCallNeedsLinkAndOpenTabWhenSeveral() {
        struct M { let key: String; let link: Bool; let open: Bool }
        let one = [M(key: "a", link: true, open: false), M(key: "slot", link: false, open: false)]
        XCTAssertEqual(CallCountry.currentCall(one, hasLink: \.link, isOpen: \.open)?.key, "a")
        let two = [M(key: "a", link: true, open: false), M(key: "b", link: true, open: true)]
        XCTAssertEqual(CallCountry.currentCall(two, hasLink: \.link, isOpen: \.open)?.key, "b")
        let unknown = [M(key: "a", link: true, open: false), M(key: "b", link: true, open: false)]
        XCTAssertNil(CallCountry.currentCall(unknown, hasLink: \.link, isOpen: \.open), "два созвона, вкладка не открыта — неизвестно")
        XCTAssertNil(CallCountry.currentCall([M](), hasLink: \.link, isOpen: \.open))
    }

    func testFlagAndLabel() {
        XCTAssertEqual(CallCountry.flag("rs"), "🇷🇸")
        XCTAssertEqual(CallCountry.flag("SI"), "🇸🇮")
        XCTAssertEqual(CallCountry.flag("XYZ"), "")
        XCTAssertEqual(CallCountry.flag("1A"), "")
        XCTAssertEqual(CallCountry.label("RS", lang: "ru"), "🇷🇸 Сербия")
        XCTAssertEqual(CallCountry.label("SI", lang: "en"), "🇸🇮 Slovenia")
    }

    func testRememberDedupesAndCaps() {
        XCTAssertEqual(CallCountry.remember("b", in: ["a", "b", "c"]), ["a", "c", "b"])
        let many = (0..<CallCountry.declinedLimit).map(String.init)
        let out = CallCountry.remember("new", in: many)
        XCTAssertEqual(out.count, CallCountry.declinedLimit)
        XCTAssertEqual(out.last, "new")
        XCTAssertFalse(out.contains("0"), "самая старая вытеснена")
    }

    func testTrackerFetchesOncePerKeyPerCall() {
        var t = CallCountryTracker()
        XCTAssertEqual(t.tick(micOn: true, key: "a"), .fetch(key: "a"))
        XCTAssertEqual(t.tick(micOn: true, key: "a"), .none, "тот же созвон — второй раз не зовём")
        XCTAssertEqual(t.tick(micOn: true, key: nil), .none, "провал календаря режим не снимает")
        XCTAssertEqual(t.tick(micOn: true, key: "a"), .none)
        XCTAssertEqual(t.tick(micOn: true, key: "b"), .fetch(key: "b"), "перешёл на другой созвон")
    }

    func testTrackerEndedResetsSoNextCallFetchesAgain() {
        var t = CallCountryTracker()
        XCTAssertEqual(t.tick(micOn: false, key: nil), .none, "звонка не было — снимать нечего")
        _ = t.tick(micOn: true, key: "a")
        XCTAssertEqual(t.tick(micOn: false, key: "a"), .ended)
        XCTAssertEqual(t.tick(micOn: false, key: "a"), .none)
        XCTAssertEqual(t.tick(micOn: true, key: "a"), .fetch(key: "a"), "новый звонок той же встречи")
    }

    func testTrackerRetriesAfterFailure() {
        var t = CallCountryTracker()
        _ = t.tick(micOn: true, key: "a")
        t.failed(key: "a")
        XCTAssertEqual(t.tick(micOn: true, key: "a"), .fetch(key: "a"))
    }

    func testRequestBuilders() {
        let url = BoardRequests.callURL(ingestBase: "https://x.test/functions/v1/", key: "a@g.com:2026-10-26", title: "Serbia sync")
        XCTAssertEqual(url?.path, "/functions/v1/swarm-api/board/call")
        let items = URLComponents(url: url!, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(items?.first { $0.name == "key" }?.value, "a@g.com:2026-10-26")
        XCTAssertEqual(items?.first { $0.name == "title" }?.value, "Serbia sync")
        let noTitle = BoardRequests.callURL(ingestBase: "https://x.test", key: "k", title: nil)
        XCTAssertNil(URLComponents(url: noTitle!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "title" })

        func body(_ c: String?) -> [String: Any]? {
            BoardRequests.callCountryBody(key: "k", country: c).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        }
        XCTAssertEqual(body("RS")?["country"] as? String, "RS")
        XCTAssertTrue(body(nil)?["country"] is NSNull, "снять метку — явный null")
        XCTAssertEqual(body("RS")?["key"] as? String, "k")
    }
}
