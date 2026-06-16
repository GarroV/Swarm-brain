import Foundation

// Идентичность встречи для claim/дедупа. Источники (приоритет): СЕРВЕР (Google Calendar
// через meeting-current, см. SwarmClient.currentMeeting) → комната из URL браузера
// (BrowserRoom.currentRoom) → manual. macOS-Календарь (EventKit) НЕ используем: команда
// на Google Calendar, события читаются на сервере по серверной OAuth-интеграции —
// рекордеру не нужен ни доступ к календарю на маке, ни сам macOS-Календарь.
enum MeetingIdentity {
    struct Info: Sendable {
        let kind: IdentityKind
        let key: String
        let title: String?
        let attendees: [Attendee]
        let startISO: String?   // ISO 8601 (от сервера); nil для room/manual
        let endISO: String?
    }
}
