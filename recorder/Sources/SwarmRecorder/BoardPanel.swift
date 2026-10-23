import AppKit
import RecorderKit

// Панель доски «Сегодня»: плавающее окно, которое не забирает фокус у приложения под ним.
// Только вид: что показывать приходит снимком (`BoardViewState`), что нажали — уходит замыканием в
// `BoardHub`. Состояния (галочки, голос, карточка) держит хаб, панель их не придумывает.
// Макет-эталон: тёплый графит, янтарь, две колонки сверху (задачи | встречи), блокнот снизу.

enum VoiceUI: Equatable {
    case idle
    case recording(seconds: Int)
    case sending
}

struct ToastUI: Equatable {
    enum Kind: Equatable {
        case created(task: CreatedTask, undoLeft: Int?)   // undoLeft nil — время отмены вышло
        case message(String)
    }
    var kind: Kind
}

struct FormUI: Equatable {
    var markets: [String]
    var busy = false
    var error: String?
}

struct BoardViewState {
    var lang: String
    var config: BoardConfig
    var loaded: Bool
    var tasks: [BoardTask]          // уже без строк, у которых PATCH в пути
    var tasksTotal: Int
    var struck: Set<String>
    var meetings: [BoardMeeting]
    var meetingsReason: String?
    var showMeetings: Bool
    var offline: Bool
    var message: String?            // короткая строка об ошибке (голос, галочка, нет токена)
    var voice: VoiceUI
    var toast: ToastUI?
    var form: FormUI?
    var hotKeyHint: Bool
    var today: String
    var now: Date
}

/// Окно панели: может стать ключевым (поля ввода), но не делает приложение активным; Esc и
/// стандартные ⌘-правки обрабатывает само — у агентского приложения нет меню «Правка».
final class BoardWindow: NSPanel {
    var onEscape: (() -> Bool)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown, event.keyCode == 53, onEscape?() == true { return }
        super.sendEvent(event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command), !flags.contains(.option), !flags.contains(.control) else {
            return super.performKeyEquivalent(with: event)
        }
        let shift = flags.contains(.shift)
        let selector: Selector?
        switch event.charactersIgnoringModifiers?.lowercased() {
        case "c": selector = #selector(NSText.copy(_:))
        case "v": selector = #selector(NSText.paste(_:))
        case "x": selector = #selector(NSText.cut(_:))
        case "a": selector = #selector(NSText.selectAll(_:))
        case "z": selector = Selector(shift ? "redo:" : "undo:")
        default: selector = nil
        }
        if let selector, NSApp.sendAction(selector, to: nil, from: self) { return true }
        return super.performKeyEquivalent(with: event)
    }
}

final class BoardPanel: NSObject, NSWindowDelegate {
    // — что нажали —
    var onVoiceToggle: (() -> Void)?
    var onVoiceCancel: (() -> Void)?
    var onManualOpen: (() -> Void)?
    var onFormSubmit: ((_ title: String, _ description: String, _ country: String?, _ due: String) -> Void)?
    var onFormCancel: (() -> Void)?
    var onToggleTask: ((String) -> Void)?
    var onOpenMore: (() -> Void)?
    var onJoin: ((String) -> Void)?
    var onMeetingsToggle: ((Bool) -> Void)?
    var onUndo: (() -> Void)?
    var onClose: (() -> Void)?
    var onEscape: (() -> Bool)?

    let notepad: BoardNotepad
    private(set) var window: BoardWindow!

    private static let minWidth: CGFloat = 380
    private static let maxWidth: CGFloat = 1060
    private static let rowHeight: CGFloat = 30
    private static let widthKey = "BoardPanelWidth"
    private static let originKey = "BoardPanelTopLeft"

    private var lang: String
    private var state: BoardViewState?
    private var lastConfigWidth: Int?
    private var programmaticFrame = false

