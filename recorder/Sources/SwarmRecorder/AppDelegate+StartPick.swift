import AppKit
import RecorderKit

// Выбор встречи на старте записи и «Это моя встреча» (#1278, StartPick). Вынесено из AppDelegate.swift:
// файл на реестре монолитов (scripts/source-size-debt.json) и расти не должен. Состояние — в AppDelegate
// (pickSession, botNow, botSeen); чистая логика — RecorderKit/StartPick.
extension AppDelegate {
    // Идущие сейчас созвоны календаря для старта «руками»: ответ сервера свежий, слот идёт (StartIdentity).
    func liveCalendarEvents() -> [MeetingIdentity.Info] {
        guard let cal = lastCalendar else { return [] }
        let iso = ISO8601DateFormatter()
        let now = Date()
        return cal.items.filter {
            StartIdentity.useCalendar(fetchedAt: cal.at,
                                      start: $0.startISO.flatMap { iso.date(from: $0) },
                                      end: $0.endISO.flatMap { iso.date(from: $0) },
                                      now: now)
        }
    }

    // Старт «руками» (меню, ответ на подсказку, «Записать» на баннере). Не угадываем (#1278, решение
    // владельца 11.11.2026): одно событие и бот его не трогал — берём его, как раньше; несколько
    // событий ИЛИ событие, которое пишет/писал бот, — запись идёт сразу без привязки, а в карточке
    // человек выбирает (StartPick). Событий нет — комната из вкладки браузера, иначе manual.
    func startPicking(live: [MeetingIdentity.Info]) {
        let events = live.map { StartPick.Event(key: $0.key, title: $0.title) }
        let botLeft = botSeen.subtracting(botNow)
        guard StartPick.needsPick(live: events, botIn: botNow, botLeft: botLeft) else {
            beginRecording(identity: live.first ?? MeetingIdentity.currentRoom())
            return
        }
        let options = StartPick.options(live: events, botIn: botNow, botLeft: botLeft)
        Diagnostics.shared.log("RECORD выбор из \(live.count) событий, бот: пишет=\(botNow.count) вышел=\(botLeft.count) → спрашиваем")
        beginRecording(identity: nil, pick: PickSession(events: live, options: options, answer: nil))
    }

    func showPickCard() {
        guard let session = pickSession, session.answer == nil else { return }
        let lang = BoardL10n.language()
        let hint: String
        switch session.options.first?.kind {
        case .continuation: hint = BoardL10n.text("pick.hint.botLeft", lang: lang)
        case .other where session.options.contains { $0.kind == .continuation }: hint = BoardL10n.text("pick.hint.botIn", lang: lang)
        default: hint = BoardL10n.text("pick.body", lang: lang)
        }
        let untitled = BoardL10n.text("pick.untitled", lang: lang)
        let actions = session.options.enumerated().map { index, option -> RecorderNotices.Action in
            let title: String
            switch option.kind {
            case .calendar: title = option.title ?? untitled
            case .continuation: title = BoardL10n.format("pick.continuation", lang: lang, option.title ?? untitled)
            case .other: title = BoardL10n.text("pick.other", lang: lang)
            }
            return .init(title: title, isPrimary: index == 0, run: { [weak self] in self?.applyPick(option) })
        }
        // Висит, пока не ответят или запись не кончится: без ответа запись уйдёт своей ручной встречей.
        RecorderNotices.shared.post(id: Self.pickNoticeId, title: BoardL10n.text("pick.title", lang: lang),
                                    body: hint, lifetime: nil, actions: actions, isVertical: true)
    }

    func applyPick(_ option: StartPick.Option) {
        guard isRecording, var session = pickSession, session.answer == nil else { return }
        session.answer = option
        pickSession = session
        Diagnostics.shared.log("PICK ответ: \(option.kind) \(option.key ?? "—")")
        guard case .calendar(let key) = StartPick.resolution(for: option),
              let chosen = session.events.first(where: { $0.key == key }) else {
            return   // «Другой звонок»: запись остаётся без привязки и уйдёт своей ручной встречей
        }
        identity = chosen
        lastRecordIdentity = chosen
        reminder.noteStarted(key: chosen.key)
        if let endISO = chosen.endISO { scheduledEndAt = ISO8601DateFormatter().date(from: endISO) }
        if let dir = currentRecDir, let base = currentRecBase {
            writeRecordingMeta(dir: dir, base: base, startedAt: recordStartedAt ?? Date(), identity: chosen)
        }
        Task { @MainActor in LiveNotesPanel.shared.setChosenTitle(chosen.title) }
        loadMeetingContext(title: chosen.title)
        refreshStatusTitle()
        rebuildMenu()
    }


