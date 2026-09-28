import AppKit
import Foundation
import RecorderKit

// Пропуски бота на экране человека (T162, решение D022): bumblebee говорит, что scriba не пошёл или
// не дошёл на встречу, и одной кнопкой «Позвать бота» зовёт его. Главный путь записи — бот; эта
// поверхность нужна, чтобы отказ автозапуска не прошёл молча.
//
// Поверхности две (D025, продолжение решения 2026-09-07 «одна поверхность — капсула»):
//   • НАША капсула — «Бота нет на встрече» + «Позвать бота»; штатного баннера macOS у пропуска
//     нет. Что именно рисовать, отдаёт `capsule`, куда — решает AppDelegate.syncWidget: отдельной
//     капсулой или строкой в капсуле встречи, во время записи — нигде (встреча и так пишется);
//   • пункт меню — пропуски все, в том числе закрытые ✕ в капсуле, и отказ приглашения строкой.
//
// Опрос раз в минуту: `GET /meeting-missed` в Google не ходит (T164, D023), читает снимок и задания
// в базе, а пропуск нужен человеку в первую минуту встречи, пока звать бота ещё имеет смысл.
// Автозапуск выключен — пропусков нет по определению (D021), опрос редеет до раза в 10 минут:
// включают его в вебе, и рекордер узнаёт об этом без перезапуска.
//
// Логика «что показать, что погасить» — RecorderKit/MissedMeetings.swift (MissedTracker, MissedCapsule).
final class MissedMeetingsWatcher: NSObject {
    static let pollSeconds: TimeInterval = 60
    static let autojoinOffPollSeconds: TimeInterval = 600
    /// Сколько капсула держит «Бот позван» после удачного приглашения.
    static let confirmationSeconds: TimeInterval = 5

    private let lang = RecorderLanguage.current
    private let configProvider: () -> SwarmConfig?
    private let onChange: () -> Void
    private var tracker = MissedTracker()
    private var timer: Timer?
    private var nextPollAt = Date.distantPast
    private var polling = false
    private var inviting: Set<String> = []
    /// Отказ последнего приглашения по пропуску — капсула и меню говорят его, пока пропуск открыт.
    private var failures: [String: String] = [:]
    /// «Бот позван» — капсула держит его несколько секунд, затем гаснет сама.
    private var confirmation: MissedCapsule?

    /// Календарь сегодня не сверен — пропуски видны не все (сервер: `checked=false`).
    private(set) var notChecked = false
    /// Последний опрос не удался — текст для меню. nil — опрос прошёл.
    private(set) var pollError: String?

    init(config: @escaping () -> SwarmConfig?, onChange: @escaping () -> Void) {
        self.configProvider = config
        self.onChange = onChange
        super.init()
    }

    var open: [MissedMeeting] { tracker.open }

    /// Что сказать в капсуле: «Бот позван» сразу после приглашения, иначе первый открытый пропуск,
    /// не закрытый ✕. nil — капсуле о пропусках говорить нечего.
    var capsule: MissedCapsule? {
        if let confirmation { return confirmation }
        guard let miss = tracker.capsuleMiss else { return nil }
        return MissedCapsule.compose(miss, failure: failures[miss.id], busy: inviting.contains(miss.id), lang: lang)
    }

    /// ✕ в капсуле: пропуск уходит из капсулы, в меню остаётся.
    func dismissInCapsule(_ id: String) {
        if confirmation?.missId == id {
            confirmation = nil
        } else {
            tracker = tracker.dismissing(id)
            NSLog("SwarmRecorder: пропуск \(id) закрыт в капсуле (в меню остаётся)")
        }
        onChange()
    }

