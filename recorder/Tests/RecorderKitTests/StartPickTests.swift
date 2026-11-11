import XCTest
@testable import RecorderKit

// Выбор встречи на старте (issue #1278). Ошибка молчалива: запись уезжает в чужую встречу и просто
// пропадает у автора — поэтому каждый порядок и каждый итог закреплён явно.
final class StartPickTests: XCTestCase {
    private let a = StartPick.Event(key: "cal:a", title: "CEE biweekly")
    private let b = StartPick.Event(key: "cal:b", title: "Bulgaria")
    private let none = Set<String>()

    private func kinds(_ o: [StartPick.Option]) -> [StartPick.Kind] { o.map(\.kind) }

    // ── needsPick ────────────────────────────────────────────────────────────
    func testОдноСобытиеБезБотаНеСпрашивает() {
        XCTAssertFalse(StartPick.needsPick(live: [a], botIn: none, botLeft: none))
    }

    func testБотПишетЧужуюВстречуНеМешаетОдномуСобытию() {
        XCTAssertFalse(StartPick.needsPick(live: [a], botIn: ["cal:zzz"], botLeft: none))
    }

    func testДваСобытияСпрашивают() {
        XCTAssertTrue(StartPick.needsPick(live: [a, b], botIn: none, botLeft: none))
    }

    func testОдноСобытиеКотороеПишетБотСпрашивает() {
        XCTAssertTrue(StartPick.needsPick(live: [a], botIn: ["cal:a"], botLeft: none))
    }

    func testОдноСобытиеКоторуюБотПисалИВышелСпрашивает() {
        XCTAssertTrue(StartPick.needsPick(live: [a], botIn: none, botLeft: ["cal:a"]))
    }

    func testНетСобытийСпрашиватьНеОЧем() {
        XCTAssertFalse(StartPick.needsPick(live: [], botIn: ["cal:a"], botLeft: none))
    }

    // ── options ──────────────────────────────────────────────────────────────
    func testБезБотаСобытияПотомДругойЗвонок() {
        let o = StartPick.options(live: [a, b], botIn: none, botLeft: none)
        XCTAssertEqual(kinds(o), [.calendar, .calendar, .other])
        XCTAssertEqual(o.compactMap(\.key), ["cal:a", "cal:b"])
    }

    func testБотУжеВышелПродолжениеПервое() {
        let o = StartPick.options(live: [a, b], botIn: none, botLeft: ["cal:a"])
        XCTAssertEqual(kinds(o), [.continuation, .calendar, .other])
        XCTAssertEqual(o.first?.key, "cal:a")
    }

    func testБотЕщёВоВстречеДругойЗвонокПервый() {
        let o = StartPick.options(live: [a, b], botIn: ["cal:a"], botLeft: none)
        XCTAssertEqual(kinds(o), [.other, .calendar, .continuation])
    }

    func testОдноСобытиеБотВоВстречеДругойЗвонокПервыйИПродолжениеЕсть() {
        let o = StartPick.options(live: [a], botIn: ["cal:a"], botLeft: none)
        XCTAssertEqual(kinds(o), [.other, .continuation])
    }

    func testБотВышелПоОдномуИВоВторомЕщёЕстьДругойЗвонокПервый() {
        let o = StartPick.options(live: [a, b], botIn: ["cal:b"], botLeft: ["cal:a"])
        XCTAssertEqual(o.first?.kind, .other)
        XCTAssertEqual(Set(o.compactMap { $0.kind == .continuation ? $0.key : nil }), ["cal:a", "cal:b"])
    }

    func testПовторПоКлючуНеДублируется() {
        let o = StartPick.options(live: [a, a, b], botIn: none, botLeft: none)
        XCTAssertEqual(o.compactMap(\.key), ["cal:a", "cal:b"])
    }

    func testДругойЗвонокЕстьВсегда() {
        for (bin, bleft) in [(none, none), (["cal:a"], none), (none, ["cal:a"])] as [(Set<String>, Set<String>)] {
            XCTAssertEqual(StartPick.options(live: [a, b], botIn: bin, botLeft: bleft).filter { $0.kind == .other }.count, 1)
        }
    }

    // ── resolution ───────────────────────────────────────────────────────────
    func testНетОтветаСвояРучнаяВстреча() {
        XCTAssertEqual(StartPick.resolution(for: nil), .manual)
    }

    func testДругойЗвонокЭтоManual() {
        XCTAssertEqual(StartPick.resolution(for: .init(kind: .other, key: nil, title: nil)), .manual)
    }

    func testСобытиеИПродолжениеПривязываютКСобытию() {
        XCTAssertEqual(StartPick.resolution(for: .init(kind: .calendar, key: "cal:b", title: "x")), .calendar(key: "cal:b"))
        XCTAssertEqual(StartPick.resolution(for: .init(kind: .continuation, key: "cal:a", title: "x")), .calendar(key: "cal:a"))
    }

    func testСобытиеБезКлючаНеПривязывается() {
        XCTAssertEqual(StartPick.resolution(for: .init(kind: .calendar, key: nil, title: "x")), .manual)
    }

    // ── переименование ───────────────────────────────────────────────────────
    func testПереименованиеКалендарнойОтвязывает() {
        XCTAssertTrue(StartPick.detachesOnRename(kind: "calendar", identityTitle: "CEE biweekly", override: "Весела Болгария"))
    }

    func testТоТожеНазваниеНеОтвязывает() {
        XCTAssertFalse(StartPick.detachesOnRename(kind: "calendar", identityTitle: "CEE biweekly", override: "CEE biweekly"))
        XCTAssertFalse(StartPick.detachesOnRename(kind: "calendar", identityTitle: "CEE  biweekly", override: " CEE biweekly "))
    }

    func testПустоеНазваниеНеОтвязывает() {
        XCTAssertFalse(StartPick.detachesOnRename(kind: "calendar", identityTitle: "CEE", override: nil))
        XCTAssertFalse(StartPick.detachesOnRename(kind: "calendar", identityTitle: "CEE", override: "  "))
    }

    func testManualИКомнатаНеМеняютПривязку() {
        XCTAssertFalse(StartPick.detachesOnRename(kind: "manual", identityTitle: nil, override: "Моя"))
        XCTAssertFalse(StartPick.detachesOnRename(kind: "room", identityTitle: nil, override: "Моя"))
    }

    func testКлючManualУникаленИМеченUUID() {
        let id = UUID()
        XCTAssertEqual(StartPick.manualKey(id), "manual:\(id.uuidString)")
        XCTAssertNotEqual(StartPick.manualKey(), StartPick.manualKey())
    }
}
