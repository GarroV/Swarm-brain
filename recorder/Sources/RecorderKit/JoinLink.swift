import Foundation

// Ссылка «зайти в звонок», пришедшая с сервера.
//
// Пускаем ТОЛЬКО https. Ссылка родом из приглашения в календарь, а создать приглашение может
// кто угодно — и открываем её МЫ, по клику человека в уведомлении. `javascript:`, `file:`,
// `http:` — это не адрес встречи. Сервер уже фильтрует (meeting-current/join-link.ts);
// здесь второй барьер, на случай старого или подменённого ответа.
public enum JoinLink {
    public static func safeURL(_ raw: String?) -> URL? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              let url = URL(string: raw), url.scheme?.lowercased() == "https",
              let host = url.host, !host.isEmpty else { return nil }
        return url
    }
}
