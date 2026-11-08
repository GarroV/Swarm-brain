import Foundation

// Авто-старт записи по календарю (issue #219). Решение владельца 03.09.2026: личные встречи —
// ответственность сотрудника, поэтому фильтра «созвон или нет» нет; единственный и достаточный
// механизм отказа — 5-секундный отсчёт в капсуле с кнопкой «Отменить». Нет отсчёта — нет старта.
// Канон: docs/decisions/2026-09-03-autostart-private-events.md.
//
// Здесь только чистая логика: «стартовать ли» (decide) и автомат отсчёта (AutoStartCountdown).
// Таймеры, капсула и сам старт записи — в AppDelegate, тем же путём, что ручное «Записать».
public enum CalendarAutoStart {
    public struct Meeting: Equatable, Sendable {
        public let key: String
        public let start: Date?
        public let end: Date?

        public init(key: String, start: Date?, end: Date?) {
            self.key = key
            self.start = start
            self.end = end
        }
    }

    public enum Skip: Equatable, Sendable {
        case disabled          // тумблер выключен (или старый сервер поля не шлёт)
        case alreadyRecording
        case noMeeting
        case notStarted        // слот ещё не начался (или начала нет — угадывать не берёмся)
        case ended
        case recordedByOther   // встречу уже пишет бот или чужой рекордер (#821)
        case cancelled         // человек отменил авто-старт этой встречи
    }

    public enum Decision: Equatable, Sendable {
        case start(key: String)
        case skip(Skip)
    }

    /// - Parameters:
    ///   - meetings: идущие/ближайшие события из meeting-current, лучшее первым.
    ///   - autoStartEnabled: `auto_start` из ответа сервера; отсутствие поля = false.
    ///   - isRecording: рекордер уже пишет.
    ///   - recordedNow: ключи встреч, которые прямо сейчас пишет бот или чужой рекордер.
    ///   - cancelled: ключи, которые человек отменил (или которые уже стартовали) до конца слота.
    /// Если подходящих нет, причина берётся по лучшей встрече: она видна в журнале.
    public static func decide(meetings: [Meeting], now: Date, autoStartEnabled: Bool, isRecording: Bool,
                              recordedNow: [String], cancelled: Set<String>) -> Decision {
        guard autoStartEnabled else { return .skip(.disabled) }
        guard !isRecording else { return .skip(.alreadyRecording) }
        guard !meetings.isEmpty else { return .skip(.noMeeting) }
        var firstReason: Skip?
        for m in meetings {
            switch reason(m, now: now, recordedNow: recordedNow, cancelled: cancelled) {
            case nil: return .start(key: m.key)
            case let r?: firstReason = firstReason ?? r
            }
        }
        return .skip(firstReason ?? .noMeeting)
    }

    private static func reason(_ m: Meeting, now: Date, recordedNow: [String], cancelled: Set<String>) -> Skip? {
        if cancelled.contains(m.key) { return .cancelled }
        if recordedNow.contains(m.key) { return .recordedByOther }
        if let end = m.end, now >= end { return .ended }
        guard let start = m.start, now >= start else { return .notStarted }
        return nil
    }
}

/// Автомат 5-секундного отсчёта. Чистая функция шага: тик таймера и смена решения подают
/// сюда `decision`, автомат отвечает, что показать. Старт записи — только по `.fire`.
public enum AutoStartCountdown {
    public static let seconds = 5

    public enum State: Equatable, Sendable {
        case none
        case running(key: String, since: Date)
    }

    public enum Effect: Equatable, Sendable {
        case none
        case show(key: String, remaining: Int)
        case fire(key: String)
        case hide
    }

    public static func step(_ state: State, decision: CalendarAutoStart.Decision, now: Date) -> (State, Effect) {
        guard case .start(let key) = decision else {
            // Решение пропало (отмена, ручной старт, бот, конец слота) — отсчёт гасим.
            if case .running = state { return (.none, .hide) }
            return (.none, .none)
        }
        if case .running(let runningKey, let since) = state, runningKey == key {
            let left = Double(seconds) - now.timeIntervalSince(since)
            if left <= 0 { return (.none, .fire(key: key)) }
            return (state, .show(key: key, remaining: Int(left.rounded(.up))))
        }
        // Новая встреча (или первая): отсчёт с полных пяти секунд.
        return (.running(key: key, since: now), .show(key: key, remaining: seconds))
    }
}