    func start() {
        let t = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
        // Первый опрос — когда сеть уже поднялась (как heartbeat на старте).
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.pollNow() }
    }

    /// После пробуждения и смены токена — не ждать минуту.
    func pollNow() {
        nextPollAt = .distantPast
        tick()
    }

    private func tick() {
        guard !polling, Date() >= nextPollAt else { return }
        guard let cfg = configProvider() else {
            let (next, update) = tracker.cleared()
            apply(update, next: next)
            return
        }
        polling = true
        Task { @MainActor in
            await self.poll(cfg)
            self.polling = false
        }
    }

    // Отдельно от tick, чтобы selftest мог позвать ровно один опрос и дождаться его.
    @MainActor func poll(_ cfg: SwarmConfig) async {
        do {
            let list = try await SwarmClient(config: cfg).missedMeetings()
            pollError = nil
            notChecked = list.autojoin && !list.checked
            nextPollAt = Date().addingTimeInterval(list.autojoin ? Self.pollSeconds : Self.autojoinOffPollSeconds)
            let (next, update) = list.autojoin ? tracker.applying(list.misses) : tracker.cleared()
            apply(update, next: next)
        } catch {
            pollError = describe(error)
            nextPollAt = Date().addingTimeInterval(Self.pollSeconds)
            NSLog("SwarmRecorder: опрос пропусков бота не удался — \(error)")
            onChange()
        }
    }

    private func apply(_ update: MissedTracker.Update, next: MissedTracker) {
        let changed = next != tracker
        tracker = next
        let openIds = Set(next.open.map(\.id))
        failures = failures.filter { openIds.contains($0.key) }
        for miss in update.announce {
            NSLog("SwarmRecorder: пропуск бота [\(miss.id)] \(miss.reason) — \(miss.message.text(lang))")
        }
        for id in update.withdraw { NSLog("SwarmRecorder: пропуск бота [\(id)] закрыт") }
        if changed || !update.announce.isEmpty || !update.withdraw.isEmpty { onChange() }
    }

    // ── Позвать бота ────────────────────────────────────────────────────────────
    @discardableResult
    @MainActor func invite(_ missId: String) async -> Bool {
        guard let cfg = configProvider() else {
            fail(missId, MissedTexts.tokenInvalid.text(lang))
            return false
        }
        guard !inviting.contains(missId) else { return false }   // двойной клик — одно приглашение
        inviting.insert(missId)
        onChange()                                                 // кнопка капсулы → «Зову…»
        defer { inviting.remove(missId) }
        let title = tracker.open.first { $0.id == missId }?.title
        do {
            let (status, body) = try await SwarmClient(config: cfg).inviteBot(missId: missId)
            guard status == 200 || status == 201 else {
                NSLog("SwarmRecorder: позвать бота по пропуску \(missId) — HTTP \(status): \(String(data: body, encoding: .utf8) ?? "")")
                fail(missId, MissedFailure.text(status: status, body: body, lang: lang))
                return false
            }
            failures[missId] = nil
            confirm(missId, title: title)
            let (next, update) = tracker.invitedBot(missId)
            apply(update, next: next)
            NSLog("SwarmRecorder: позвал бота по пропуску \(missId)")
            return true
        } catch {
            NSLog("SwarmRecorder: позвать бота по пропуску \(missId) — \(error)")
            fail(missId, describe(error))
            return false
        }
    }

    private func fail(_ missId: String, _ reason: String) {
        NSLog("SwarmRecorder: не удалось позвать бота [\(missId)] — \(reason)")
        failures[missId] = reason
        // Отказ показывается в капсуле, даже если человек её закрыл: он нажал кнопку и ждёт ответа.
        tracker = MissedTracker(announced: tracker.announced, invited: tracker.invited, open: tracker.open,
                                dismissed: tracker.dismissed.subtracting([missId]))
        inviting.remove(missId)
        onChange()
    }

    private func confirm(_ missId: String, title: String?) {
        let id = "invited-\(missId)"
        let done = MissedTexts.invitedTitle.text(lang)
        confirmation = MissedCapsule(missId: id, line: done, shortLine: done,
                                     detail: MissedTexts.invitedBody(title, lang), canInvite: false,
                                     busy: false, buttonTitle: "", failed: false)
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.confirmationSeconds) { [weak self] in
            guard let self, self.confirmation?.missId == id else { return }
            self.confirmation = nil
            self.onChange()
        }
    }

    @objc func inviteMenuTapped(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Task { @MainActor in await self.invite(id) }
    }

    // ── Меню ────────────────────────────────────────────────────────────────────
    func menuItems() -> [NSMenuItem] {
        var items: [NSMenuItem] = []
        for miss in tracker.open {
            if miss.canInvite {
                let item = NSMenuItem(title: MissedTexts.menuItem(miss.title, lang),
                                      action: #selector(inviteMenuTapped(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = miss.id
                item.toolTip = miss.message.text(lang)
                items.append(item)
                if let failure = failures[miss.id] {
                    items.append(disabled("\(MissedTexts.failedTitle.text(lang)) — \(failure)"))
                }
            } else {
                items.append(disabled(miss.message.text(lang)))
            }
        }
        if notChecked { items.append(disabled(MissedTexts.notChecked.text(lang))) }
        if let pollError { items.append(disabled(String(format: MissedTexts.pollFailedFormat.text(lang), pollError))) }
        return items
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private func describe(_ error: Error) -> String {
        if error is URLError { return MissedFailure.text(status: nil, body: nil, lang: lang) }
        if case SwarmError.http(let code, let body, _) = error {
            return MissedFailure.text(status: code, body: body.data(using: .utf8), lang: lang)
        }
        return String(describing: error)
    }
}