    // — вид —
    private let root = boardStack(.vertical)
    private let titleLabel = boardLabel("", size: 14, weight: .semibold).hugText()
    private let dateLabel = boardLabel("", size: 12, color: BoardTheme.ink3).hugText()
    private let offlineLabel = boardLabel("", size: 11, color: BoardTheme.ink3).hugText()
    private var micButton: FlatButton!
    private var manualButton: FlatButton!
    private var gearButton: FlatButton!
    private var closeButton: FlatButton!
    private let messageLabel = boardLabel("", size: 12, color: BoardTheme.amber)
    private let messageRow: NSStackView
    private let voiceBar = BoxView(fill: BoardTheme.fill, radius: 10)
    private let voiceDot = RecDotView(frame: .zero)
    private let voiceLabel = boardLabel("", size: 13, weight: .medium)
    private let voiceHint = boardLabel("", size: 11.5, color: BoardTheme.ink3)
    private var voiceCancel: FlatButton!
    private let voiceWrap: NSStackView
    private let toastBox = BoxView(fill: BoardTheme.amberSoft, radius: 10, border: BoardTheme.amber.withAlphaComponent(0.4))
    private let toastHead = boardLabel("", size: 12, weight: .semibold, color: BoardTheme.amber)
    private let toastName = boardLabel("", size: 14, weight: .semibold)
    private let toastChips = boardStack(.horizontal, spacing: 6)
    private let toastHeard = boardLabel("", size: 11.5, color: BoardTheme.ink3)
    private var toastUndo: FlatButton!
    private let toastWrap: NSStackView
    private let formBox = BoxView(fill: BoardTheme.fill, radius: 10)
    private let formTitle = NSTextField()
    private let formDescription = NSTextField()
    private let formCountry = NSPopUpButton(frame: .zero, pullsDown: false)
    private let formDue = NSDatePicker()
    private let formCountryLabel = boardLabel("", size: 11.5, color: BoardTheme.ink3)
    private let formDueLabel = boardLabel("", size: 11.5, color: BoardTheme.ink3)
    private let formError = boardLabel("", size: 12, color: BoardTheme.rec)
    private var formCreate: FlatButton!
    private var formCancel: FlatButton!
    private let formWrap: NSStackView
    private var formMarkets: [String] = []

    private let columns = boardStack(.horizontal)
    private let tasksCol = boardStack(.vertical)
    private let tasksHeader = boardLabel("", size: 10.5, weight: .semibold, color: BoardTheme.ink3)
    private let tasksCount = boardLabel("", size: 11, color: BoardTheme.amber, mono: true).hugText()
    private let taskRows = boardStack(.vertical)
    private let meetingsCol = boardStack(.vertical)
    private let meetingsHeader = boardLabel("", size: 10.5, weight: .semibold, color: BoardTheme.ink3)
    private let meetingsCount = boardLabel("", size: 11, color: BoardTheme.amber, mono: true).hugText()
    private let meetingRows = boardStack(.vertical)
    private let columnsDivider = boardDivider(vertical: true)
    private var meetingsWidth: NSLayoutConstraint!

