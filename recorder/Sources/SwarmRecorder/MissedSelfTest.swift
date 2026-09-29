import AppKit
import Foundation
import RecorderKit
import UserNotifications

// Режим --selftest-missed: живая проверка «бот не пришёл на встречу» (T162, D025) против стенда,
// мимо рабочей установки человека. Конфиг рекордера (токен, прод-адрес) НЕ читается: адрес и токен —
// SWARM_SELFTEST_URL / SWARM_SELFTEST_TOKEN, как у --selftest-quarantine. Поднимает только
// MissedMeetingsWatcher, НАШУ капсулу и значок в меню-баре — запись, heartbeat и апдейтер спят.
//   --selftest-missed                  опрашивать и показывать 180 секунд
//   --selftest-missed --keep N         держать N секунд
//   --selftest-missed --with-meeting   капсула идущей встречи («Подключиться»/«Записать» + кнопка
//                                      «Позвать бота»); ссылка созвона — SWARM_SELFTEST_JOIN_URL, а без
//                                      неё — ссылка первого пропуска. Без флага капсулы нет (D031)
//   --selftest-missed --invite-first   через 5 с после первого пропуска с кнопкой позвать бота тем же
//                                      вызовом, что и кнопка (если нажать руками нечем)
// Кнопку капсулы жмут снаружи через System Events (AX): у кнопок есть идентификаторы
// missed.invite / banner.close, у текста отказа — missed.failure. Запускать из собранного .app со СВОИМ
// bundle id — иначе капсула и уведомления смешаются с рабочим bumblebee.
// Каждое изменение печатается строкой `missed:` в stdout — по ним и сверяется прогон.
final class MissedSelfTest: NSObject {
    private let watcher: MissedMeetingsWatcher
    private let widget = RecorderWidget()
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let inviteFirst: Bool
    private let withMeeting: Bool
    private var invitedOnce = false
    private var meetingDismissed = false
    private var probe: SelfTestProbe?

    init(config: SwarmConfig, inviteFirst: Bool, withMeeting: Bool) {
        self.inviteFirst = inviteFirst
        self.withMeeting = withMeeting
        var onChange: () -> Void = {}
        watcher = MissedMeetingsWatcher(config: { config }, onChange: { onChange() })
        super.init()
        onChange = { [weak self] in self?.changed() }
        statusItem.button?.title = "🐝 missed"
        widget.onInviteBot = { [weak self] id in
            print("missed: кнопка «Позвать бота» в капсуле по \(id)")
            Task { @MainActor in
                let ok = await self?.watcher.invite(id) ?? false
                print("missed: приглашение из капсулы \(ok ? "принято" : "НЕ принято")")
            }
        }
        widget.onMissedDismiss = { [weak self] id in
            print("missed: ✕ в капсуле по \(id)")
            self?.watcher.dismissInCapsule(id)
        }
        widget.onDismiss = { [weak self] in
            print("missed: ✕ снял и предложение записать")
            self?.meetingDismissed = true
            self?.changed()
        }
    }

    func start() {
        if Bundle.main.bundleIdentifier == nil {
            print("missed: ⚠️ запущено не из бандла — проверка системных уведомлений пропущена")
        }
        probe = SelfTestProbe(widget: widget, tag: "missed")
        probe?.start()
        watcher.start()
        watcher.pollNow()
        changed()
        reportDelivered()
    }

    /// Штатных баннеров пропуска быть не должно (D025): раз в 15 с печатаем, что лежит в Центре
    /// уведомлений от этого бандла, — ожидается 0.
    private func reportDelivered() {
        guard Bundle.main.bundleIdentifier != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            UNUserNotificationCenter.current().getDeliveredNotifications { list in
                let rows = list.map { "[\($0.request.identifier)] «\($0.request.content.title)»" }
                print("missed: в Центре уведомлений \(list.count)\(rows.isEmpty ? "" : ": " + rows.joined(separator: "; "))")
            }
            self?.reportDelivered()
        }
    }

    private func changed() {
        let menu = NSMenu()
        let items = watcher.menuItems()
        items.forEach(menu.addItem)
        if items.isEmpty { menu.addItem(NSMenuItem(title: "(пропусков нет)", action: nil, keyEquivalent: "")) }
        statusItem.menu = menu
        print("missed: open=\(watcher.open.map(\.id)) notChecked=\(watcher.notChecked) pollError=\(watcher.pollError ?? "-")")
        for item in items { print("missed:   меню «\(item.title)»\(item.isEnabled ? "" : " (неактивен)")") }

        syncCapsule()

        if inviteFirst, !invitedOnce, let miss = watcher.open.first(where: \.canInvite) {
            invitedOnce = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                print("missed: зову бота по \(miss.id) (--invite-first)")
                Task { @MainActor in
                    let ok = await self?.watcher.invite(miss.id) ?? false
                    print("missed: приглашение \(ok ? "принято" : "НЕ принято")")
                }
            }
        }
    }

    // То же правило, что у AppDelegate.syncWidget в покое (D031): встреча есть — кнопка в её
    // капсуле, если бот пропущен именно на её созвон; встречи нет — капсулы нет, пропуск в меню.
    private func syncCapsule() {
        guard withMeeting, !meetingDismissed else {
            widget.hide()
            print("missed: капсула — скрыта (предложения записать нет, пропуск только в меню)")
            return
        }
        let call = ProcessInfo.processInfo.environment["SWARM_SELFTEST_JOIN_URL"]
            ?? watcher.open.first(where: \.canInvite)?.joinURL
        widget.showPending(notice: MeetingNotice(title: "Weekly BD sync", subtitle: "11:00–11:30 · идёт"),
                           canJoin: true, missed: watcher.capsule(forCall: call))
        let frame = widget.currentFrame.map { "\(Int($0.width))×\(Int($0.height))" } ?? "-"
        guard let c = widget.shownMissed else {
            print("missed: капсула \(frame) — встреча \(call ?? "-") без кнопки бота")
            return
        }
        print("missed: капсула \(frame) — встреча \(call ?? "-") · кнопка «\(c.buttonTitle)» [\(c.missId)]"
              + (c.busy ? " (неактивна)" : "") + (c.failure.map { " · отказ «\($0)»" } ?? ""))
    }
}

func runMissedSelfTest(seconds: Double, inviteFirst: Bool, withMeeting: Bool) {
    let env = ProcessInfo.processInfo.environment
    guard let url = env["SWARM_SELFTEST_URL"], let token = env["SWARM_SELFTEST_TOKEN"] else {
        print("missed: нужны SWARM_SELFTEST_URL (…/functions/v1 стенда) и SWARM_SELFTEST_TOKEN (токен рекордера стенда)")
        exit(2)
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let test = MissedSelfTest(config: SwarmConfig(token: token, ingestBaseURL: url, webBaseURL: ""),
                              inviteFirst: inviteFirst, withMeeting: withMeeting)
    test.start()
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
        print("missed: конец прогона (\(Int(seconds)) с)")
        withExtendedLifetime(test) { exit(0) }
    }
    app.run()
}
