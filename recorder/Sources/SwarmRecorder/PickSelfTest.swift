import AppKit
import Foundation
import RecorderKit

// Режим --selftest-pick: живая проверка капсулы по календарю (D026, D027) против стенда, мимо рабочей
// установки человека. Конфиг рекордера НЕ читается: адрес и токен — SWARM_SELFTEST_URL /
// SWARM_SELFTEST_TOKEN, как у --selftest-missed. Опрашивает `meeting-current` настоящим
// SwarmClient.currentMeeting, отбирает предложения тем же MeetingChoice, что AppDelegate, и
// показывает НАШУ капсулу; пропуски бота — тем же MissedMeetingsWatcher. Запись, heartbeat и
// апдейтер спят: «Подключиться»/«Записать» печатают, какую встречу открыли бы и к какой
// привязали бы запись, и переводят капсулу в облик записи.
//   --selftest-pick               опрашивать и показывать 180 секунд
//   --selftest-pick --keep N      держать N секунд
//   --selftest-pick --open        «Подключиться» действительно открывает ссылку
// Кнопки жмут снаружи через System Events (AX): choice.join.N / choice.record.N / banner.close,
// у одиночной встречи — по подписи «Подключиться»/«Записать». Запускать из собранного .app со
// СВОИМ bundle id. Каждое изменение печатается строкой `pick:` в stdout.
final class PickSelfTest: NSObject {
    private let client: SwarmClient
    private let watcher: MissedMeetingsWatcher
    private var probe: SelfTestProbe?
    private let widget = RecorderWidget()
    private let openLinks: Bool
    private var offers: [MeetingIdentity.Info] = []
    private var dismissedUntil: [String: Date] = [:]
    private var recording: MeetingIdentity.Info?
    private var timer: Timer?

    init(config: SwarmConfig, openLinks: Bool) {
        client = SwarmClient(config: config)
        self.openLinks = openLinks
        var onChange: () -> Void = {}
        watcher = MissedMeetingsWatcher(config: { config }, onChange: { onChange() })
        super.init()
        onChange = { [weak self] in self?.sync() }
        widget.onJoin = { [weak self] in self.map { $0.join($0.offers.first?.key) } }
        widget.onRecord = { [weak self] in self.map { $0.record($0.offers.first?.key, via: "«Записать»") } }
        widget.onJoinChoice = { [weak self] key in self?.join(key) }
        widget.onRecordChoice = { [weak self] key in self?.record(key, via: "«Записать» в строке выбора") }
        widget.onDismiss = { [weak self] in self?.dismiss() }
        widget.onStop = { [weak self] in
            print("pick: ✕ на капсуле записи — запись «\(self?.recording?.title ?? "-")» остановлена")
            self?.recording = nil
            self?.sync()
        }
        widget.onInviteBot = { [weak self] id in
            print("pick: «Позвать бота» по \(id)")
            Task { @MainActor [weak self] in _ = await self?.watcher.invite(id) }
        }
        widget.onMissedDismiss = { [weak self] id in self?.watcher.dismissInCapsule(id) }
    }

