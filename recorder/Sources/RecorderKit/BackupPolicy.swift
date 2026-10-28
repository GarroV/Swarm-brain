import Foundation

// Политика «ни одна запись не теряется» (#1070, решение владельца 27.10.2026): всё, что рекордер
// записал, уезжает на сервер — даже отклонённое. Здесь только чистые решения; файлы и сеть — в
// UploadQueue/SwarmClient (они не тестируются без AppKit).

/// Почему запись попала в карантин. rawValue уходит на сервер полем `reason` бэкапа.
public enum QuarantineReason: String, Codable, Sendable {
    case deferred    // сервер отдал транскрибацию другому участнику (decision=defer)
    case rejected    // постоянный отказ ingest (4xx)
    case exhausted   // исчерпаны попытки заливки
    case other
}

public enum BackupPolicy {
    /// Потолок хранения — и на Маке, и на сервере: 3 суток от конца встречи.
    public static let ttl: TimeInterval = 3 * 24 * 60 * 60
    /// Не чаще раза в 20 минут на запись повторно подаём claim.
    public static let reclaimInterval: TimeInterval = 20 * 60
    /// Сколько неудачных попыток заливки бэкапа допускаем (токен-ошибки не считаются).
    public static let maxBackupAttempts = 8

    public enum FailureClass: Equatable, Sendable {
        case permanent    // 4xx: повторять бессмысленно (не участник, встречи нет, слишком большое)
        case authExpired  // 401: токен обновят — пробуем позже, попытку не тратим
        case transient    // сеть, 5xx, 429, 408
    }

    /// nil — не дошли до ответа (сеть).
    public static func classify(httpStatus: Int?) -> FailureClass {
        guard let code = httpStatus else { return .transient }
        if code == 401 { return .authExpired }
        if code == 408 || code == 429 { return .transient }
        if (400...499).contains(code) { return .permanent }
        return .transient
    }

    /// Основная заливка в дрейне: любой отказ, кроме временного, — в карантин (не в тихий dead-letter).
    public static func isPermanentUploadFailure(httpStatus: Int?) -> Bool {
        classify(httpStatus: httpStatus) != .transient
    }

    // ── Бэкап на сервер ──────────────────────────────────────────────────────
    public static func shouldUploadBackup(
        backupUploaded: Bool, gaveUp: Bool, attempts: Int, ageSeconds: TimeInterval
    ) -> Bool {
        if backupUploaded || gaveUp { return false }
        if attempts >= maxBackupAttempts { return false }
        return ageSeconds <= ttl
    }

    public static func afterBackupFailure(_ failure: FailureClass, attempts: Int) -> (attempts: Int, gaveUp: Bool) {
        switch failure {
        case .permanent: return (attempts, true)
        case .authExpired: return (attempts, false)
        case .transient:
            let next = attempts + 1
            return (next, next >= maxBackupAttempts)
        }
    }

    // ── Повторная заявка (claim) ─────────────────────────────────────────────
    public static func shouldReclaim(
        hasClaimRetry: Bool, stopped: Bool, lastAttemptAt: Date?, ageSeconds: TimeInterval, now: Date
    ) -> Bool {
        guard hasClaimRetry, !stopped, ageSeconds <= ttl else { return false }
        guard let last = lastAttemptAt else { return true }
        return now.timeIntervalSince(last) >= reclaimInterval
    }

    public enum ReclaimVerdict: Equatable, Sendable {
        case takeOver   // право получено — вернуть в очередь заливки
        case stop       // больше не пробовать
        case tryLater   // повторить через интервал
    }

    public static func afterReclaim(shouldTranscribe: Bool, deferReason: String?) -> ReclaimVerdict {
        if shouldTranscribe { return .takeOver }
        // Опубликованную встречу перехватить нельзя ни при какой длительности (arbiter, issue #274).
        return deferReason == "published" ? .stop : .tryLater
    }

    public static func afterReclaimError(_ failure: FailureClass) -> ReclaimVerdict {
        failure == .permanent ? .stop : .tryLater
    }
}
