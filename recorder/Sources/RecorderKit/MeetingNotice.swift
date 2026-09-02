import Foundation

// Текст уведомления о встрече: что человек читает в баннере macOS.
//
// Решение владельца 02.09.2026 (#193): «хочу чтобы уведомления выглядели лаконичнее,
// аккуратнее, мягче + чтобы была кнопка перехода на встречу». Канон —
// docs/decisions/2026-09-02-pill-and-join-button.md.
//
// Отсюда раскладка:
//   заголовок  → НАЗВАНИЕ встречи (то, что человек ищет глазами)
//   подзаголовок → «9:00 – 10:00 · через 5 мин» (время слота целиком + обратный счёт)
//   действия   → кнопки, а не вопрос в тексте
//
// Было: заголовок «Встреча через 5 мин», тело «„Weekly BD sync“ — записать?» — название
// прятали в кавычки во второй строке, а вопрос дублировал кнопку.
//
// Время слота даёт системный формат (`timeStyle = .short`): в русской локали «9:00»,
// в английской «9:00 AM» — продукт двуязычный, выдумывать свой формат нельзя.
public struct MeetingNotice: Equatable, Sendable {
    public let title: String
    public let subtitle: String

    public init(title: String, subtitle: String) {
        self.title = title
        self.subtitle = subtitle
    }

    /// Встреча без названия — всё равно встреча: пустой заголовок читается как сбой.
    public static let untitled = "Встреча"
    public static let ongoing = "идёт"

    public static func compose(title: String?, start: Date?, end: Date?, now: Date,
                               locale: Locale = .current, timeZone: TimeZone = .current) -> MeetingNotice {
        let name = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = timeZone
        f.timeStyle = .short
        f.dateStyle = .none

        var parts: [String] = []
        if let start {
            parts.append(end.map { "\(f.string(from: start)) – \(f.string(from: $0))" } ?? f.string(from: start))
        }
        parts.append(countdown(to: start, now: now))

        return MeetingNotice(title: name.isEmpty ? untitled : name,
                             subtitle: parts.joined(separator: " · "))
    }

    /// «через N мин» до начала, «идёт» — если началась или времени нет.
    /// Меньше минуты — это «через 1 мин», а не «через 0 мин»: ноль врёт.
    private static func countdown(to start: Date?, now: Date) -> String {
        guard let start else { return ongoing }
        let seconds = start.timeIntervalSince(now)
        guard seconds > 0 else { return ongoing }
        return "через \(max(1, Int(ceil(seconds / 60)))) мин"
    }
}
