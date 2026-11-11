import AppKit
import RecorderKit

// Собственные уведомления рекордера (решение владельца 09.11.2026,
// docs/decisions/2026-11-09-reminder-instead-of-autostart.md): вместо системных баннеров macOS
// (UNUserNotificationCenter) и модальных окон (NSAlert) — карточки в стиле капсулы: тёплый
// графит, янтарная полоска и обводка, тёмная тема всегда. Стопка карточек висит под капсулой
// (а без капсулы — на её дефолтном месте), модель стопки — RecorderKit/NoticeStack.
// Системного разрешения не нужно: это наше окно, его нельзя отключить в настройках macOS.
// Кнопка действия выполняет свой обработчик и закрывает карточку; ✕ просто закрывает.
final class RecorderNotices {
    static let shared = RecorderNotices()

    struct Action {
        let title: String
        var isPrimary = false
        let run: () -> Void
    }

    private static let cardWidth: CGFloat = 300
    private static let textWidth: CGFloat = 232
    private static let gap: CGFloat = 8
    private static let tick: TimeInterval = 1

    /// Рамка капсулы, если она на экране: карточки встают под неё. Ставит AppDelegate.
    var widgetFrame: (() -> CGRect?)?

    private var stack = NoticeStack()
    private var actions: [String: [String: Action]] = [:]
    private var panel: NSPanel?
    private let column = NSStackView()
    private var timer: Timer?

