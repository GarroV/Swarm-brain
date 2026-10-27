import AppKit
import RecorderKit

// Доска «Сегодня» (Bumblebee): пилюля + панель + голосовая задача + ручная форма + блокнот.
// Канон решения — docs/decisions/2026-10-22-bumblebee-hub.md.
//
// Хаб — единственный объект, который AppDelegate создаёт и просит показать пункты меню; всё
// остальное (клиент, окна, клавиша, запись голоса) живёт здесь, в отдельных файлах. Путь записи
// встреч (AudioRecorder, SystemAudioCapturer, CallDetector, UploadQueue, RecorderWidget) доска
// не использует: голос пишет свой экземпляр AVAudioRecorder (VoiceCapture).
//
// Все методы вызываются с главного потока; сетевые ответы возвращаются в `Task { @MainActor in … }`.
final class BoardHub: NSObject {
    /// Ключи UserDefaults — UI-состояние, не config.json.
    private static let showMeetingsKey = "BoardShowMeetings"

    private static let pillRefreshSeconds: TimeInterval = 300
    private static let panelTickSeconds: TimeInterval = 10
    private static let undoSeconds = 6
    private static let toastLingerSeconds = 4
    private static let messageSeconds: TimeInterval = 5
    private static let countryTaskRows = 30

    /// Меню пересобирается, когда меняется то, что в нём видно (галочка «Показывать значок»).

    private let configProvider: () -> SwarmConfig?
    private let client = BoardClient()
    private let pill = BoardPill()
    private let hotKey = BoardHotKey()
    private let voice = VoiceCapture()
    private var panel: BoardPanel?

    private var snapshot: BoardSnapshot?
    private var offline = false
    private var authFailed = false
    private var refreshing = false
    private var lastRefresh = Date.distantPast
    private var tracker = CheckTracker()
    private var strikeTokens: [String: UUID] = [:]
    /// Задачи, закрытые с этого экрана: сервер мог успеть отдать их ещё раз до ответа на PATCH.
    private var doneIDs: Set<String> = []

    private var message: String?
    private var messageTimer: Timer?
    private var voiceState: VoiceUI = .idle
    private var voiceStarting = false
    private var voiceTimer: Timer?
    private var toast: ToastUI?
    private var toastTimer: Timer?
    private var toastTick = 0
    private var form: FormUI?
    private var markets: [String]?
    private var pillTimer: Timer?
    private var panelTimer: Timer?

    // Страна созвона (issue #1072): что знаем о созвоне, где человек сидит сейчас.
    private static let declinedKey = "BoardCallCountryDeclined"
    private var callTracker = CallCountryTracker()
    private var currentCall: (key: String, title: String?)?
    private var callInfo: CallCountryInfo?
    private var callPicking = false
    private var callBusy = false
    /// Меню шмеля пересобирается, когда появляется или пропадает пункт «Отметить созвон страной…».
    var onMenuChange: (() -> Void)?

    init(config: @escaping () -> SwarmConfig?) {
        configProvider = config
        super.init()
    }

    private var lang: String { BoardL10n.language() }
    private func text(_ key: String) -> String { BoardL10n.text(key, lang: lang) }

    private var showMeetings: Bool {
        get { UserDefaults.standard.object(forKey: Self.showMeetingsKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: Self.showMeetingsKey) }
    }

    // MARK: запуск и меню

    func start() {
        VoiceCapture.sweepStaleFiles()
        hotKey.onPress = { [weak self] in self?.hotKeyPressed() }
        hotKey.register()
        pill.onClick = { [weak self] in self?.togglePanel() }
        pill.onMoved = { [weak self] in self?.panel?.followAnchor() }
        pill.setTooltip(text("board.pill.tip"))
        // Значок можно выключить в меню шмеля (решение владельца 26.10.2026, заменило «неубираемый»).
        if widgetShown { pill.show() }
        pillTimer = Timer.scheduledTimer(withTimeInterval: Self.pillRefreshSeconds, repeats: true) { [weak self] _ in
            guard let self, self.panel?.isVisible != true else { return }
            self.refresh()
        }
        refresh()
    }

