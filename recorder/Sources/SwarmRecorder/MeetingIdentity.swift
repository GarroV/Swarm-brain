import Foundation

// Идентичность встречи для claim/дедупа. Источники (приоритет): календарь (Google, с сервера
// meeting-current — см. SwarmClient.currentMeeting) → комната из URL браузера (BrowserRoom) →
// manual. macOS-Календарь не используется: события читаются на сервере по OAuth-интеграции.
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
