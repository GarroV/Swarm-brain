import Foundation

// Идентичность встречи для claim/дедупа — БЕЗ календаря (им никто не пользуется).
// Источники: комната из URL активной вкладки браузера (Meet/Контур, см. BrowserRoom) →
// manual. Дедуп онлайн-звонков идёт по ключу комнаты (одинаков у всех по одной ссылке).
enum MeetingIdentity {
    struct Info: Sendable {
        let kind: IdentityKind
        let key: String
        let title: String?
        let attendees: [Attendee]
        let startISO: String?   // nil для room/manual
        let endISO: String?
    }
}