    /// Пункты для меню статус-бара и меню приложения: «Задачи и заметки» и галочка «Значок шмеля на экране».
    /// Язык — как у остального меню шмеля (оно пока только по-русски), а не язык системы, как у
    /// панели: иначе в одном меню два языка (владелец 26.10.2026: «что такое Today board?»).
    func menuItems() -> [NSMenuItem] {
        let menuLang = "ru"
        let open = NSMenuItem(title: BoardL10n.text("board.menu", lang: menuLang),
                              action: #selector(menuOpenTapped), keyEquivalent: "")
        open.target = self
        let widget = NSMenuItem(title: BoardL10n.text("board.menu.widget", lang: menuLang),
                                action: #selector(menuWidgetTapped), keyEquivalent: "")
        widget.target = self
        widget.state = widgetShown ? .on : .off
        var items = [open, widget]
        // Пока идёт созвон без метки страны — отметить руками (если вопрос не всплыл или ответили «Нет»).
        if currentCall != nil, callInfo?.country == nil {
            let mark = NSMenuItem(title: BoardL10n.text("call.menu", lang: menuLang),
                                  action: #selector(menuMarkCallTapped), keyEquivalent: "")
            mark.target = self
            items.insert(mark, at: 1)
        }
        return items
    }

    static let widgetShownKey = "BoardWidgetShown"
    private var widgetShown: Bool {
        get { UserDefaults.standard.object(forKey: Self.widgetShownKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: Self.widgetShownKey) }
    }

    @objc private func menuWidgetTapped(_ sender: NSMenuItem) {
        widgetShown.toggle()
        sender.state = widgetShown ? .on : .off
        closePanel()
        if widgetShown { pill.show() } else { pill.hide() }
    }

    @objc private func menuOpenTapped() { open() }

    @objc private func menuMarkCallTapped() { startPicking() }

    /// Открыть доску на переднем плане (клик по значку в Dock, пункт меню).
    func open() { openPanel(makeKey: true) }

    // MARK: панель

    private func ensurePanel() -> BoardPanel {
        if let panel { return panel }
        let p = BoardPanel(lang: lang, config: snapshot?.config ?? .defaults)
        p.anchor = { [weak self] in self?.pill.frame }
        p.onClose = { [weak self] in self?.closePanel() }
        p.onVoiceToggle = { [weak self] in self?.voiceToggle() }
        p.onVoiceCancel = { [weak self] in self?.cancelVoice() }
        p.onManualOpen = { [weak self] in self?.openForm() }
        p.onFormSubmit = { [weak self] title, desc, country, due in self?.submitForm(title, desc, country, due) }
        p.onFormCancel = { [weak self] in self?.closeForm() }
        p.onToggleTask = { [weak self] id in self?.toggleTask(id) }
        p.onOpenMore = { [weak self] in self?.openWeb() }
        p.onJoin = { [weak self] url in self?.join(url) }
        p.onMeetingsToggle = { [weak self] on in self?.showMeetings = on; self?.render() }
        p.onUndo = { [weak self] in self?.undoCreated() }
        p.onEscape = { [weak self] in self?.handleEscape() ?? false }
        p.onCallYes = { [weak self] in self?.callAccept() }
        p.onCallOther = { [weak self] in self?.startPicking() }
        p.onCallNo = { [weak self] in self?.callDecline() }
        p.onCallChange = { [weak self] in self?.startPicking() }
        p.onCallPick = { [weak self] code in self?.callSet(code) }
        p.onCallPickCancel = { [weak self] in self?.callPicking = false; self?.render() }
        p.notepad.onToTask = { [weak self] title in self?.createFromNote(title) }
        panel = p
        return p
    }

    private func togglePanel() {
        // Доска за другими окнами — клик по значку поднимает её, а не прячет.
        if panel?.isFrontmost == true { closePanel() } else { openPanel(makeKey: true) }
    }

    private func openPanel(makeKey: Bool) {
        let p = ensurePanel()
        let wasVisible = p.isVisible
        render()
        p.show(makeKey: makeKey)
        if !wasVisible {
            panelTimer?.invalidate()
            panelTimer = Timer.scheduledTimer(withTimeInterval: Self.panelTickSeconds, repeats: true) { [weak self] _ in
                self?.panelTick()
            }
            refresh()
        }
    }

    private func closePanel() {
        panel?.hide()
        panelTimer?.invalidate(); panelTimer = nil
    }

    /// Раз в 10 с, пока панель открыта: обновить по `refresh_seconds` и перерисовать (часы встреч).
    private func panelTick() {
        let every = TimeInterval(snapshot?.config.refreshSeconds ?? BoardConfig.defaults.refreshSeconds)
        if Date().timeIntervalSince(lastRefresh) >= every { refresh() } else { render() }
    }

    private func handleEscape() -> Bool {
        if case .recording = voiceState { cancelVoice(); return true }
        if callPicking { callPicking = false; render(); return true }
        if form != nil { closeForm(); return true }
        return false
    }

    // MARK: данные

    private func refresh() {
        guard let cfg = configProvider() else {
            snapshot = nil; offline = false; authFailed = false
            pill.setCount(0)
            render()
            return
        }
        guard !refreshing else { return }
        refreshing = true
        Task { @MainActor in
            defer { self.refreshing = false }
            do {
                var snap = try await self.client.today(config: cfg)
                self.applyDone(to: &snap)
                self.snapshot = snap
                self.offline = false
                self.authFailed = false
                self.lastRefresh = Date()
            } catch BoardError.auth {
                self.authFailed = true      // токен не принят: подпись остаётся, пока не починят токен
            } catch {
                self.offline = true         // нет связи — показываем последнее, ничего не теряем
            }
            self.pill.setCount(self.pillCount)
            self.render()
        }
    }

    /// Закрытые с доски задачи не возвращаются из ответа, который вышел раньше PATCH.
    private func applyDone(to snap: inout BoardSnapshot) {
        let present = Set(snap.tasks.map(\.id))
        doneIDs.formIntersection(present)           // сервер догнал — запись о закрытии больше не нужна
        guard !doneIDs.isEmpty else { return }
        let before = snap.tasks.count
        snap.tasks.removeAll { doneIDs.contains($0.id) }
        snap.tasksTotal = max(snap.tasksTotal - (before - snap.tasks.count), snap.tasks.count)
    }

    private var pillCount: Int { max((snapshot?.tasksTotal ?? 0) - tracker.inFlightCount, 0) }

    private func render() {
        guard let panel else { return }
        let snap = snapshot
        var msg = message
        if msg == nil {
            if configProvider() == nil { msg = text("board.noToken") }
            else if authFailed { msg = text("voice.err.auth") }
        }
        var config = snap?.config ?? .defaults
        var tasks = tracker.visible(snap?.tasks ?? [])
        var tasksTotal = max((snap?.tasksTotal ?? 0) - tracker.inFlightCount, 0)
        let call = callView
        if case .country(_, let countryTasks) = call {
            // Экран страны: вместо задач дня — все открытые задачи страны (владелец 27.10.2026).
            tasks = tracker.visible(countryTasks)
            tasksTotal = tasks.count
            config.taskRows = max(config.taskRows, Self.countryTaskRows)
        }
        let state = BoardViewState(
            lang: lang,
            config: config,
            loaded: snap != nil || callInfo != nil,
            tasks: tasks,
            tasksTotal: tasksTotal,
            struck: tracker.struckIDs,
            meetings: snap?.meetings ?? [],
            meetingsReason: snap?.meetingsReason,
            showMeetings: showMeetings,
            offline: offline,
            message: msg,
            voice: voiceState,
            toast: toast,
            form: form,
            hotKeyHint: hotKey.isRegistered,
            today: BoardDay.today(),
            now: Date(),
            call: call)
        panel.render(state)
    }

    private func setMessage(_ key: String) {
        message = text(key)
        messageTimer?.invalidate()
        messageTimer = Timer.scheduledTimer(withTimeInterval: Self.messageSeconds, repeats: false) { [weak self] _ in
            self?.message = nil
            self?.render()
        }
        render()
    }

    private func failureKey(_ error: Error) -> String {
        switch error as? BoardError {
        case .offline?: return VoiceFailure.messageKey(status: nil, body: nil)
        case .auth?: return VoiceFailure.messageKey(status: 401, body: nil)
        case .http(let status, let body)?: return VoiceFailure.messageKey(status: status, body: body)
        default: return "voice.err.generic"
        }
    }

    // MARK: галочка

    private func toggleTask(_ id: String) {
        let result = tracker.toggle(id)
        switch result {
        case .struck:
            let token = UUID()
            strikeTokens[id] = token
            DispatchQueue.main.asyncAfter(deadline: .now() + CheckTracker.delay) { [weak self] in
                // Если строку успели отменить и зачеркнуть заново, этот таймер уже не её.
                guard self?.strikeTokens[id] == token else { return }
                self?.commitTask(id)
            }
        case .cancelled:
            strikeTokens[id] = nil
        }
        render()
    }

    private func commitTask(_ id: String) {
        strikeTokens[id] = nil
        guard tracker.commit(id) else { return }
        render()
        guard let cfg = configProvider() else { tracker.failed(id); setMessage("tasks.checkFailed"); return }
        Task { @MainActor in
            do {
                try await self.client.setStatus(config: cfg, taskId: id, done: true)
                self.tracker.finished(id)
                self.doneIDs.insert(id)
                if let info = self.callInfo {
                    self.callInfo = CallCountryInfo(seriesKey: info.seriesKey, country: info.country, suggested: info.suggested,
                                                    markets: info.markets, tasks: info.tasks.filter { $0.id != id })
                }
                if var snap = self.snapshot {
                    snap.tasks.removeAll { $0.id == id }
                    snap.tasksTotal = max(snap.tasksTotal - 1, snap.tasks.count)
                    self.snapshot = snap
                }
                self.pill.setCount(self.pillCount)
                self.render()
            } catch {
                self.tracker.failed(id)         // строка возвращается, а не пропадает молча
                self.setMessage("tasks.checkFailed")
            }
        }
    }

    // MARK: встречи и веб

    private func join(_ raw: String) {
        guard let url = URL(string: raw), url.scheme?.lowercased() == "https" else { return }
        NSWorkspace.shared.open(url)
    }

    private func openWeb() {
        let base = configProvider()?.webBaseURL ?? WebBase.current
        guard let url = URL(string: base.isEmpty ? WebBase.current : base) else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: страна созвона

    private var callView: CallCountryView {
        guard currentCall != nil else { return .none }
        if callPicking {
            return .pick(markets: callInfo?.markets ?? markets ?? [], selected: callInfo?.country ?? callInfo?.suggested)
        }
        let declined = callInfo.map { declinedSeries().contains($0.seriesKey) } ?? false
        return CallCountry.decide(callInfo, declined: declined)
    }

    private func declinedSeries() -> [String] {
        UserDefaults.standard.stringArray(forKey: Self.declinedKey) ?? []
    }

    /// Раз в тик наблюдателя (~25 с) из AppDelegate: `micOn` — идёт реальный звонок, `call` — созвон из
    /// календаря, где человек сидит (nil — неизвестен). Сервер зовём один раз на созвон; конец звонка
    /// снимает режим страны.
    func callTick(micOn: Bool, call: (key: String, title: String?)?) {
        switch callTracker.tick(micOn: micOn, key: call?.key) {
        case .none:
            break
        case .ended:
            endCall()
        case .fetch(let key):
            currentCall = (key, call?.title)
            callInfo = nil
            callPicking = false
            onMenuChange?()
            fetchCall(key: key, title: call?.title)
        }
    }

    private func endCall() {
        currentCall = nil
        callInfo = nil
        callPicking = false
        onMenuChange?()
        render()
    }

    private func fetchCall(key: String, title: String?) {
        guard let cfg = configProvider() else { callTracker.failed(key: key); return }
        Task { @MainActor in
            do {
                let info = try await self.client.fetchCall(config: cfg, key: key, title: title)
                guard self.currentCall?.key == key else { return }      // звонок успел закончиться или смениться
                self.callInfo = info
                self.onMenuChange?()
                if self.callView != .none { self.openPanel(makeKey: false) } else { self.render() }
            } catch {
                self.callTracker.failed(key: key)       // нет связи/сервера — следующий тик попробует снова
            }
        }
    }

    private func startPicking() {
        guard currentCall != nil else { return }
        callPicking = true
        openPanel(makeKey: true)
        guard (callInfo?.markets ?? markets ?? []).isEmpty, let cfg = configProvider() else { return }
        Task { @MainActor in
            if let list = try? await self.client.markets(config: cfg) {
                self.markets = list
                self.render()
            }
        }
    }

    private func callAccept() {
        guard case .ask(let code) = callView else { return }
        callSet(code)
    }

    private func callDecline() {
        guard let info = callInfo else { return }
        UserDefaults.standard.set(CallCountry.remember(info.seriesKey, in: declinedSeries()), forKey: Self.declinedKey)
        render()
    }

    private func callSet(_ code: String) {
        guard let call = currentCall, !callBusy, let cfg = configProvider() else { return }
        callBusy = true
        Task { @MainActor in
            defer { self.callBusy = false }
            do {
                let info = try await self.client.setCallCountry(config: cfg, key: call.key, country: code)
                guard self.currentCall?.key == call.key else { return }
                self.callInfo = info
                self.callPicking = false
                self.onMenuChange?()
                self.render()
            } catch {
                self.setMessage("call.err")
            }
        }
    }

    // MARK: голос

    private func hotKeyPressed() { voiceToggle() }

    private func voiceToggle() {
        switch voiceState {
        case .idle: startVoice()
        case .recording: finishVoice()
        case .sending: break
        }
    }

    private func startVoice() {
        guard !voiceStarting else { return }
        openPanel(makeKey: true)
        guard configProvider() != nil else { render(); return }   // сообщение «нужен токен» рисует render
        voiceStarting = true
        message = nil
        Task { @MainActor in
            let result = await self.voice.start()
            self.voiceStarting = false
            switch result {
            case .started:
                self.voiceState = .recording(seconds: 0)
                self.armVoiceTimer()
                self.render()
            case .micDenied: self.setMessage("voice.err.mic")
            case .failed: self.setMessage("voice.err.start")
            }
        }
    }

    private func armVoiceTimer() {
        voiceTimer?.invalidate()
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.voiceTick() }
        RunLoop.main.add(t, forMode: .common)
        voiceTimer = t
    }

    private func voiceTick() {
        guard case .recording(let shown) = voiceState else { return }
        let elapsed = voice.elapsed
        if elapsed >= VoiceClip.maxSeconds { finishVoice(); return }   // потолок — отправляем сами
        if Int(elapsed) != shown { voiceState = .recording(seconds: Int(elapsed)); render() }
    }

    private func cancelVoice() {
        voiceTimer?.invalidate(); voiceTimer = nil
        voice.cancel()
        voiceState = .idle
        render()
    }

    private func finishVoice() {
        voiceTimer?.invalidate(); voiceTimer = nil
        guard let clip = voice.finish() else { voiceState = .idle; render(); return }
        guard VoiceClip.verdict(duration: clip.duration) == .send, let cfg = configProvider() else {
            voice.discard()                 // слишком короткая (случайное нажатие) — выбрасываем
            voiceState = .idle
            render()
            return
        }
        voiceState = .sending
        render()
        Task { @MainActor in
            defer { self.voice.discard() }  // временный файл удаляется при любом исходе
            do {
                let data = try Data(contentsOf: clip.url)
                let task = try await self.client.createVoiceTask(config: cfg, audio: data)
                self.voiceState = .idle
                self.showCreated(task)
                self.refresh()
            } catch {
                self.voiceState = .idle
                self.setMessage(self.failureKey(error))
            }
        }
    }

    // MARK: карточка «Задача создана»

    private func showCreated(_ task: CreatedTask) {
        message = nil
        toast = ToastUI(kind: .created(task: task, undoLeft: Self.undoSeconds))
        toastTick = 0
        toastTimer?.invalidate()
        toastTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.toastTicked() }
        RunLoop.main.add(toastTimer!, forMode: .common)
        render()
    }

    private func toastTicked() {
        toastTick += 1
        guard case .created(let task, _)? = toast?.kind else { return }
        if toastTick < Self.undoSeconds {
            toast = ToastUI(kind: .created(task: task, undoLeft: Self.undoSeconds - toastTick))
        } else if toastTick == Self.undoSeconds {
            toast = ToastUI(kind: .created(task: task, undoLeft: nil))
        } else if toastTick >= Self.undoSeconds + Self.toastLingerSeconds {
            clearToast()
            return
        }
        render()
    }

    private func armToastClear(after seconds: TimeInterval) {
        toastTimer?.invalidate()
        toastTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in self?.clearToast() }
    }

    private func clearToast() {
        toastTimer?.invalidate(); toastTimer = nil
        toast = nil
        render()
    }

    private func undoCreated() {
        guard case .created(let task, let left)? = toast?.kind, left != nil, let cfg = configProvider() else { return }
        toastTimer?.invalidate()
        Task { @MainActor in
            do {
                try await self.client.deleteTask(config: cfg, taskId: task.id)
                self.toast = ToastUI(kind: .message(self.text("card.undone")))
                self.refresh()
            } catch {
                self.toast = ToastUI(kind: .message(self.text("card.undoFailed")))
            }
            self.render()
            self.armToastClear(after: 3)
        }
    }

    // MARK: ручная задача

    private func openForm() {
        guard configProvider() != nil else { render(); return }
        form = FormUI(markets: markets ?? [])
        render()
        panel?.show(makeKey: true)
        panel?.focusFormTitle()
        guard markets == nil, let cfg = configProvider() else { return }
        Task { @MainActor in
            if let list = try? await self.client.markets(config: cfg) {
                self.markets = list
                self.form?.markets = list
                self.render()
            }
        }
    }

    private func closeForm() {
        form = nil
        render()
    }

    private func submitForm(_ title: String, _ description: String, _ country: String?, _ due: String) {
        guard var f = form, !f.busy, let cfg = configProvider() else { return }
        f.busy = true; f.error = nil
        form = f
        render()
        Task { @MainActor in
            do {
                let task = try await self.client.createManualTask(config: cfg, title: title, description: description,
                                                                  country: country, dueDate: due)
                self.form = nil
                self.showCreated(task)
                self.refresh()
            } catch {
                self.form?.busy = false
                self.form?.error = self.text(self.failureKey(error))
                self.render()
            }
        }
    }

    /// «→ В задачу» из блокнота: строка/выделение → задача на завтра, та же карточка с «Отменить».
    /// «→» в блокноте не создаёт задачу сразу: открывает ту же форму, что «＋», с текстом строки
    /// в названии — срок (по умолчанию завтра) и страну человек выбирает сам (решение владельца
    /// 23.10.2026: «предлагать дату… и страну… это может быть достаточно критично»).
    private func createFromNote(_ title: String) {
        guard configProvider() != nil else { setMessage("board.noToken"); return }
        openForm()
        panel?.prefillForm(title: title)
    }
}
