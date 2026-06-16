import EventKit
import Foundation

// Идентичность встречи для claim/дедупа. Источник календаря — macOS-Календарь (EventKit):
// он читает ВСЕ подключённые аккаунты, включая Google Workspace, добавленный в
// Системные настройки → Учётные записи интернета. НЕ требует Google Cloud / OAuth-клиента
// компании / админских прав — это нативный клиент Apple (CalDAV), личная настройка на маке.
// Приоритет идентичности: календарь → комната из URL браузера (BrowserRoom) → manual.
enum MeetingIdentity {
    struct Info: Sendable {
        let kind: IdentityKind
        let key: String
        let title: String?
        let attendees: [Attendee]
        let startISO: String?   // ISO 8601; nil для room/manual
        let endISO: String?
    }

    static func currentCalendar() async -> Info? {
        let store = EKEventStore()
        guard await requestAccess(store) else { return nil }
        let now = Date()
        let predicate = store.predicateForEvents(
            withStart: now.addingTimeInterval(-30 * 60),
            end: now.addingTimeInterval(30 * 60),
            calendars: nil,
        )
        let events = store.events(matching: predicate).filter { !$0.isAllDay }
        // Идущее сейчас; иначе — последнее уже начавшееся.
        let ongoing = events.first { e in
            guard let s = e.startDate, let en = e.endDate else { return false }
            return s <= now && now <= en
        }
        let started = events
            .filter { ($0.startDate ?? .distantFuture) <= now }
            .max { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
        guard let ev = ongoing ?? started else { return nil }

        let uid = ev.calendarItemExternalIdentifier ?? ev.eventIdentifier ?? UUID().uuidString
        let iso = ISO8601DateFormatter()
        let attendees: [Attendee] = (ev.attendees ?? []).compactMap { p in
            let email = p.url.scheme?.lowercased() == "mailto"
                ? p.url.absoluteString.replacingOccurrences(of: "mailto:", with: "")
                : nil
            if p.name == nil && email == nil { return nil }
            return Attendee(name: p.name, email: email)
        }
        return Info(
            kind: .calendar,
            key: "\(uid):\(dateString(ev.startDate ?? now))",
            title: ev.title,
            attendees: attendees,
            startISO: ev.startDate.map { iso.string(from: $0) },
            endISO: ev.endDate.map { iso.string(from: $0) },
        )
    }

    private static func requestAccess(_ store: EKEventStore) async -> Bool {
        if #available(macOS 14.0, *) {
            return (try? await store.requestFullAccessToEvents()) ?? false
        }
        return await withCheckedContinuation { cont in
            store.requestAccess(to: .event) { ok, _ in cont.resume(returning: ok) }
        }
    }

    private static func dateString(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.string(from: d)
    }
}
