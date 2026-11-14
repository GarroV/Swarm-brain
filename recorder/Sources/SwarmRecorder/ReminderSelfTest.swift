import AppKit
import Foundation
import RecorderKit

// Режим --selftest-reminder: живой показ напоминания о записи и собственных уведомлений рекордера
// (решение владельца 09.11.2026) без сервера, токена и записи: капсула в режиме напоминания по
// выдуманной встрече + три карточки (информационная, с действиями, длинная). Рабочая установка не
// трогается: конфиг не читается, запускать из собранного .app. Нажатия в консоль печатаются
// строками `reminder:`. С SWARM_SELFTEST_SHOTS=<папка> кадры capsule.png / notices.png снимаются
// изнутри процесса (работает и при заблокированном экране).
//   --selftest-reminder            показывать 40 секунд
//   --selftest-reminder --keep N   держать N секунд
func runReminderSelfTest(seconds: Double) {
    setvbuf(stdout, nil, _IOLBF, 0)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let widget = RecorderWidget()
    let notices = RecorderNotices.shared
    notices.widgetFrame = { widget.panel?.isVisible == true ? widget.currentFrame : nil }
    widget.onRecord = { print("reminder: «Записать» нажата — стартовала бы запись по встрече") }
    widget.onDismiss = { print("reminder: «Не сейчас» нажата — встреча скрыта до конца события"); widget.hide() }

    let now = Date()
    widget.showPending(notice: MeetingNotice.compose(title: "Weekly BD sync", start: now.addingTimeInterval(-120),
                                                     end: now.addingTimeInterval(1680), now: now),
                       canJoin: true, reminder: true)
    notices.post(id: "t-info", title: "Запись отправлена", body: "Встреча пошла в обработку — тезисы придут в Telegram.")
    notices.post(id: "t-action", title: BoardL10n.text("nudge.title", lang: BoardL10n.language()),
                 body: BoardL10n.text("nudge.body", lang: BoardL10n.language()), lifetime: nil,
                 actions: [.init(title: BoardL10n.text("nudge.record", lang: BoardL10n.language()), isPrimary: true,
                                 run: { print("reminder: карточка — «Записать»") }),
                           .init(title: BoardL10n.text("nudge.skip", lang: BoardL10n.language()),
                                 run: { print("reminder: карточка — «Не надо»") })])
    notices.post(id: "t-long", title: "Переподключи Google-календарь",
                 body: "Доступ к Google-календарю отвалился — авто-название и авто-стоп встреч по расписанию не работают. Открой Swarm в вебе → Настройки → Google-календарь и подключи заново.",
                 lifetime: nil)
    print("reminder: капсула \(widget.currentFrame.map { "\(Int($0.width))×\(Int($0.height))" } ?? "-"), карточки \(notices.shownTitles)")

    if let dir = ProcessInfo.processInfo.environment["SWARM_SELFTEST_SHOTS"] {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            func shot(_ w: NSWindow?, _ name: String) {
                guard let root = w?.contentView, let rep = root.bitmapImageRepForCachingDisplay(in: root.bounds) else { return }
                root.cacheDisplay(in: root.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: dir + "/" + name))
                print("reminder: кадр \(Int(root.bounds.width))×\(Int(root.bounds.height)) → \(name)")
            }
            shot(widget.panel, "capsule.png")
            shot(app.windows.first { $0 !== widget.panel && $0.isVisible && $0 is NSPanel }, "notices.png")
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { exit(0) }
    app.run()
}
