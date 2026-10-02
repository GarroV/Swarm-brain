import Foundation

// Адрес веба Swarm для рекордера. Сменился 02.10.2026 (issue #753): прежний pages.dev
// переадресует на новый. В config.json адрес попадает из двух мест: вставка токена из меню
// пишет его, а установщик пишет ПУСТУЮ строку — тогда «Открыть Рой» скрыт, а клик по задаче
// в заметках молча ничего не открывает (issue #758). При чтении конфига пустой и прежний
// адрес подменяются на текущий.
public enum WebBase {
    public static let current = "https://swarm-team.app"
    public static let legacy = "https://swarm-brain.pages.dev"

    /// Пустой или прежний адрес (со слэшем на конце или без) → текущий; любой другой — как есть.
    public static func migrated(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        let bare = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        return bare.isEmpty || bare == legacy ? current : value
    }
}
