import AppKit
import RecorderKit

// Проводка авто-старта записи по календарю (#219): таймер, капсула, память об отменённых и
// пункт меню рекордера с тем же флагом, что в веб-настройках (источник истины — сервер).
// Решение — CalendarAutoStart.decide, отсчёт — AutoStartCountdown.step (RecorderKit, с тестами);
// здесь только то, что без AppKit и таймера не проверить. Старт записи отдаёт `start` — это
// тот же `beginRecording`, что у ручного «Записать», второго конвейера записи нет.
final class CalendarAutoStartController: NSObject {
    struct Inputs {
        let meetings: [MeetingIdentity.Info]
        let recordedNow: [String]
        /// `auto_start` с сервера; nil — старый сервер (меню прячем, не стартуем).
        var enabled: Bool?
        /// Реальный созвон по CallDetector — тот же сигнал, по которому капсула предлагает «Записать».
        let callActive: Bool
    }

    private let widget: RecorderWidget
    private let isRecording: () -> Bool
    private let canShow: () -> Bool
    private let start: (MeetingIdentity.Info) -> Void
    private let resync: () -> Void
    private let client: () -> SwarmClient?

    private var inputs: Inputs?
    private var countdown = AutoStartCountdown.State.none
    private var timer: Timer?
    // Ключ → докуда не трогать. Отменённая встреча не отсчитывает заново, а стартовавшая не
    // перезапускается после ручной остановки; следующая встреча получает свой отсчёт.
    private var handled: [String: Date] = [:]
    /// Что сейчас нарисовано в капсуле (nil — отсчёта нет). AppDelegate.syncWidget перерисовывает по нему.
    private(set) var shown: (title: String, remaining: Int)?

    init(widget: RecorderWidget, isRecording: @escaping () -> Bool, canShow: @escaping () -> Bool,
         start: @escaping (MeetingIdentity.Info) -> Void, resync: @escaping () -> Void,
         client: @escaping () -> SwarmClient?) {
        self.widget = widget
        self.isRecording = isRecording
        self.canShow = canShow
        self.start = start
        self.resync = resync
        self.client = client
        super.init()
    }

    /// Свежий ответ meeting-current. nil (запрос упал) гасит отсчёт: отказ в сторону «не писать».
    /// `callActive` — сигнал CallDetector, неизвестный = нет звонка.
    func update(_ lookup: SwarmClient.MeetingLookup?, callActive: Bool) {
        let inputs = lookup.map { Inputs(meetings: $0.meetings, recordedNow: $0.recordedNow, enabled: $0.autoStart,
                                         callActive: callActive) }
        let changed = self.inputs?.enabled != inputs?.enabled
        self.inputs = inputs
        evaluate()
        if changed { resync() }   // галка в меню следует за флагом, который могли переключить в вебе
    }

    /// Пункт меню «Автозапись встреч из календаря» с галкой по серверному флагу; nil, если сервер
    /// флага не отдал (старый сервер) — пункта нет, локальной копии нет.
    func menuItem() -> NSMenuItem? {
        guard let on = inputs?.enabled else { return nil }
        let item = NSMenuItem(title: BoardL10n.text("autostart.menu", lang: BoardL10n.language()),
                              action: #selector(menuToggled), keyEquivalent: "")
        item.target = self
        item.state = on ? .on : .off
        return item
    }

    @objc private func menuToggled() {
        guard let on = inputs?.enabled, let c = client() else { return }
        Task { @MainActor in
            guard let saved = await c.setAutoStart(!on) else {
                Diagnostics.shared.log("AUTOSTART тумблер: сервер не принял")
                infoAlert(BoardL10n.text("autostart.menu", lang: BoardL10n.language()),
                          BoardL10n.text("autostart.menu.failed", lang: BoardL10n.language()))
                return
            }
            Diagnostics.shared.log("AUTOSTART тумблер в меню → \(saved)")
            inputs?.enabled = saved
            evaluate()
            resync()
        }
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
            now: now, autoStartEnabled: inputs?.enabled ?? false, callActive: inputs?.callActive ?? false,
            isRecording: isRecording(),
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