    func start() {
        probe = SelfTestProbe(widget: widget, tag: "pick")
        probe?.start()
        watcher.start()
        watcher.pollNow()
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.poll() }
    }

    private func poll() {
        Task { @MainActor in
            let lookup: SwarmClient.MeetingLookup
            do { lookup = try await client.currentMeeting() } catch {
                print("pick: meeting-current не ответил: \(error)")
                return
            }
            let rows = lookup.meetings.map { "\($0.key) «\($0.title ?? "-")» \($0.joinURL?.absoluteString ?? "без ссылки")" }
            print("pick: meeting-current → \(lookup.meetings.count): \(rows.joined(separator: "; "))")
            let next = MeetingChoice.offers(lookup.meetings, key: \.key, hasLink: { $0.joinURL != nil },
                                            isDismissed: { self.isDismissed($0) })
            guard !MeetingChoice.sameOffer(offers, next, key: \.key) else { return }
            offers = next
            sync()
        }
    }

    private func isDismissed(_ key: String) -> Bool {
        guard let until = dismissedUntil[key] else { return false }
        return Date() < until
    }

    private func join(_ key: String?) {
        guard let key, let m = MeetingChoice.chosen(offers, key: \.key, key) else {
            print("pick: «Подключиться» — встречи \(key ?? "-") среди предложений уже нет, ничего не открываю")
            return
        }
        print("pick: «Подключиться» → открываю \(m.joinURL?.absoluteString ?? "-") («\(m.title ?? "-")»)")
        if openLinks, let url = m.joinURL { NSWorkspace.shared.open(url) }
        record(key, via: "«Подключиться»")
    }

    private func record(_ key: String?, via: String) {
        guard let key, let m = MeetingChoice.chosen(offers, key: \.key, key) else {
            print("pick: \(via) — встречи \(key ?? "-") среди предложений уже нет, запись не начинаю")
            return
        }
        print("pick: \(via) → запись привязана к «\(m.title ?? "-")» key=\(m.key) (calendar)")
        recording = m
        offers = []
        sync()
    }

    private func dismiss() {
        print("pick: ✕ — не записывать: \(offers.map(\.key))")
        for m in offers { dismissedUntil[m.key] = Date().addingTimeInterval(30 * 60) }
        offers = []
        sync()
    }

    // То же правило, что у AppDelegate.syncWidget в покое (D031).
    private func sync() {
        if recording != nil {
            widget.showRecording(startedAt: Date())
            print("pick: капсула — запись «\(recording?.title ?? "-")»")
            return
        }
        let iso = ISO8601DateFormatter()
        func notice(_ m: MeetingIdentity.Info) -> MeetingNotice {
            MeetingNotice.compose(title: m.title, start: m.startISO.flatMap { iso.date(from: $0) },
                                  end: m.endISO.flatMap { iso.date(from: $0) }, now: Date())
        }
        func bot(_ m: MeetingIdentity.Info) -> MissedCapsule? { watcher.capsule(forCall: m.joinURL?.absoluteString) }
        if offers.count > 1 {
            widget.showChoice(offers.map { RecorderWidget.Choice(key: $0.key, notice: notice($0), missed: bot($0)) })
        } else if let m = offers.first {
            widget.showPending(notice: notice(m), canJoin: m.joinURL != nil, missed: bot(m))
        } else {
            widget.hide()
            print("pick: капсула — скрыта (пропуски: \(watcher.open.map(\.id)) — только в меню)")
            return
        }
        let frame = widget.currentFrame.map { "\(Int($0.width))×\(Int($0.height))" } ?? "-"
        let what = offers.count > 1 ? "выбор \(widget.shownChoiceKeys)" : "одна встреча \(offers[0].key)"
        func line(_ c: MissedCapsule?) -> String {
            guard let c else { return "—" }
            return "«\(c.buttonTitle)» [\(c.missId)]\(c.busy ? " (неактивна)" : "")\(c.failure.map { " отказ «\($0)»" } ?? "")"
        }
        let bots = offers.count > 1 ? widget.shownChoiceMissed.map(line).joined(separator: " | ") : line(widget.shownMissed)
        print("pick: капсула \(frame) — \(what) · бот: \(bots)")
    }
}

func runPickSelfTest(seconds: Double, openLinks: Bool) {
    let env = ProcessInfo.processInfo.environment
    guard let url = env["SWARM_SELFTEST_URL"], let token = env["SWARM_SELFTEST_TOKEN"] else {
        print("pick: нужны SWARM_SELFTEST_URL (…/functions/v1 стенда) и SWARM_SELFTEST_TOKEN (токен рекордера стенда)")
        exit(2)
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let test = PickSelfTest(config: SwarmConfig(token: token, ingestBaseURL: url, webBaseURL: ""), openLinks: openLinks)
    test.start()
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
        print("pick: конец прогона (\(Int(seconds)) с)")
        withExtendedLifetime(test) { exit(0) }
    }
    app.run()
}
