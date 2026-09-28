import AppKit
import Foundation
import RecorderKit
import UserNotifications

// Пропуски бота на экране человека (T162, решение D022): bumblebee говорит, что scriba не пошёл или
// не дошёл на встречу, и одной кнопкой «Позвать бота» зовёт его. Главный путь записи — бот; эта
// поверхность нужна, чтобы отказ автозапуска не прошёл молча.
//
// Поверхности две, и обе нужны:
//   • штатный баннер macOS с кнопкой «Позвать бота» — тот же механизм, что у информационных
//     уведомлений рекордера (`deferred-*`, #274); это НЕ предложение записать, у которого баннер
//     снят решением 2026-09-07;
//   • пункт меню — на случай, когда баннер закрыли или уведомления выключены (#155): иначе
//     пропуск был бы сказан один раз и потерян.
//
// Опрос раз в минуту: `GET /meeting-missed` в Google не ходит (T164, D023), читает снимок и задания
// в базе, а пропуск нужен человеку в первую минуту встречи, пока звать бота ещё имеет смысл.
// Автозапуск выключен — пропусков нет по определению (D021), опрос редеет до раза в 10 минут:
// включают его в вебе, и рекордер узнаёт об этом без перезапуска.
//
// Логика «что показать, что погасить» — RecorderKit/MissedMeetings.swift (MissedTracker).
final class MissedMeetingsWatcher: NSObject {
    static let categoryId = "MISSED_BOT"
    static let inviteActionId = "INVITE_BOT"
    static let missIdKey = "miss_id"

    static let pollSeconds: TimeInterval = 60
    static let autojoinOffPollSeconds: TimeInterval = 600

    private let lang = RecorderLanguage.current
    private let configProvider: () -> SwarmConfig?
    private let onChange: () -> Void
    private var tracker = MissedTracker()
    private var timer: Timer?
    private var nextPollAt = Date.distantPast
    private var polling = false
    private var inviting: Set<String> = []

    /// Календарь сегодня не сверен — пропуски видны не все (сервер: `checked=false`).
    private(set) var notChecked = false
    /// Последний опрос не удался — текст для меню. nil — опрос прошёл.
    private(set) var pollError: String?

    /// Баннеры идут только из собранного .app: без бандла UNUserNotificationCenter падает.
    private let canNotify = Bundle.main.bundleIdentifier != nil

    init(config: @escaping () -> SwarmConfig?, onChange: @escaping () -> Void) {
        self.configProvider = config
        self.onChange = onChange
        super.init()
    }

    var open: [MissedMeeting] { tracker.open }

    /// Категория с кнопкой. Других категорий у приложения нет (сняты решением 2026-09-07), поэтому
    /// setNotificationCategories ничего чужого не затирает.
    func registerCategory() {
        guard canNotify else { return }
        let invite = UNNotificationAction(identifier: Self.inviteActionId,
                                          title: MissedTexts.inviteAction.text(lang), options: [])
        let category = UNNotificationCategory(identifier: Self.categoryId, actions: [invite],
                                              intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([category])
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
        if !update.withdraw.isEmpty { withdraw(update.withdraw) }
        update.announce.forEach(announce)
        if changed || !update.announce.isEmpty || !update.withdraw.isEmpty { onChange() }
    }

    // ── Позвать бота ────────────────────────────────────────────────────────────
    @discardableResult
    @MainActor func invite(_ missId: String) async -> Bool {
        guard let cfg = configProvider() else {
            fail(MissedTexts.tokenInvalid.text(lang))
            return false
        }
        guard !inviting.contains(missId) else { return false }   // двойной клик — одно приглашение
        inviting.insert(missId)
        defer { inviting.remove(missId) }
        let title = tracker.open.first { $0.id == missId }?.title
        do {
            let (status, body) = try await SwarmClient(config: cfg).inviteBot(missId: missId)
            guard status == 200 || status == 201 else {
                NSLog("SwarmRecorder: позвать бота по пропуску \(missId) — HTTP \(status): \(String(data: body, encoding: .utf8) ?? "")")
                fail(MissedFailure.text(status: status, body: body, lang: lang))
                return false
            }
            let (next, update) = tracker.invitedBot(missId)
            apply(update, next: next)
            post(id: "missed-invited-\(missId)", title: MissedTexts.invitedTitle.text(lang),
                 body: MissedTexts.invitedBody(title, lang), invitable: false, missId: nil)
            NSLog("SwarmRecorder: позвал бота по пропуску \(missId)")
            return true
        } catch {
            NSLog("SwarmRecorder: позвать бота по пропуску \(missId) — \(error)")
            fail(describe(error))
            return false
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

    // ── Баннеры ─────────────────────────────────────────────────────────────────
    private func announce(_ miss: MissedMeeting) {
        let title = miss.canInvite ? MissedTexts.invitableTitle : MissedTexts.notInvitableTitle
        post(id: bannerId(miss.id), title: title.text(lang), body: miss.message.text(lang),
             invitable: miss.canInvite, missId: miss.id)
    }

    private func withdraw(_ ids: [String]) {
        guard canNotify else { return }
        let banners = ids.map(bannerId)
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: banners)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: banners)
    }

    private func fail(_ reason: String) {
        post(id: "missed-failed-\(Int(Date().timeIntervalSince1970))", title: MissedTexts.failedTitle.text(lang),
             body: reason, invitable: false, missId: nil)
    }

    private func post(id: String, title: String, body: String, invitable: Bool, missId: String?) {
        NSLog("SwarmRecorder: уведомление [\(id)] \(title) — \(body)")
        guard canNotify else { return }
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        if invitable, let missId {
            c.categoryIdentifier = Self.categoryId
            c.userInfo = [Self.missIdKey: missId]
        }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil)) { err in
            if let err { NSLog("SwarmRecorder: уведомление [\(id)] не поставлено — \(err)") }
        }
    }

    private func bannerId(_ missId: String) -> String { "missed-\(missId)" }

    private func describe(_ error: Error) -> String {
        if error is URLError { return MissedFailure.text(status: nil, body: nil, lang: lang) }
        if case SwarmError.http(let code, let body, _) = error {
            return MissedFailure.text(status: code, body: body.data(using: .utf8), lang: lang)
        }
        return String(describing: error)
    }
}
