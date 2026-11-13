import Foundation

// Напоминание о записи по календарю (#219). Решение владельца 09.11.2026
// (docs/decisions/2026-11-09-reminder-instead-of-autostart.md) отменило авто-старт 18.09:
// рекордер сам запись НЕ начинает — каждая лишняя запись стоит токенов. Когда вместе есть два
// факта — рекордер видит РЕАЛЬНЫЙ созвон (тот же сигнал, по которому капсула предлагает
// «Записать») и в календаре человека идёт или вот-вот начнётся плановая встреча, — капсула
// переходит в заметный режим «напоминание»: акцентная обводка, пульс, кнопки «Записать» и
// «Не сейчас». Без отсчёта и без автозапуска: запускает человек.
// Личные события не фильтруем (03.09): без реального созвона напоминания не будет.
//
// Здесь только чистая логика: «напоминать ли и о каких встречах». Капсула, закрытие и сам старт
// записи — в SwarmRecorder, тем же путём, что ручное «Записать».
public enum CallReminder {
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
        case alreadyRecording
        case noMeeting
        case noCall            // реального созвона нет — одно событие в календаре напоминания не даёт
        case tooEarly          // слот начнётся позже, чем через leadSeconds (или начала нет — не гадаем)
        case ended
        case recordedByOther   // встречу уже пишет бот или чужой рекордер (#821)
        case dismissed         // человек нажал «Не сейчас» для этой встречи
    }

    public enum Decision: Equatable, Sendable {
        /// Напомнить о записи этих встреч (лучшая первой). Больше одной — человек выбирает в капсуле.
        case remind(keys: [String])
        case skip(Skip)
    }

    /// - Parameters:
    ///   - meetings: идущие/ближайшие события из meeting-current, лучшее первым. «Идёт сейчас» —
    ///     слот начался или начнётся в пределах `StartIdentity.leadSeconds` (как у ручного старта).
    ///   - callActive: рекордер сейчас видит реальный созвон (CallDetector); неизвестно = false.
    ///   - isRecording: рекордер уже пишет.
    ///   - recordedNow: ключи встреч, которые прямо сейчас пишет бот или чужой рекордер.
    ///   - dismissed: ключи, для которых человек нажал «Не сейчас» (помним до конца события).
    /// Если подходящих нет, причина берётся по лучшей встрече: она видна в журнале.
    public static func decide(meetings: [Meeting], now: Date, callActive: Bool, isRecording: Bool,
                              recordedNow: [String], dismissed: Set<String>) -> Decision {
        guard !isRecording else { return .skip(.alreadyRecording) }
        guard callActive else { return .skip(.noCall) }
        guard !meetings.isEmpty else { return .skip(.noMeeting) }
        var firstReason: Skip?
        var eligible: [String] = []
        for m in meetings {
            if let r = reason(m, now: now, recordedNow: recordedNow, dismissed: dismissed) {
                firstReason = firstReason ?? r
            } else if !eligible.contains(m.key) {
                eligible.append(m.key)
            }
        }
        return eligible.isEmpty ? .skip(firstReason ?? .noMeeting) : .remind(keys: eligible)
    }

    private static func reason(_ m: Meeting, now: Date, recordedNow: [String], dismissed: Set<String>) -> Skip? {
        if dismissed.contains(m.key) { return .dismissed }
        if recordedNow.contains(m.key) { return .recordedByOther }
        if let end = m.end, now >= end { return .ended }
        guard let start = m.start, now >= start.addingTimeInterval(-StartIdentity.leadSeconds) else { return .tooEarly }
        return nil
    }
}
