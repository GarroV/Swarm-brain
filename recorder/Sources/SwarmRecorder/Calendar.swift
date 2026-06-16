import EventKit
import Foundation

// Идентичность текущей встречи для дедупа нескольких записавших (10-REVISED-DESIGN §3):
// приоритет — идущее сейчас календарное событие (ключ = iCalUID:дата, одинаков у всех
// участников → сервер схлопывает в одну встречу). Нет события → nil, вызывающий берёт manual.
enum MeetingIdentity {
    struct Info: Sendable {
        let kind: IdentityKind
        let key: String
        let title: String?
        let attendees: [Attendee]
        let start: Date?
        let end: Date?
    }

    static func currentCalendar() async -> Info? {
        let store = EKEventStore()
        guard await requestAccess(store) else { return nil }

        let now = Date()
        let predicate = store.predicateForEvents(
            withStart: now.addingTimeInterval(-30 * 60),
            end: now.addingTimeInterval(30 * 60),
            calendars: nil
        )
        let events = store.events(matching: predicate).filter { !$0.isAllDay }

        // Идущее сейчас событие; иначе — последнее, что уже началось (созвон мог чуть сдвинуться).
        let ongoing = events.first { ev in
            guard let s = ev.startDate, let e = ev.endDate else { return false }
            return s <= now && now <= e
        }
        let started = events
            .filter { ($0.startDate ?? .distantFuture) <= now }
            .max { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
        guard let ev = ongoing ?? started else { return nil }

        let uid = ev.calendarItemExternalIdentifier ?? ev.eventIdentifier ?? UUID().uuidString
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
            start: ev.startDate,
            end: ev.endDate
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
