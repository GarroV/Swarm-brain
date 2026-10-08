import XCTest
@testable import RecorderKit

// Проверка обновления не должна закрываться навсегда (issue #843): на 07.10.2026 трое из шести
// сидели на сборках 26/32 и ни разу не спросили сервер о новой версии.
final class UpdateGateTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000)
    private func ago(_ s: TimeInterval) -> Date { now.addingTimeInterval(-s) }

    func testПервыйЗапускСпрашиваетСервер() {
        XCTAssertEqual(UpdateGate.verdict(activity: .free, spawnedAt: nil, lastCheckAt: nil,
                                          lastAttemptFailed: false, now: now), .check)
    }

    func testЗаписьИОтправкуНеТрогаем() {
        XCTAssertEqual(UpdateGate.verdict(activity: .busy, spawnedAt: nil, lastCheckAt: nil,
                                          lastAttemptFailed: false, now: now), .busy)
    }

    func testОбычнаяПаузаШестьЧасов() {
        XCTAssertEqual(UpdateGate.verdict(activity: .free, spawnedAt: nil, lastCheckAt: ago(3600),
                                          lastAttemptFailed: false, now: now), .wait)
        XCTAssertEqual(UpdateGate.verdict(activity: .free, spawnedAt: nil, lastCheckAt: ago(6 * 3600),
                                          lastAttemptFailed: false, now: now), .check)
    }

    func testПокаХелперРаботаетНеДёргаем() {
        XCTAssertEqual(UpdateGate.verdict(activity: .free, spawnedAt: ago(60), lastCheckAt: ago(60),
                                          lastAttemptFailed: false, now: now), .wait)
    }

    func testСорвавшаясяПопыткаПовторяетсяЧерезЧас() {
        // Сборки ≤36: флаг запуска хелпера держал проверку до перезапуска приложения — вечно.
        let spawned = ago(2 * 3600)
        XCTAssertTrue(UpdateGate.attemptFailed(spawnedAt: spawned, now: now))
        XCTAssertEqual(UpdateGate.verdict(activity: .free, spawnedAt: spawned, lastCheckAt: ago(3600),
                                          lastAttemptFailed: true, now: now), .check)
        XCTAssertEqual(UpdateGate.verdict(activity: .free, spawnedAt: spawned, lastCheckAt: ago(1800),
                                          lastAttemptFailed: true, now: now), .wait)
    }

    func testСвежийХелперЕщёНеСорвался() {
        XCTAssertFalse(UpdateGate.attemptFailed(spawnedAt: ago(5 * 60), now: now))
        XCTAssertFalse(UpdateGate.attemptFailed(spawnedAt: nil, now: now))
    }

    func testХвостЖурналаСоСтрокиЭтойПопытки() {
        let log = """
        [2026-09-08 14:00:00] self-update: current build 32 → build 33, app /Applications/x.app (pid 1)
        [2026-09-08 14:00:01] download failed (HTTP 404); keep current
        [2026-10-08 09:00:00] self-update: current build 32 → build 37, app /Applications/x.app (pid 2)
        [2026-10-08 09:00:01] no signing cert; skip (would break TCC)

        """
        XCTAssertEqual(UpdateGate.attemptTail(log: log), [
            "[2026-10-08 09:00:00] self-update: current build 32 → build 37, app /Applications/x.app (pid 2)",
            "[2026-10-08 09:00:01] no signing cert; skip (would break TCC)",
        ])
    }
}
