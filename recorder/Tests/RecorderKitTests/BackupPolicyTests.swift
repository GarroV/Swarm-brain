import XCTest
@testable import RecorderKit

// Ядро «ни одна запись не теряется» (#1070): когда слать бэкап на сервер, когда перезаявляться,
// какой сбой постоянный. Ошибка здесь = молча потерянная запись встречи.
final class BackupPolicyTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000)
    private func ago(_ s: TimeInterval) -> Date { now.addingTimeInterval(-s) }

    // ── Классификация HTTP ────────────────────────────────────────────────────
    func testПостоянныеОтказы() {
        for code in [400, 403, 404, 409, 413, 422] {
            XCTAssertEqual(BackupPolicy.classify(httpStatus: code), .permanent, "HTTP \(code)")
        }
    }

    func testВременныеСбоиНеПостоянные() {
        for code in [408, 429, 500, 502, 503, 504] {
            XCTAssertEqual(BackupPolicy.classify(httpStatus: code), .transient, "HTTP \(code)")
        }
        XCTAssertEqual(BackupPolicy.classify(httpStatus: nil), .transient, "сеть")
    }

    func testИстёкшийТокенОтдельныйКласс() {
        XCTAssertEqual(BackupPolicy.classify(httpStatus: 401), .authExpired)
    }

    // ── Слать ли бэкап ────────────────────────────────────────────────────────
    func testНовуюЗаписьВКарантинеБэкапимСразу() {
        XCTAssertTrue(BackupPolicy.shouldUploadBackup(
            backupUploaded: false, gaveUp: false, attempts: 0, ageSeconds: 60))
    }

    func testУжеЗалитыйБэкапНеШлёмПовторно() {
        XCTAssertFalse(BackupPolicy.shouldUploadBackup(
            backupUploaded: true, gaveUp: false, attempts: 0, ageSeconds: 60))
    }

    func testПослеПостоянногоОтказаБольшеНеПробуем() {
        XCTAssertFalse(BackupPolicy.shouldUploadBackup(
            backupUploaded: false, gaveUp: true, attempts: 1, ageSeconds: 60))
    }

    func testПопыткиОграничены() {
        XCTAssertTrue(BackupPolicy.shouldUploadBackup(
            backupUploaded: false, gaveUp: false, attempts: BackupPolicy.maxBackupAttempts - 1, ageSeconds: 60))
        XCTAssertFalse(BackupPolicy.shouldUploadBackup(
            backupUploaded: false, gaveUp: false, attempts: BackupPolicy.maxBackupAttempts, ageSeconds: 60))
    }

    func testСтаршеТрёхСутокБэкапНеШлём() {
        XCTAssertFalse(BackupPolicy.shouldUploadBackup(
            backupUploaded: false, gaveUp: false, attempts: 0, ageSeconds: BackupPolicy.ttl + 1))
    }

    func testПослеСбоя_постоянный_закрываетБэкап() {
        let r = BackupPolicy.afterBackupFailure(.permanent, attempts: 0)
        XCTAssertTrue(r.gaveUp)
    }

    func testПослеСбоя_временный_считаетПопытку() {
        let r = BackupPolicy.afterBackupFailure(.transient, attempts: 2)
        XCTAssertEqual(r.attempts, 3)
        XCTAssertFalse(r.gaveUp)
    }

    func testПослеСбоя_последняяПопыткаЗакрываетБэкап() {
        let r = BackupPolicy.afterBackupFailure(.transient, attempts: BackupPolicy.maxBackupAttempts - 1)
        XCTAssertTrue(r.gaveUp)
    }

    func testИстёкшийТокенПопыткуНеСчитает() {
        let r = BackupPolicy.afterBackupFailure(.authExpired, attempts: 4)
        XCTAssertEqual(r.attempts, 4)
        XCTAssertFalse(r.gaveUp)
    }

    // ── Пора ли перезаявляться ────────────────────────────────────────────────
    func testБезДанныхЗаявкиНеПерезаявляемся() {
        XCTAssertFalse(BackupPolicy.shouldReclaim(
            hasClaimRetry: false, stopped: false, lastAttemptAt: nil, ageSeconds: 60, now: now))
    }

    func testНеЧащеРазаВДвадцатьМинут() {
        XCTAssertFalse(BackupPolicy.shouldReclaim(
            hasClaimRetry: true, stopped: false, lastAttemptAt: ago(19 * 60), ageSeconds: 3600, now: now))
        XCTAssertTrue(BackupPolicy.shouldReclaim(
            hasClaimRetry: true, stopped: false, lastAttemptAt: ago(20 * 60), ageSeconds: 3600, now: now))
    }

    func testНикогдаНеПробовали_пробуем() {
        XCTAssertTrue(BackupPolicy.shouldReclaim(
            hasClaimRetry: true, stopped: false, lastAttemptAt: nil, ageSeconds: 3600, now: now))
    }

    func testОстановленнуюНеТревожим() {
        XCTAssertFalse(BackupPolicy.shouldReclaim(
            hasClaimRetry: true, stopped: true, lastAttemptAt: nil, ageSeconds: 3600, now: now))
    }

    func testСтаршеТрёхСутокНеПерезаявляемся() {
        XCTAssertFalse(BackupPolicy.shouldReclaim(
            hasClaimRetry: true, stopped: false, lastAttemptAt: ago(3600), ageSeconds: BackupPolicy.ttl + 1, now: now))
    }

    // ── Что делать с ответом на повторную заявку ─────────────────────────────
    func testПравоПолученоЗаливаем() {
        XCTAssertEqual(BackupPolicy.afterReclaim(shouldTranscribe: true, deferReason: nil), .takeOver)
    }

    func testОпубликованоБольшеНеПробуем() {
        XCTAssertEqual(BackupPolicy.afterReclaim(shouldTranscribe: false, deferReason: "published"), .stop)
    }

    func testДругиеПричиныОтказаПробуемПозже() {
        for reason in ["shorter", "race", "unknown", nil] {
            XCTAssertEqual(BackupPolicy.afterReclaim(shouldTranscribe: false, deferReason: reason), .tryLater,
                           "\(reason ?? "nil")")
        }
    }

    func testОшибкаЗаявки_постоянная_останавливает() {
        XCTAssertEqual(BackupPolicy.afterReclaimError(.permanent), .stop)
        XCTAssertEqual(BackupPolicy.afterReclaimError(.transient), .tryLater)
        XCTAssertEqual(BackupPolicy.afterReclaimError(.authExpired), .tryLater)
    }

    // ── Причина карантина ─────────────────────────────────────────────────────
    func testПричинаДляСервера() {
        XCTAssertEqual(QuarantineReason.deferred.rawValue, "deferred")
        XCTAssertEqual(QuarantineReason.rejected.rawValue, "rejected")
        XCTAssertEqual(QuarantineReason.exhausted.rawValue, "exhausted")
        XCTAssertEqual(QuarantineReason.other.rawValue, "other")
    }

    func testЗаливкаВДрейне_постоянныйСбойЭтоКарантин() {
        XCTAssertTrue(BackupPolicy.isPermanentUploadFailure(httpStatus: 403))
        XCTAssertTrue(BackupPolicy.isPermanentUploadFailure(httpStatus: 401))
        XCTAssertFalse(BackupPolicy.isPermanentUploadFailure(httpStatus: 503))
        XCTAssertFalse(BackupPolicy.isPermanentUploadFailure(httpStatus: 429))
    }
}
