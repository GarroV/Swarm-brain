import Foundation
import RecorderKit

// Состояние напоминания о записи по календарю (#219, решение владельца 09.11.2026): решает
// CallReminder.decide (RecorderKit, с тестами), здесь — только «горит ли напоминание сейчас» и
// журнал. Сама капсула — та же, что предлагает «Записать» по календарю (AppDelegate.syncWidget):
// напоминание лишь переводит её в заметный режим. Закрытие («Не сейчас») запоминается теми же
// dismissedUntil, что и ✕ капсулы, — до конца события. Старт записи идёт обычным путём
// beginRecording; запись сама не начинается никогда.
final class CallReminderTracker {
    private(set) var keys: [String] = []
    var isActive: Bool { !keys.isEmpty }

    /// Пересчитать по свежему ответу сервера и сигналу звонка. true — режим капсулы изменился.
    func update(meetings: [MeetingIdentity.Info], callActive: Bool, isRecording: Bool,
                recordedNow: [String], isDismissed: (String) -> Bool) -> Bool {
        let iso = ISO8601DateFormatter()
        let calls = meetings.filter { $0.joinURL != nil }   // D026: только созвоны, как у предложений капсулы
        let decision = CallReminder.decide(
            meetings: calls.map { CallReminder.Meeting(key: $0.key, start: $0.startISO.flatMap(iso.date),
                                                       end: $0.endISO.flatMap(iso.date)) },
            now: Date(), callActive: callActive, isRecording: isRecording, recordedNow: recordedNow,
            dismissed: Set(calls.map(\.key).filter(isDismissed)))
        let next: [String]
        if case .remind(let k) = decision { next = k } else { next = [] }
        guard next != keys else { return false }
        if next.isEmpty {
            Diagnostics.shared.log("REMIND снято: \(reason(decision))")
        } else {
            Diagnostics.shared.log("REMIND показано: \(next.joined(separator: ", "))")
        }
        keys = next
        return true
    }

    /// Человек нажал «Не сейчас» (или ✕) на капсуле.
    func noteDismissed() {
        guard isActive else { return }
        Diagnostics.shared.log("REMIND закрыто «Не сейчас»: \(keys.joined(separator: ", "))")
        keys = []
    }

    /// Запись начата (из напоминания, меню или как-то ещё): напоминать больше не о чем.
    func noteStarted(key: String?) {
        guard isActive else { return }
        Diagnostics.shared.log("REMIND запись начата (\(key ?? "ручная")), было: \(keys.joined(separator: ", "))")
        keys = []
    }

    /// Не в покое (запись, отправка, ошибка): напоминание гаснет молча.
    func clear() { keys = [] }

    private func reason(_ d: CallReminder.Decision) -> String {
        guard case .skip(let s) = d else { return "—" }
        switch s {
        case .alreadyRecording: return "уже пишем"
        case .noMeeting: return "встреч нет"
        case .noCall: return "звонок закончился"
        case .tooEarly: return "слот ещё не скоро"
        case .ended: return "событие закончилось"
        case .recordedByOther: return "встречу пишет бот или коллега"
        case .dismissed: return "закрыто человеком"
        }
    }
}
