import AppKit
import Foundation
import UserNotifications

// Режим --selftest-missed: живая проверка «бот не пришёл на встречу» (T162) против стенда, мимо
// рабочей установки человека. Конфиг рекордера (токен, прод-адрес) НЕ читается: адрес и токен —
// SWARM_SELFTEST_URL / SWARM_SELFTEST_TOKEN, как у --selftest-quarantine. Поднимает только
// MissedMeetingsWatcher и значок в меню-баре с его пунктами — запись, heartbeat и апдейтер спят.
//   --selftest-missed                 опрашивать и показывать 180 секунд
//   --selftest-missed --keep N        держать N секунд
//   --selftest-missed --invite-first  через 5 с после первого пропуска с кнопкой позвать бота
//                                     тем же вызовом, что и кнопка (если нажать руками нечем)
// Баннеры macOS показываются только из бандла: запускать из собранного .app, у которого СВОЙ
// bundle id — иначе разрешение на уведомления и баннеры смешаются с рабочим bumblebee.
// Каждое изменение печатается строкой `missed:` в stdout — по ним и сверяется прогон.
final class MissedSelfTest: NSObject, UNUserNotificationCenterDelegate {
    private let watcher: MissedMeetingsWatcher
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let inviteFirst: Bool
    private var invitedOnce = false

    init(config: SwarmConfig, inviteFirst: Bool) {
        self.inviteFirst = inviteFirst
        var onChange: () -> Void = {}
        watcher = MissedMeetingsWatcher(config: { config }, onChange: { onChange() })
        super.init()
        onChange = { [weak self] in self?.changed() }
        statusItem.button?.title = "🐝 missed"
    }

    func start() {
        if Bundle.main.bundleIdentifier != nil {
            let center = UNUserNotificationCenter.current()
            center.delegate = self
            center.requestAuthorization(options: [.alert, .sound]) { ok, err in
                print("missed: разрешение на уведомления — \(ok ? "есть" : "НЕТ") \(err.map { "\($0)" } ?? "")")
            }
        } else {
            print("missed: ⚠️ запущено не из бандла — баннеров не будет, проверяется только меню и вызовы")
        }
        watcher.registerCategory()
        watcher.start()
        watcher.pollNow()
        changed()
    }

    private func changed() {
        let menu = NSMenu()
        let items = watcher.menuItems()
        items.forEach(menu.addItem)
        if items.isEmpty { menu.addItem(NSMenuItem(title: "(пропусков нет)", action: nil, keyEquivalent: "")) }
        statusItem.menu = menu
        print("missed: open=\(watcher.open.map(\.id)) notChecked=\(watcher.notChecked) pollError=\(watcher.pollError ?? "-")")
        for item in items { print("missed:   меню «\(item.title)»\(item.isEnabled ? "" : " (неактивен)")") }

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

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        print("missed: баннер на экране [\(notification.request.identifier)] «\(notification.request.content.title)» — \(notification.request.content.body)")
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        print("missed: действие на баннере \(response.actionIdentifier)")
        if response.actionIdentifier == MissedMeetingsWatcher.inviteActionId,
           let missId = response.notification.request.content.userInfo[MissedMeetingsWatcher.missIdKey] as? String {
            Task { @MainActor in
                let ok = await self.watcher.invite(missId)
                print("missed: приглашение с баннера \(ok ? "принято" : "НЕ принято")")
            }
        }
        completionHandler()
    }
}

func runMissedSelfTest(seconds: Double, inviteFirst: Bool) {
    let env = ProcessInfo.processInfo.environment
    guard let url = env["SWARM_SELFTEST_URL"], let token = env["SWARM_SELFTEST_TOKEN"] else {
        print("missed: нужны SWARM_SELFTEST_URL (…/functions/v1 стенда) и SWARM_SELFTEST_TOKEN (токен рекордера стенда)")
        exit(2)
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let test = MissedSelfTest(config: SwarmConfig(token: token, ingestBaseURL: url, webBaseURL: ""),
                              inviteFirst: inviteFirst)
    test.start()
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
        print("missed: конец прогона (\(Int(seconds)) с)")
        withExtendedLifetime(test) { exit(0) }
    }
    app.run()
}
