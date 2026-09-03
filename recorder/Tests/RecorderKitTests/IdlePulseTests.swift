import XCTest
@testable import RecorderKit

// Дыхание значка в простое (просьба владельца 03.09.2026).
final class IdlePulseTests: XCTestCase {
    func testPulsesOnlyAfterSilenceHolds() {
        // Тихо, но недолго — рано: пауза в речи не повод анимировать.
        XCTAssertFalse(IdlePulse.shouldPulse(micLevel: 0, systemLevel: 0, silentTicks: 3))
        // Тишина держится — дышим.
        XCTAssertTrue(IdlePulse.shouldPulse(micLevel: 0, systemLevel: 0,
                                            silentTicks: IdlePulse.silentTicksToStart))
    }

    func testAnySoundStopsPulseImmediately() {
        // Заговорил я.
        XCTAssertFalse(IdlePulse.shouldPulse(micLevel: 0.4, systemLevel: 0, silentTicks: 100))
        // Или собеседник в системной дорожке — тоже не простой.
        XCTAssertFalse(IdlePulse.shouldPulse(micLevel: 0, systemLevel: 0.4, silentTicks: 100))
    }

    func testPulseIsUnhurriedAndNeverFullyHidesTheMark() {
        // «Неторопливо» — полный цикл не меньше трёх секунд.
        XCTAssertGreaterThanOrEqual(IdlePulse.halfPeriod * 2, 3.0)
        // И значок не пропадает совсем: иначе это выглядит как сбой отрисовки.
        XCTAssertGreaterThan(IdlePulse.minOpacity, 0.3)
    }
}