    /// Показать карточку. Тот же `id` заменяет прежнюю (повтор не плодит копий).
    /// `lifetime` nil — висит, пока не закроют: так у карточек, на которые надо отреагировать.
    func post(id: String, title: String, body: String = "",
              lifetime: TimeInterval? = NoticeStack.defaultLifetime, actions: [Action] = [],
              isVertical: Bool = false) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.post(id: id, title: title, body: body, lifetime: lifetime, actions: actions, isVertical: isVertical) }
            return
        }
        let specs = actions.enumerated().map { RecorderNotice.Action(id: String($0.offset), title: $0.element.title,
                                                                      isPrimary: $0.element.isPrimary) }
        self.actions[id] = Dictionary(uniqueKeysWithValues: actions.enumerated().map { (String($0.offset), $0.element) })
        stack.post(RecorderNotice(id: id, title: title, body: body, actions: specs, lifetime: lifetime,
                                isVertical: isVertical), now: Date())
        Diagnostics.shared.log("NOTICE «\(title)»")
        refresh()
    }

    func dismiss(id: String) {
        stack.dismiss(id: id)
        actions[id] = nil
        refresh()
    }

    /// Заголовки показанных карточек, новая первой — для самопроверки.
    var shownTitles: [String] { stack.visible.map(\.title) }

    // ── Окно ─────────────────────────────────────────────────────────────────────
    private func refresh() {
        let notices = stack.visible
        actions = actions.filter { entry in notices.contains { $0.id == entry.key } }
        guard !notices.isEmpty else {
            timer?.invalidate()
            timer = nil
            panel?.orderOut(nil)
            return
        }
        let p = ensurePanel()
        column.setViews(notices.map(card), in: .top)
        reposition(p)
        p.orderFrontRegardless()
        guard timer == nil else { return }
        let t = Timer.scheduledTimer(withTimeInterval: Self.tick, repeats: true) { [weak self] _ in self?.onTick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func onTick() {
        if stack.expire(now: Date()) { refresh() }
        else if let p = panel, p.isVisible { reposition(p) }   // капсулу могли сдвинуть или показать
    }

    private func ensurePanel() -> NSPanel {
        if let panel { return panel }
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: CGSize(width: Self.cardWidth, height: 80)),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        p.hasShadow = false   // тень у каждой карточки своя, у окна целиком — квадратная
        p.backgroundColor = .clear
        p.appearance = NSAppearance(named: .darkAqua)
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = Self.gap
        let root = NSView()
        column.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(column)
        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            column.topAnchor.constraint(equalTo: root.topAnchor)
        ])
        p.contentView = root
        panel = p
        return p
    }

    private func reposition(_ p: NSPanel) {
        guard let screen = NSScreen.main else { return }
        column.layoutSubtreeIfNeeded()
        let size = CGSize(width: Self.cardWidth, height: column.fittingSize.height)
        let visible = screen.visibleFrame
        var origin: CGPoint
        if let w = widgetFrame?() {
            origin = CGPoint(x: w.maxX - size.width, y: w.minY - Self.gap - size.height)
        } else {
            origin = WidgetPlacement.defaultOrigin(size: size, in: visible)
        }
        origin.x = min(max(origin.x, visible.minX), visible.maxX - size.width)
        origin.y = max(origin.y, visible.minY)
        p.setFrame(NSRect(origin: origin, size: size), display: true)
    }

    // ── Карточка ─────────────────────────────────────────────────────────────────
    private func card(_ n: RecorderNotice) -> NSView {
        let card = NSView()
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor(srgbRed: 0.09, green: 0.075, blue: 0.05, alpha: 0.97).cgColor   // как у капсулы
        card.layer?.cornerRadius = 18
        card.layer?.borderWidth = 1
        card.layer?.borderColor = RoyArt.amber.withAlphaComponent(0.30).cgColor
        card.layer?.shadowOpacity = 0.35
        card.layer?.shadowRadius = 8
        card.layer?.shadowOffset = CGSize(width: 0, height: -2)

        let accent = NSView()
        accent.wantsLayer = true
        accent.layer?.backgroundColor = RoyArt.amber.cgColor
        accent.layer?.cornerRadius = 2
        accent.translatesAutoresizingMaskIntoConstraints = false
        accent.widthAnchor.constraint(equalToConstant: 4).isActive = true

        let title = label(n.title, size: 13, weight: .semibold, alpha: 0.95, wrapping: true)
        var rows: [NSView] = [title]
        if !n.body.isEmpty { rows.append(label(n.body, size: 11, weight: .regular, alpha: 0.7, wrapping: true)) }
        if !n.actions.isEmpty {
            let buttons = NSStackView(views: n.actions.map { button(for: n, $0) })
            buttons.orientation = n.isVertical ? .vertical : .horizontal
            buttons.alignment = .leading
            buttons.spacing = 6
            rows.append(buttons)
        }
        let text = NSStackView(views: rows)
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 6

        let row = NSStackView(views: [accent, text])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 10
        row.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 12, right: 34)
        row.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(row)

        let close = NSButton()
        close.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: BoardL10n.text("notice.close", lang: BoardL10n.language()))
        close.imagePosition = .imageOnly
        close.isBordered = false
        close.contentTintColor = NSColor(white: 1, alpha: 0.5)
        close.identifier = NSUserInterfaceItemIdentifier(n.id)
        close.target = self
        close.action = #selector(closeTapped(_:))
        close.setAccessibilityIdentifier("notice.close.\(n.id)")
        close.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(close)

        NSLayoutConstraint.activate([
            card.widthAnchor.constraint(equalToConstant: Self.cardWidth),
            row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            row.topAnchor.constraint(equalTo: card.topAnchor),
            row.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            accent.heightAnchor.constraint(equalTo: text.heightAnchor),
            close.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            close.topAnchor.constraint(equalTo: card.topAnchor, constant: 12)
        ])
        return card
    }

    private func label(_ text: String, size: CGFloat, weight: NSFont.Weight, alpha: CGFloat, wrapping: Bool) -> NSTextField {
        let l = NSTextField(wrappingLabelWithString: text)
        l.font = .systemFont(ofSize: size, weight: weight)
        l.textColor = NSColor(white: 1, alpha: alpha)
        l.maximumNumberOfLines = 9
        l.cell?.truncatesLastVisibleLine = true
        l.isSelectable = false
        l.toolTip = text
        l.preferredMaxLayoutWidth = Self.textWidth
        l.translatesAutoresizingMaskIntoConstraints = false
        l.widthAnchor.constraint(equalToConstant: Self.textWidth).isActive = true
        return l
    }

    // Кнопки — тот же вид, что в баннере капсулы: главная залита янтарём, остальные — подложка.
    private func button(for n: RecorderNotice, _ a: RecorderNotice.Action) -> NSButton {
        let b = NSButton()
        b.title = a.title
        b.font = .systemFont(ofSize: 11, weight: .medium)
        b.isBordered = false
        b.bezelStyle = .regularSquare
        b.wantsLayer = true
        b.layer?.cornerRadius = 7
        b.contentTintColor = a.isPrimary ? NSColor(srgbRed: 0.10, green: 0.08, blue: 0.05, alpha: 1) : NSColor(white: 1, alpha: 0.85)
        b.layer?.backgroundColor = a.isPrimary ? RoyArt.amber.cgColor : NSColor(white: 1, alpha: 0.10).cgColor
        b.identifier = NSUserInterfaceItemIdentifier("\(n.id)\u{1F}\(a.id)")
        b.target = self
        b.action = #selector(actionTapped(_:))
        b.setAccessibilityIdentifier("notice.action.\(n.id).\(a.id)")
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 24).isActive = true
        let w = (a.title as NSString).size(withAttributes: [.font: b.font ?? .systemFont(ofSize: 11)]).width
        b.widthAnchor.constraint(equalToConstant: min(ceil(w) + 22, Self.textWidth)).isActive = true
        b.lineBreakMode = .byTruncatingTail
        b.toolTip = a.title
        return b
    }

    @objc private func closeTapped(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        dismiss(id: id)
    }

    @objc private func actionTapped(_ sender: NSButton) {
        let parts = (sender.identifier?.rawValue ?? "").components(separatedBy: "\u{1F}")
        guard parts.count == 2 else { return }
        let run = actions[parts[0]]?[parts[1]]?.run
        dismiss(id: parts[0])   // карточка уходит до действия: оно может показать новую с тем же id
        run?()
    }
}
