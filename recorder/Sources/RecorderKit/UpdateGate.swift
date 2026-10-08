import Foundation

// Когда рекордеру спрашивать сервер о новой сборке (issue #843).
//
// До сборки 37 проверку держали два замка, и оба могли закрыться навсегда — до перезапуска
// приложения, которого человек не делает неделями:
//   • флаг «хелпер обновления уже запущен» взводился один раз за сессию и не сбрасывался. Хелпер
//     при сбое (нет сети, файла, сертификата) молча выходит, приложение живёт дальше на старой
//     сборке — и больше никогда не спрашивает сервер;
//   • проверка шла только в состоянии «простой». Залипшая ошибка («отправка зависла», «нет
//     сети», «токен истёк», «нет доступа к экрану») отключала обновления на всё время, пока висит.
// На 07.10.2026 так стояли трое из шести: две сборки 32 и одна 26, ни одного запроса версии.
//
// Теперь: обновление не трогает только запись и отправку (их рвать нельзя), а запуск хелпера —
// не навсегда: если через `attemptTimeout` приложение всё ещё живо, попытка считается
// сорвавшейся и повторяется через `retryAfterFailure`, а не через обычные 6 часов.
public enum UpdateGate {
    /// Обычная пауза между проверками: релизы редкие.
    public static let checkInterval: TimeInterval = 6 * 3600
    /// Удачный хелпер перезапускает приложение за минуты; живы дольше — значит, не вышло. Больше
    /// получаса: хелпер до 30 минут ждёт конца записи, начавшейся уже после его запуска, и второй
    /// хелпер поверх первого запускать нельзя.
    public static let attemptTimeout: TimeInterval = 45 * 60
    /// После сорвавшейся попытки пробуем снова через час, а не через шесть.
    public static let retryAfterFailure: TimeInterval = 3600

    public enum Activity: Equatable {
        /// Простой или залипшая ошибка — обновляться можно.
        case free
        /// Идёт запись или отправка — не трогаем.
        case busy
    }

    public enum Verdict: Equatable {
        case check
        case wait
        case busy
    }

    /// - Parameters:
    ///   - spawnedAt: когда в этой сессии запущен хелпер (nil — не запускался).
    ///   - lastCheckAt: когда последний раз спрашивали сервер (nil — ещё ни разу).
    ///   - lastAttemptFailed: прошлая попытка сорвалась — пауза короче.
    public static func verdict(
        activity: Activity,
        spawnedAt: Date?,
        lastCheckAt: Date?,
        lastAttemptFailed: Bool,
        now: Date
    ) -> Verdict {
        if activity == .busy { return .busy }
        if let spawnedAt, now.timeIntervalSince(spawnedAt) < attemptTimeout { return .wait }
        guard let lastCheckAt else { return .check }
        let pause = lastAttemptFailed ? retryAfterFailure : checkInterval
        return now.timeIntervalSince(lastCheckAt) >= pause ? .check : .wait
    }

    /// Запущенный хелпер не перезапустил приложение за `attemptTimeout` — попытка сорвалась.
    public static func attemptFailed(spawnedAt: Date?, now: Date) -> Bool {
        guard let spawnedAt else { return false }
        return now.timeIntervalSince(spawnedAt) >= attemptTimeout
    }

    /// Хвост журнала хелпера для диагностики: последние `limit` непустых строк, начиная со строки
    /// запуска именно этой попытки (по ней видно, на каком шаге хелпер сдался).
    public static func attemptTail(log: String, limit: Int = 12) -> [String] {
        let lines = log.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        let start = lines.lastIndex(where: { $0.contains("self-update: current build") }) ?? 0
        return Array(lines[start...].suffix(limit))
    }
}
