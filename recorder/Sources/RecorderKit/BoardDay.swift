import Foundation

// «Сегодня» для доски — по часам и поясу КЛИЕНТА: сервер живёт в UTC и не знает, где человек.
// Дата уходит в запросы как `date=YYYY-MM-DD`, пояс — как `tz_offset` (минуты впереди UTC).
public enum BoardDay {
    private static func calendar(_ tz: TimeZone) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        return cal
    }

    private static func string(_ date: Date, _ tz: TimeZone) -> String {
        let c = calendar(tz).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    public static func today(now: Date = Date(), timeZone: TimeZone = .current) -> String {
        string(now, timeZone)
    }

    /// Срок по умолчанию для новой задачи — завтра (правило 03.09.2026 «срок не назван — +1 сутки»).
    public static func tomorrow(now: Date = Date(), timeZone: TimeZone = .current) -> String {
        string(calendar(timeZone).date(byAdding: .day, value: 1, to: now) ?? now, timeZone)
    }

    /// Минуты впереди UTC: Белград летом +120, Нью-Йорк зимой −300.
    public static func tzOffsetMinutes(now: Date = Date(), timeZone: TimeZone = .current) -> Int {
        timeZone.secondsFromGMT(for: now) / 60
    }

    /// `YYYY-MM-DD` → полдень этого дня в поясе (для DatePicker и форматирования без сдвига суток).
    public static func date(from ymd: String, timeZone: TimeZone = .current) -> Date? {
        let parts = ymd.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var dc = DateComponents(); dc.year = parts[0]; dc.month = parts[1]; dc.day = parts[2]; dc.hour = 12
        return calendar(timeZone).date(from: dc)
    }

    /// Дата выбора в календаре → `YYYY-MM-DD` в поясе.
    public static func ymd(_ date: Date, timeZone: TimeZone = .current) -> String { string(date, timeZone) }

    /// Подпись срока на карточке: сегодня / завтра / «23 окт».
    public static func dueLabel(_ due: String, today: String, lang: String, timeZone: TimeZone = .current) -> String {
        if due == today { return BoardL10n.text("due.today", lang: lang) }
        if let t = date(from: today, timeZone: timeZone),
           let tm = calendar(timeZone).date(byAdding: .day, value: 1, to: t),
           string(tm, timeZone) == due { return BoardL10n.text("due.tomorrow", lang: lang) }
        guard let d = date(from: due, timeZone: timeZone) else { return due }
        let f = DateFormatter()
        f.locale = Locale(identifier: lang)
        f.timeZone = timeZone
        f.setLocalizedDateFormatFromTemplate("d MMM")
        return f.string(from: d)
    }

    /// Шапка панели: «чт, 22 окт».
    public static func headerDate(now: Date = Date(), lang: String, timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: lang)
        f.timeZone = timeZone
        f.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return f.string(from: now)
    }
}