    // Запись попала во встречу другого человека (defer): говорим, чья она, и даём отправить аудио как
    // СВОЮ ручную встречу (#1278, «Это моя встреча»). Аудио то же, перезаявка — UploadQueue.resendDeferred
    // с заменой identity на manual.
    func notifyDeferredIntoOthers(meetingId: String, title: String?, holder: String, seconds: Double) {
        let lang = BoardL10n.language()
        let who = holder.hasPrefix("@") ? holder : "@\(holder)"
        let name = title ?? BoardL10n.text("pick.untitled", lang: lang)
        RecorderNotices.shared.post(
            id: "deferred-\(meetingId)",
            title: BoardL10n.format("deferred.mine.title", lang: lang, name, who),
            body: BoardL10n.format("deferred.mine.body", lang: lang, Self.humanDuration(seconds)),
            lifetime: Self.longNoticeSeconds * 20,
            actions: [.init(title: BoardL10n.text("deferred.mine.button", lang: lang), isPrimary: true, run: { [weak self] in
                self?.resendAsMine(meetingId: meetingId)
            })])
    }

    func resendAsMine(meetingId: String) {
        guard let cfg = config else { return }
        Diagnostics.shared.log("USER «Это моя встреча» — перезаявка как manual")
        Task {
            let outcome = await UploadQueue.shared.resendDeferred(meetingId, config: cfg, asManualKey: StartPick.manualKey())
            await refreshQueueBadge()
            await MainActor.run {
                switch outcome {
                case .sent:
                    RecorderNotices.shared.post(id: "resend-\(Int(Date().timeIntervalSince1970))",
                                                title: BoardL10n.text("deferred.mine.sent", lang: BoardL10n.language()),
                                                lifetime: Self.longNoticeSeconds)
                case .stillDeferred(let holder): self.notifyResendOutcome(sent: 0, refused: holder ?? "другой участник", error: nil)
                case .failed(let why): self.notifyResendOutcome(sent: 0, refused: nil, error: why)
                }
            }
        }
    }

    // Запись отклонена сервером (транскрибирует другой участник). Раньше этот исход был НЕОТЛИЧИМ
    // от успеха: файлы стирались, индикатор гас, показывалось штатное «сохраняю встречу».
    // Теперь говорим прямо — пока аудио ещё живо в карантине и решение можно откатить.
    //
    // ⚠️ Текст ИНФОРМИРУЕТ, а не просит решать (issue #274, фидбек владельца 09.09.2026).
    // Прежняя формулировка — «твоя запись сохранена, если она полнее, дошли её» — перекладывала
    // на человека выбор, которого он сделать не может: длительности чужой записи он не видит,
    // сервер этот выбор уже сделал сам по порогам (TAKEOVER_MIN_RATIO/EXTRA_SEC в meeting-claim),
    // а повторная заявка уходит с ТЕМИ ЖЕ секундами и получает тот же отказ. В состоянии
    // published (встречу правил человек или её опубликовали) досылание не сработает вообще
    // никогда. Поэтому текст разведён по причине отказа, которую теперь присылает сервер.
    func notifyDeferred(holder: String?, seconds: Double, heldSeconds: Double?, reason: String?) {
        let who = holder.map { "@\($0)" } ?? "коллега"
        let mine = Self.humanDuration(seconds)
        let title: String, body: String

        switch reason {
        case "published":
            // Перехват запрещён навсегда — предлагать что-либо сделать было бы ложью.
            title = "Встреча уже собрана"
            body = "Эту встречу записал и уже опубликовал \(who) — твоя запись (\(mine)) не нужна. Копия хранится 3 суток и удалится сама."
        case "shorter":
            // Держатель ДЛИННЕЕ — называем обе длительности, решение сервера видно из чисел.
            let theirs = heldSeconds.map { Self.humanDuration($0) }
            title = "Запись обрабатывает \(who)"
            body = theirs.map {
                "В обработку пошла запись \(who) — \($0) против твоих \(mine). Делать ничего не нужно, тезисы придут всем. Твоя копия хранится 3 суток."
            } ?? "В обработку пошла запись \(who), она полнее твоей (\(mine)). Делать ничего не нужно, тезисы придут всем. Твоя копия хранится 3 суток."
        case "similar":
            // Наша запись НЕ короче, но разница не дотянула до порогов перехвата. Числа тут
            // показывать обязательно с объяснением: «взяли 36 мин вместо твоих 38» без причины
            // читается как ошибка, хотя это защита от перетранскрибации почти одинаковых записей.
            title = "Запись обрабатывает \(who)"
            let theirsSimilar = heldSeconds.map { Self.humanDuration($0) }
            body = theirsSimilar.map {
                "Записи практически совпали: твоя \(mine), в обработке \($0) у \(who). Право осталось у того, кто заявился первым — перезапускать обработку из-за такой разницы смысла нет. Твоя копия хранится 3 суток."
            } ?? "Записи практически совпали по длительности (твоя \(mine)) — обрабатывается запись \(who), заявившаяся первой. Твоя копия хранится 3 суток."
        default:
            // race / unknown / старый сервер без причины — общий honest-текст без просьб.
            title = "Запись обрабатывает \(who)"
            body = "Эту встречу обрабатывает \(who) — двойная транскрибация не нужна. Твоя запись (\(mine)) хранится 3 суток на случай сбоя."
        }

        RecorderNotices.shared.post(id: "deferred-\(Int(Date().timeIntervalSince1970))", title: title, body: body,
                                    lifetime: Self.longNoticeSeconds)
    }
}
