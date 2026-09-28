import XCTest
@testable import RecorderKit

// Ворота «разговор начался» (issue #379). Ложное «открыто» возвращает старый дефект — запись,
// начатая до встречи, обрывается в лобби. Ложное «закрыто» после начала разговора отключает
// обычный конец звонка, и запись тянется до бэкстопа в 15 минут.
final class ConversationGateTests: XCTestCase {
    private func gate(_ ticks: [Bool]) -> ConversationGate {
        var g = ConversationGate()
        ticks.forEach { g.observe(otherSideAudible: $0) }
        return g
    }

    func testВЛоббиБезСобеседниковВоротаЗакрыты() {
        XCTAssertFalse(gate(Array(repeating: false, count: 36)).isOpen)
    }

    func testОдиночныйЗвукВходаНеОткрываетВорота() {
        XCTAssertFalse(gate([false, true, false, false, true, false]).isOpen)
    }

    func testДваГромкихТикаПодрядОткрываютВорота() {
        XCTAssertTrue(gate([false, false, true, true]).isOpen)
    }

    func testПаузаВРазговореНеЗакрываетВорота() {
        let ticks = [true, true] + Array(repeating: false, count: 100)
        XCTAssertTrue(gate(ticks).isOpen)
    }

    func testНоваяЗаписьНачинаетСЗакрытыхВорот() {
        XCTAssertFalse(ConversationGate().isOpen)
    }
}
