import Foundation

// Адрес API Swarm для рекордера. 13.10.2026 прод переехал с облачного Supabase на свой сервер
// за нашим доменом (docs/decisions/2026-10-13-move-to-own-server.md). Установщик пишет адрес в
// config.json, поэтому у уже установленных рекордеров там остаётся облачный — он отвечает 402.
// При чтении конфига облачный адрес подменяется на текущий. Наш домен дальше не меняется:
// следующий переезд сервера делается за ним, и трогать рекордеры у людей не придётся.
public enum IngestBase {
    public static let current = "https://api.swarm-team.app/functions/v1"
    public static let legacyHost = "vbqglndbxkpmreccpqmr.supabase.co"

    /// Пустой или облачный адрес → текущий; любой другой (локальный стенд и т.п.) — как есть.
    public static func migrated(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return current }
        guard let host = URL(string: trimmed)?.host else { return value }
        return host == legacyHost ? current : value
    }
}
