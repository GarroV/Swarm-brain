import Foundation
import RecorderKit

// Проводка авто-старта записи по календарю (#219): таймер, капсула, память об отменённых.
// Решение — CalendarAutoStart.decide, отсчёт — AutoStartCountdown.step (RecorderKit, с тестами);
// здесь только то, что без AppKit и таймера не проверить. Старт записи отдаёт `start` — это
// тот же `beginRecording`, что у ручного «Записать», второго конвейера записи нет.
final class CalendarAutoStartController {
    struct Inputs {
        let meetings: [MeetingIdentity.Info]
        let recordedNow: [String]
        let enabled: Bool
    }

    private let widget: RecorderWidget
    private let isRecording: () -> Bool
    private let canShow: () -> Bool
    private let start: (MeetingIdentity.Info) -> Void
    private let resync: () -> Void

    private var inputs: Inputs?
    private var countdown = AutoStartCountdown.State.none
    private var timer: Timer?
    // Ключ → докуда не трогать. Отменённая встреча не отсчитывает заново, а стартовавшая не
    // перезапускается после ручной остановки; следующая встреча получает свой отсчёт.
    private var handled: [String: Date] = [:]
    /// Что сейчас нарисовано в капсуле (nil — отсчёта нет). AppDelegate.syncWidget перерисовывает по нему.
    private(set) var shown: (title: String, remaining: Int)?

    init(widget: RecorderWidget, isRecording: @escaping () -> Bool, canShow: @escaping () -> Bool,
         start: @escaping (MeetingIdentity.Info) -> Void, resync: @escaping () -> Void) {
        self.widget = widget
        self.isRecording = isRecording
        self.canShow = canShow
        self.start = start
        self.resync = resync
    }

    /// Свежий ответ meeting-current. nil (запроса не было или он упал) гасит отсчёт: отказ в сторону «не писать».
    func update(_ inputs: Inputs?) {
        self.inputs = inputs
        evaluate()
    }

    func cancel() {
        guard case .running(let key, _) = countdown,
              let m = inputs?.meetings.first(where: { $0.key == key }) else { return }
        Diagnostics.shared.log("AUTOSTART отменён человеком \(key)")
        remember(m)
        evaluate()
    }

    private func date(_ iso: String?) -> Date? { iso.flatMap { ISO8601DateFormatter().date(from: $0) } }

    private func remember(_ m: MeetingIdentity.Info) {
        handled[m.key] = date(m.endISO) ?? Date().addingTimeInterval(3600)   // нет конца слота — час
    }

    private func evaluate() {
        let now = Date()
        handled = handled.filter { $0.value > now }
        let meetings = inputs?.meetings ?? []
        let decision = CalendarAutoStart.decide(
            meetings: meetings.map { CalendarAutoStart.Meeting(key: $0.key, start: date($0.startISO), end: date($0.endISO)) },
            now: now, autoStartEnabled: inputs?.enabled ?? false, isRecording: isRecording(),
            recordedNow: inputs?.recordedNow ?? [], cancelled: Set(handled.keys))
        let (next, effect) = AutoStartCountdown.step(countdown, decision: decision, now: now)
        countdown = next
        switch effect {
        case .none:
            break
        case .show(let key, let remaining):
            show(key: key, remaining: remaining, meetings: meetings)
        case .fire(let key):
            shown = nil
            stopTimer()
            if let m = meetings.first(where: { $0.key == key }) {
                remember(m)
                Diagnostics.shared.log("AUTOSTART запись по календарю \(key)")
                start(m)
            }
            resync()
        case .hide:
            shown = nil
            stopTimer()
            resync()
        }
    }

    private func show(key: String, remaining: Int, meetings: [MeetingIdentity.Info]) {
        let title = meetings.first { $0.key == key }?.title ?? MeetingNotice.untitled
        shown = (title, remaining)
        // Отсчёт — единственный механизм отказа: не показался — не стартуем.
        guard canShow(), widget.showAutoStart(title: title, remaining: remaining, lang: BoardL10n.language()) else {
            Diagnostics.shared.log("AUTOSTART отсчёт не показался — не стартуем \(key)")
            countdown = .none
            shown = nil
            stopTimer()
            return
        }
        if remaining == AutoStartCountdown.seconds {
            Diagnostics.shared.log("AUTOSTART отсчёт \(AutoStartCountdown.seconds) с для \(key)")
        }
        guard timer == nil else { return }
        let t = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.evaluate() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}
