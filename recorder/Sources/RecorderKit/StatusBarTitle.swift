import Foundation

// Текст рядом со значком bumblebee в строке состояния macOS: «что пишется прямо сейчас».
//
// Референс — Granola («◎ VC · 49m left»). Решение владельца 28.08.2026, канон:
// docs/decisions/2026-08-28-status-bar-on-air.md.
//
//   покой                        → нет текста (только глиф)
//   идёт по расписанию           → «Название · 49m left»
//   календарное время вышло      → «Название · ON AIR»
//   звонок без календаря         → «ON AIR»
//
// Почему так, а не иначе:
//   • 15 символов на название — menu bar не переносит и не сжимает пункты, лишняя ширина
//     выдавливает соседние иконки под чёлку, где они исчезают совсем;
//   • счётчик важнее названия: режется название, остаток остаётся целым;
//   • «0m left» и отрицательный остаток запрещены — они врут. Меньше минуты → «1m left»,
//     время вышло → ON AIR.
public enum StatusBarTitle {
    public static let maxNameLength = 15
    private static let onAir = "ON AIR"
    private static let separator = " · "

    public static func text(recording: Bool, title: String?, endsAt: Date?, now: Date = Date()) -> String? {
        guard recording else { return nil }
        let right = remaining(endsAt: endsAt, now: now) ?? onAir
        guard let name = shortName(title) else { return right }
        return name + separator + right
    }

    // Название в одну строку и не длиннее лимита. Переносы схлопываем: в menu bar «\n» рисуется
    // мусором, а заголовки встреч из календаря их иногда содержат.
    static func shortName(_ raw: String?) -> String? {
        let flat = (raw ?? "")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard !flat.isEmpty else { return nil }
        guard flat.count > maxNameLength else { return flat }
        return String(flat.prefix(maxNameLength - 1)) + "…"
    }

    // «49m left» / «1h 17m left» / «1h left». nil — когда остатка нет (вызывающий скажет ON AIR).
    static func remaining(endsAt: Date?, now: Date) -> String? {
        guard let endsAt else { return nil }
        let seconds = endsAt.timeIntervalSince(now)
        guard seconds > 0 else { return nil }
        // Округление ВВЕРХ: за 20 секунд до конца честнее «1m left», чем «0m left».
        let minutes = Int(ceil(seconds / 60))
        if minutes < 60 { return "\(minutes)m left" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "\(h)h left" : "\(h)h \(m)m left"
    }
}