    init(lang: String, config: BoardConfig) {
        self.lang = lang
        notepad = BoardNotepad(lang: lang, height: CGFloat(config.notesHeight))
        messageRow = paddedRow(insets: NSEdgeInsets(top: 8, left: 14, bottom: 0, right: 14), views: [messageLabel])
        voiceWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 10, left: 12, bottom: 0, right: 12), views: [voiceBar])
        toastWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 10, left: 12, bottom: 0, right: 12), views: [toastBox])
        formWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 10, left: 12, bottom: 0, right: 12), views: [formBox])
        super.init()
        buildWindow()
        buildHeader()
        buildVoiceBar()
        buildToast()
        buildForm()
        buildColumns()
        notepad.view.translatesAutoresizingMaskIntoConstraints = false
        for v in [messageRow, voiceWrap, toastWrap, formWrap] { v.isHidden = true }
        let divider = boardDivider(vertical: false)
        let divider2 = boardDivider(vertical: false)
        for v in [headerBar!, divider, messageRow, voiceWrap, toastWrap, formWrap, columns, divider2, notepad.view] { root.addArrangedSubview(v) }
        guard let content = window.contentView else { return }
        content.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            root.topAnchor.constraint(equalTo: content.topAnchor),
        ])
    }

    // MARK: окно

    private func buildWindow() {
        let w = BoardWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 560),
                            styleMask: [.titled, .resizable, .fullSizeContentView],
                            backing: .buffered, defer: false)
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { w.standardWindowButton(b)?.isHidden = true }
        w.isOpaque = false
        w.backgroundColor = BoardTheme.panelBg
        w.appearance = NSAppearance(named: .darkAqua)
        // Обычное окно, а не плавающее: другие окна его перекрывают, вернуть — через Dock,
        // ⌘Tab или значок доски (решение владельца 23.10.2026).
        w.isFloatingPanel = false
        w.level = .normal
        w.hidesOnDeactivate = false
        w.isMovableByWindowBackground = true
        w.isReleasedWhenClosed = false
        w.hasShadow = true
        w.delegate = self
        w.onEscape = { [weak self] in self?.onEscape?() ?? false }
        window = w
    }

    var isVisible: Bool { window.isVisible }
    var isFrontmost: Bool { window.isVisible && window.isKeyWindow }

    func show(makeKey: Bool) {
        if makeKey {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        } else {
            window.orderFrontRegardless()
        }
    }

    func hide() {
        notepad.flush()
        window.orderOut(nil)
    }

    func focusFormTitle() { window.makeFirstResponder(formTitle) }

    func windowDidMove(_ notification: Notification) {
        guard !programmaticFrame else { return }
        UserDefaults.standard.set(NSStringFromPoint(NSPoint(x: window.frame.minX, y: window.frame.maxY)), forKey: Self.originKey)
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        UserDefaults.standard.set(Double(window.contentLayoutRect.width), forKey: Self.widthKey)
    }

    private var savedWidth: CGFloat? {
        let v = UserDefaults.standard.double(forKey: Self.widthKey)
        return v > 0 ? CGFloat(v) : nil
    }

    /// Ширина: сохранённая (человек тянул мышкой) → иначе `panel_width` с сервера.
    private func targetWidth(config: BoardConfig) -> CGFloat {
        let screenW = NSScreen.main?.visibleFrame.width ?? 1440
        let w = savedWidth ?? CGFloat(config.panelWidth)
        return min(max(w, Self.minWidth), min(Self.maxWidth, screenW - 24))
    }

    /// Подгоняет высоту окна под содержимое (ширину задаёт человек), верхний левый угол не двигается.
    private func fit() {
        guard let state else { return }
        root.layoutSubtreeIfNeeded()
        let height = ceil(root.fittingSize.height)
        let width = targetWidth(config: state.config)
        // Содержимое во всё окно (fullSizeContentView): высота окна = высоте содержимого, строку заголовка не добавляем.
        let frameSize = NSSize(width: width, height: height)
        let current = window.frame
        // Человек тянул ширину — она его; иначе ширину ведёт сервер (`panel_width`) и правка доезжает без сборки.
        let serverChangedWidth = savedWidth == nil && lastConfigWidth != state.config.panelWidth
        let newWidth = window.isVisible && !serverChangedWidth ? current.width : frameSize.width
        var origin = NSPoint(x: current.minX, y: current.maxY - frameSize.height)
        if !window.isVisible { origin = startOrigin(size: NSSize(width: newWidth, height: frameSize.height)) }
        programmaticFrame = true
        window.contentMinSize = NSSize(width: Self.minWidth, height: height)
        window.contentMaxSize = NSSize(width: Self.maxWidth, height: height)
        window.setFrame(NSRect(origin: origin, size: NSSize(width: newWidth, height: frameSize.height)), display: true)
        programmaticFrame = false
        lastConfigWidth = state.config.panelWidth
    }

    private func startOrigin(size: NSSize) -> NSPoint {
        guard let vf = NSScreen.main?.visibleFrame else { return .zero }
        if let raw = UserDefaults.standard.string(forKey: Self.originKey) {
            let topLeft = NSPointFromString(raw)
            let rect = NSRect(x: topLeft.x, y: topLeft.y - size.height, width: size.width, height: size.height)
            if let screen = NSScreen.screens.map({ $0.visibleFrame }).first(where: { $0.intersects(rect) }) {
                let x = min(max(rect.minX, screen.minX), max(screen.minX, screen.maxX - size.width))
                let y = min(max(rect.minY, screen.minY), max(screen.minY, screen.maxY - size.height))
                return NSPoint(x: x, y: y)
            }
        }
        // По умолчанию: под пилюлей, правым краем у её правого края (левее капсулы записи).
        let right = vf.maxX - 18 - 72 - 10
        return NSPoint(x: max(vf.minX, right - size.width), y: max(vf.minY, vf.maxY - 8 - 44 - 8 - size.height))
    }

    // MARK: сборка вида

    private var headerBar: NSStackView!

    private func buildHeader() {
        micButton = FlatButton(title: "", fill: BoardTheme.amber, hover: BoardTheme.amber.withAlphaComponent(0.85),
                               color: BoardTheme.amberInk, size: 12.5, weight: .semibold, radius: 8,
                               target: self, action: #selector(micTapped))
        manualButton = FlatButton(title: "", target: self, action: #selector(manualTapped))
        gearButton = FlatButton(title: "⚙", fill: .clear, color: BoardTheme.ink2, size: 14, target: self, action: #selector(gearTapped))
        closeButton = FlatButton(title: "✕", fill: .clear, color: BoardTheme.ink2, size: 13, target: self, action: #selector(closeTapped))
        let spacer = boardSpacer()
        let titleStack = boardStack(.horizontal, spacing: 8, views: [titleLabel, dateLabel, offlineLabel])
        let headerRow = boardStack(.horizontal, spacing: 8,
                                   views: [titleStack, spacer, micButton, manualButton, gearButton, closeButton])
        headerRow.setCustomSpacing(4, after: gearButton)
        // Верхний отступ перекрывает невидимую полосу заголовка окна (~28 pt): кнопки под ней не получили бы клик.
        // Вертикальные отступы горизонтального стека AppKit игнорирует, поэтому строка лежит в вертикальной обёртке.
        headerBar = boardStack(.vertical, insets: NSEdgeInsets(top: 30, left: 14, bottom: 10, right: 8), views: [headerRow])
        titleStack.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    private func buildVoiceBar() {
        voiceCancel = FlatButton(title: "", fill: .clear, color: BoardTheme.ink2, size: 12, target: self, action: #selector(voiceCancelTapped))
        let spacer = boardSpacer()
        let row = paddedRow(spacing: 10, insets: NSEdgeInsets(top: 8, left: 12, bottom: 8, right: 8),
                             views: [voiceDot, voiceLabel, voiceHint, spacer, voiceCancel])
        row.translatesAutoresizingMaskIntoConstraints = false
        voiceBar.addSubview(row)
        pin(row, in: voiceBar)
    }

    private func buildToast() {
        toastUndo = FlatButton(title: "", fill: BoardTheme.amber.withAlphaComponent(0.25),
                               hover: BoardTheme.amber.withAlphaComponent(0.4), color: BoardTheme.amber,
                               size: 12, weight: .semibold, target: self, action: #selector(undoTapped))
        let spacer = boardSpacer()
        let head = boardStack(.horizontal, spacing: 8, views: [toastHead, spacer, toastUndo])
        let col = boardStack(.vertical, spacing: 6, insets: NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12),
                             views: [head, toastName, toastChips, toastHeard])
        col.translatesAutoresizingMaskIntoConstraints = false
        toastBox.addSubview(col)
        pin(col, in: toastBox)
    }

    private func buildForm() {
        for f in [formTitle, formDescription] {
            f.translatesAutoresizingMaskIntoConstraints = false
            f.font = BoardTheme.font(13)
            f.isBezeled = true
            f.bezelStyle = .roundedBezel
            f.focusRingType = .none
            f.target = self
            f.action = #selector(formCreateTapped)
            f.lineBreakMode = .byTruncatingTail
        }
        formCountry.translatesAutoresizingMaskIntoConstraints = false
        formCountry.font = BoardTheme.font(12.5)
        formDue.translatesAutoresizingMaskIntoConstraints = false
        formDue.datePickerStyle = .textFieldAndStepper
        formDue.datePickerElements = .yearMonthDay
        formDue.font = BoardTheme.font(12.5)
        formCreate = FlatButton(title: "", fill: BoardTheme.amber, hover: BoardTheme.amber.withAlphaComponent(0.85),
                                color: BoardTheme.amberInk, size: 12.5, weight: .semibold, radius: 8,
                                target: self, action: #selector(formCreateTapped))
        formCancel = FlatButton(title: "", target: self, action: #selector(formCancelTapped))
        let spacer = boardSpacer()
        let pickers = boardStack(.horizontal, spacing: 8, views: [formCountryLabel, formCountry, formDueLabel, formDue, boardSpacer()])
        let actions = boardStack(.horizontal, spacing: 8, views: [formError, spacer, formCancel, formCreate])
        let col = boardStack(.vertical, spacing: 8, insets: NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12),
                             views: [formTitle, formDescription, pickers, actions])
        col.translatesAutoresizingMaskIntoConstraints = false
        formBox.addSubview(col)
        pin(col, in: formBox)
    }

    private func buildColumns() {
        let tHead = paddedRow(spacing: 8, insets: NSEdgeInsets(top: 10, left: 14, bottom: 6, right: 14),
                               views: [tasksHeader, tasksCount])
        tasksCol.addArrangedSubview(tHead); tasksCol.addArrangedSubview(taskRows)
        let mHead = paddedRow(spacing: 8, insets: NSEdgeInsets(top: 10, left: 14, bottom: 6, right: 14),
                               views: [meetingsHeader, meetingsCount])
        meetingsCol.addArrangedSubview(mHead); meetingsCol.addArrangedSubview(meetingRows)
        meetingsWidth = meetingsCol.widthAnchor.constraint(equalToConstant: 240)
        meetingsWidth.isActive = true
        tasksCol.setContentHuggingPriority(.defaultLow, for: .horizontal)
        columns.alignment = .top
        for v in [tasksCol, columnsDivider, meetingsCol] { columns.addArrangedSubview(v) }
        for v in [tasksCol, meetingsCol] as [NSView] { v.setContentHuggingPriority(.defaultLow, for: .vertical) }
        tasksCol.setHuggingPriority(.defaultLow, for: .vertical)
        let minHeight = columns.heightAnchor.constraint(greaterThanOrEqualToConstant: 80)
        minHeight.priority = .defaultHigh
        minHeight.isActive = true
        columnsDivider.heightAnchor.constraint(equalTo: columns.heightAnchor).isActive = true
    }

    private func pin(_ v: NSView, in container: NSView) {
        NSLayoutConstraint.activate([
            v.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            v.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            v.topAnchor.constraint(equalTo: container.topAnchor),
            v.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }

    // MARK: отрисовка

    func render(_ s: BoardViewState) {
        state = s
        lang = s.lang
        notepad.lang = s.lang
        notepad.setHeight(CGFloat(s.config.notesHeight))
        func t(_ k: String) -> String { BoardL10n.text(k, lang: s.lang) }

        titleLabel.stringValue = t("board.title")
        dateLabel.stringValue = BoardDay.headerDate(now: s.now, lang: s.lang)
        offlineLabel.stringValue = s.offline ? "· " + t("board.offline") : ""
        let hint = s.hotKeyHint ? "  ⌃⌥Space" : ""
        micButton.setTitle("🎙 " + t("voice.button") + hint, color: BoardTheme.amberInk, size: 12.5, weight: .semibold)
        manualButton.setTitle("＋ " + t("manual.button"), color: BoardTheme.ink)
        closeButton.toolTip = t("board.close")

        messageLabel.stringValue = s.message ?? ""
        messageRow.isHidden = s.message == nil

        renderVoice(s)
        renderToast(s)
        renderForm(s)
        renderTasks(s)
        renderMeetings(s)

        meetingsWidth.constant = CGFloat(s.config.meetingsWidth)
        meetingsCol.isHidden = !s.showMeetings
        columnsDivider.isHidden = !s.showMeetings
        fit()
    }

    private func renderVoice(_ s: BoardViewState) {
        func t(_ k: String) -> String { BoardL10n.text(k, lang: s.lang) }
        switch s.voice {
        case .idle:
            voiceWrap.isHidden = true
            voiceDot.setPulsing(false)
        case .recording(let sec):
            voiceWrap.isHidden = false
            voiceLabel.stringValue = t("voice.recording") + String(format: "  %d:%02d", sec / 60, sec % 60)
            voiceHint.stringValue = t("voice.hint")
            voiceHint.isHidden = false
            voiceCancel.setTitle(t("voice.cancel"), color: BoardTheme.ink2, size: 12)
            voiceCancel.isHidden = false
            voiceDot.layer?.backgroundColor = BoardTheme.rec.cgColor
            voiceDot.setPulsing(true)
        case .sending:
            voiceWrap.isHidden = false
            voiceLabel.stringValue = t("voice.sending")
            voiceHint.isHidden = true
            voiceCancel.isHidden = true
            voiceDot.layer?.backgroundColor = BoardTheme.amber.cgColor
            voiceDot.setPulsing(true)
        }
    }

    private func renderToast(_ s: BoardViewState) {
        guard let toast = s.toast else { toastWrap.isHidden = true; return }
        toastWrap.isHidden = false
        func t(_ k: String) -> String { BoardL10n.text(k, lang: s.lang) }
        switch toast.kind {
        case .message(let text):
            toastHead.stringValue = text
            toastName.isHidden = true; toastChips.isHidden = true; toastHeard.isHidden = true; toastUndo.isHidden = true
        case .created(let task, let undoLeft):
            toastHead.stringValue = t("card.created")
            toastName.stringValue = task.title
            toastName.isHidden = false
            for v in toastChips.arrangedSubviews { toastChips.removeArrangedSubview(v); v.removeFromSuperview() }
            if let c = task.country, !c.isEmpty { toastChips.addArrangedSubview(chip(BoardCountries.name(c, lang: s.lang))) }
            if let d = task.dueDate { toastChips.addArrangedSubview(chip(BoardDay.dueLabel(d, today: s.today, lang: s.lang))) }
            let hasChips = !toastChips.arrangedSubviews.isEmpty
            if hasChips { toastChips.addArrangedSubview(boardSpacer()) }
            toastChips.isHidden = !hasChips
            if let heard = task.heard, !heard.isEmpty {
                toastHeard.stringValue = BoardL10n.format("card.heard", lang: s.lang, heard)
                toastHeard.toolTip = heard
                toastHeard.isHidden = false
            } else { toastHeard.isHidden = true }
            if let undoLeft {
                toastUndo.setTitle(BoardL10n.format("card.undo", lang: s.lang, undoLeft), color: BoardTheme.amber, size: 12, weight: .semibold)
                toastUndo.isHidden = false
            } else { toastUndo.isHidden = true }
        }
    }

    private func chip(_ text: String) -> NSView {
        let l = boardLabel(text, size: 11.5, color: BoardTheme.ink2)
        let box = BoxView(fill: NSColor(white: 1, alpha: 0.08), radius: 6)
        box.addSubview(l)
        NSLayoutConstraint.activate([
            l.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 7),
            l.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -7),
            l.topAnchor.constraint(equalTo: box.topAnchor, constant: 2),
            l.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -2),
        ])
        return box
    }

    private func renderForm(_ s: BoardViewState) {
        guard let form = s.form else { formWrap.isHidden = true; return }
        func t(_ k: String) -> String { BoardL10n.text(k, lang: s.lang) }
        let wasHidden = formWrap.isHidden
        formWrap.isHidden = false
        formTitle.placeholderString = t("form.title")
        formDescription.placeholderString = t("form.description")
        formCountryLabel.stringValue = t("form.country")
        formDueLabel.stringValue = t("form.due")
        formCreate.setTitle(t("form.create"), color: BoardTheme.amberInk, size: 12.5, weight: .semibold)
        formCancel.setTitle(t("form.cancel"), color: BoardTheme.ink)
        formError.stringValue = form.error ?? ""
        formError.isHidden = form.error == nil
        formCreate.isEnabled = !form.busy
        formTitle.isEnabled = !form.busy; formDescription.isEnabled = !form.busy
        if wasHidden || formMarkets != form.markets {
            let keep = formCountry.selectedItem?.representedObject as? String
            formMarkets = form.markets
            formCountry.removeAllItems()
            formCountry.addItem(withTitle: t("form.country.none"))
            for code in form.markets {
                formCountry.addItem(withTitle: BoardCountries.name(code, lang: s.lang))
                formCountry.lastItem?.representedObject = code
            }
            if let keep, let i = formCountry.itemArray.firstIndex(where: { ($0.representedObject as? String) == keep }) {
                formCountry.selectItem(at: i)
            }
        }
        if wasHidden {
            formTitle.stringValue = ""; formDescription.stringValue = ""
            formCountry.selectItem(at: 0)
            formDue.dateValue = BoardDay.date(from: BoardDay.tomorrow()) ?? Date()
        }
    }

    private func renderTasks(_ s: BoardViewState) {
        func t(_ k: String) -> String { BoardL10n.text(k, lang: s.lang) }
        tasksHeader.stringValue = t("tasks.header").uppercased()
        tasksCount.stringValue = s.loaded ? " \(s.tasksTotal) " : ""
        for v in taskRows.arrangedSubviews { taskRows.removeArrangedSubview(v); v.removeFromSuperview() }
        let cut = BoardList.trim(s.tasks, rows: s.config.taskRows, total: s.tasksTotal)
        for task in cut.visible {
            taskRows.addArrangedSubview(taskRow(task, struck: s.struck.contains(task.id)))
        }
        if s.loaded, cut.visible.isEmpty {
            let box = boardStack(.vertical, insets: NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14),
                                 views: [boardLabel(t("tasks.empty"), size: 14, weight: .semibold)])
            taskRows.addArrangedSubview(box)
        }
        if cut.more > 0 {
            let more = FlatButton(title: "", fill: .clear, color: BoardTheme.ink2, size: 12, radius: 6,
                                  target: self, action: #selector(moreTapped))
            more.setTitle(BoardL10n.format("tasks.more", lang: s.lang, cut.more), color: BoardTheme.ink2, size: 12)
            let wrap = paddedRow(insets: NSEdgeInsets(top: 4, left: 8, bottom: 6, right: 8), views: [more, boardSpacer()])
            taskRows.addArrangedSubview(wrap)
        }
    }

    private func taskRow(_ task: BoardTask, struck: Bool) -> NSView {
        let check = CheckBoxButton(target: self, action: #selector(checkTapped(_:)))
        check.identifier = NSUserInterfaceItemIdentifier(task.id)
        check.isStruck = struck
        let label = boardLabel("", size: 13, color: struck ? BoardTheme.ink3 : BoardTheme.ink)
        label.attributedStringValue = NSAttributedString(string: task.title, attributes: [
            .font: BoardTheme.font(13),
            .foregroundColor: struck ? BoardTheme.ink3 : BoardTheme.ink,
            .strikethroughStyle: struck ? NSUnderlineStyle.single.rawValue : 0,
        ])
        label.toolTip = task.title
        let row = boardStack(.horizontal, spacing: 10, insets: NSEdgeInsets(top: 0, left: 14, bottom: 0, right: 14),
                             views: [check, label])
        row.heightAnchor.constraint(equalToConstant: Self.rowHeight).isActive = true
        return row
    }

    private func renderMeetings(_ s: BoardViewState) {
        func t(_ k: String) -> String { BoardL10n.text(k, lang: s.lang) }
        meetingsHeader.stringValue = t("meetings.header").uppercased()
        meetingsCount.stringValue = s.loaded && s.meetingsReason == nil ? " \(s.meetings.count) " : ""
        for v in meetingRows.arrangedSubviews { meetingRows.removeArrangedSubview(v); v.removeFromSuperview() }
        guard s.loaded else { return }
        if let reason = s.meetingsReason {
            let key = BoardL10n.dictionaries[BoardL10n.fallbackLanguage]?["meetings.reason.\(reason)"] != nil
                ? "meetings.reason.\(reason)" : "meetings.reason.calendar_error"
            let l = boardLabel(t(key), size: 12, color: BoardTheme.ink2)
            wrap(l, width: CGFloat(s.config.meetingsWidth) - 28)
            meetingRows.addArrangedSubview(boardStack(.vertical, insets: NSEdgeInsets(top: 6, left: 14, bottom: 10, right: 14), views: [l]))
            return
        }
        if s.meetings.isEmpty {
            meetingRows.addArrangedSubview(boardStack(.vertical, insets: NSEdgeInsets(top: 6, left: 14, bottom: 10, right: 14),
                                                      views: [boardLabel(t("meetings.empty"), size: 12, color: BoardTheme.ink2)]))
            return
        }
        let highlight = BoardList.highlightedMeetingID(s.meetings, now: s.now)
        for m in s.meetings {
            meetingRows.addArrangedSubview(meetingRow(m, highlighted: m.id == highlight,
                                                      past: BoardList.isPast(m, now: s.now)))
        }
    }

    private func wrap(_ l: NSTextField, width: CGFloat) {
        l.maximumNumberOfLines = 0
        l.lineBreakMode = .byWordWrapping
        l.preferredMaxLayoutWidth = max(width, 80)
    }

    private func meetingRow(_ m: BoardMeeting, highlighted: Bool, past: Bool) -> NSView {
        let timeText: String
        if let d = m.start {
            let f = DateFormatter()
            f.locale = Locale(identifier: lang)
            f.dateFormat = "HH:mm"
            timeText = f.string(from: d)
        } else { timeText = "--:--" }
        let time = boardLabel(timeText, size: 12, color: highlighted ? BoardTheme.amber : BoardTheme.ink2, mono: true).hugText()
        time.setContentCompressionResistancePriority(.required, for: .horizontal)
        let title = boardLabel(m.title?.isEmpty == false ? m.title! : BoardL10n.text("meetings.untitled", lang: lang),
                               size: 13, color: highlighted ? BoardTheme.amber : BoardTheme.ink)
        title.toolTip = title.stringValue
        let textCol = NSStackView(views: [title])   // не FillStack: кнопка «Подключиться» остаётся по размеру текста
        textCol.orientation = .vertical
        textCol.spacing = 3
        textCol.alignment = .leading
        textCol.translatesAutoresizingMaskIntoConstraints = false
        if highlighted, let url = m.joinURL, !url.isEmpty {
            let join = FlatButton(title: "", fill: BoardTheme.amber, hover: BoardTheme.amber.withAlphaComponent(0.85),
                                  color: BoardTheme.amberInk, size: 11, weight: .semibold, radius: 6,
                                  target: self, action: #selector(joinTapped(_:)))
            join.setTitle(BoardL10n.text("meetings.join", lang: lang), color: BoardTheme.amberInk, size: 11, weight: .semibold)
            join.identifier = NSUserInterfaceItemIdentifier(url)
            textCol.addArrangedSubview(join)
        }
        let row = paddedRow(spacing: 8, insets: NSEdgeInsets(top: 5, left: 14, bottom: 5, right: 12),
                            alignment: .top, views: [time, textCol])
        row.alphaValue = past ? 0.45 : 1
        return row
    }

    // MARK: действия

    @objc private func micTapped() { onVoiceToggle?() }
    @objc private func manualTapped() { onManualOpen?() }
    @objc private func closeTapped() { onClose?() }
    @objc private func voiceCancelTapped() { onVoiceCancel?() }
    @objc private func undoTapped() { onUndo?() }
    @objc private func moreTapped() { onOpenMore?() }
    @objc private func formCancelTapped() { onFormCancel?() }

    @objc private func checkTapped(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        onToggleTask?(id)
    }

    @objc private func joinTapped(_ sender: NSButton) {
        guard let url = sender.identifier?.rawValue else { return }
        onJoin?(url)
    }

    @objc private func formCreateTapped() {
        let title = formTitle.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            formError.stringValue = BoardL10n.text("form.err.title", lang: lang)
            formError.isHidden = false
            window.makeFirstResponder(formTitle)
            return
        }
        let country = formCountry.selectedItem?.representedObject as? String
        onFormSubmit?(title, formDescription.stringValue, country, BoardDay.ymd(formDue.dateValue))
    }

    @objc private func gearTapped() {
        let menu = NSMenu()
        let item = NSMenuItem(title: BoardL10n.text("settings.meetings", lang: lang), action: #selector(meetingsToggled), keyEquivalent: "")
        item.target = self
        item.state = (state?.showMeetings ?? true) ? .on : .off
        menu.addItem(item)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: gearButton.bounds.height + 2), in: gearButton)
    }

    @objc private func meetingsToggled() { onMeetingsToggle?(!(state?.showMeetings ?? true)) }
}
