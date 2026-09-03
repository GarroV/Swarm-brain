import XCTest
@testable import RecorderKit

// Переливание значка в простое (просьба владельца 03.09.2026).
final class IdleShimmerTests: XCTestCase {
    func testShimmersOnlyAfterSilenceHolds() {
        // Тихо, но недолго — рано: пауза в речи не повод мигать.
        XCTAssertFalse(IdleShimmer.shouldShimmer(micLevel: 0, systemLevel: 0, silentTicks: 3))
        // Тишина держится — переливаемся.
        XCTAssertTrue(IdleShimmer.shouldShimmer(micLevel: 0, systemLevel: 0,
                                                silentTicks: IdleShimmer.silentTicksToStart))
    }

    func testAnySoundStopsShimmerImmediately() {
        // Заговорил я.
        XCTAssertFalse(IdleShimmer.shouldShimmer(micLevel: 0.4, systemLevel: 0, silentTicks: 100))
        // Или собеседник в системной дорожке — тоже не простой.
        XCTAssertFalse(IdleShimmer.shouldShimmer(micLevel: 0, systemLevel: 0.4, silentTicks: 100))
    }

    func testPhaseIsATriangleWaveWithoutJumpAtTheSeam() {
        let frames = 8
        XCTAssertEqual(IdleShimmer.phase(step: 0, frames: frames), 0, accuracy: 0.001)
        XCTAssertEqual(IdleShimmer.phase(step: frames - 1, frames: frames), 1, accuracy: 0.001)
        // Через полный период возвращаемся в ноль — цикл замкнут без скачка.
        XCTAssertEqual(IdleShimmer.phase(step: (frames - 1) * 2, frames: frames), 0, accuracy: 0.001)
        // Соседние кадры отличаются не больше, чем на один шаг: скачков внутри нет.
        let stepSize = 1.0 / CGFloat(frames - 1)
        for i in 0..<((frames - 1) * 2) {
            let d = abs(IdleShimmer.phase(step: i + 1, frames: frames) - IdleShimmer.phase(step: i, frames: frames))
            XCTAssertLessThanOrEqual(d, stepSize + 0.001, "скачок фазы на кадре \(i)")
        }
    }

    func testPhaseSurvivesNegativeAndHugeSteps() {
        XCTAssertGreaterThanOrEqual(IdleShimmer.phase(step: -5, frames: 8), 0)
        XCTAssertLessThanOrEqual(IdleShimmer.phase(step: 10_000, frames: 8), 1)
        // Один кадр — деления на ноль нет.
        XCTAssertEqual(IdleShimmer.phase(step: 3, frames: 1), 0, accuracy: 0.001)
    }
}
