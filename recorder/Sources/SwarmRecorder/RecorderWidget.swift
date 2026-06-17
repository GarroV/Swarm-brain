import AppKit

// Минималистичная плавающая капсула (как у Granola): тёмная пилюля поверх всех окон,
// правый нижний угол, перетаскивается. Запись — марка + пульсирующая точка + таймер +
// маленький стоп. Детект встречи — марка + «Записать» / ✕. В покое скрыта.
final class RecorderWidget {
    var onStop: (() -> Void)?
    var onRecord: (() -> Void)?
    var onDismiss: (() -> Void)?

    private var panel: NSPanel?
    private let icon = NSImageView()
    private let dot = PulseDot()
    private let timeLabel = NSTextField(labelWithString: "00:00")
    private let stopBtn = NSButton()
    private let recRow = NSStackView()

    private let pendLabel = NSTextField(labelWithString: "Записать?")
    private let recordBtn = NSButton()
    private let dismissBtn = NSButton()
    private let pendRow = NSStackView()

    private var timer: Timer?
    private var startedAt: Date?

    func showRecording(startedAt: Date) {
        self.startedAt = startedAt
        ensurePanel()
        recRow.isHidden = false
        pendRow.isHidden = true
        dot.start()
        startTimer()
        present(width: 150)
    }

    func showPending(title: String, when: String) {
        stopTimer()
        dot.stop()
        ensurePanel()
        pendLabel.stringValue = when.isEmpty ? "Записать?" : "Встреча \(when)"
        pendRow.toolTip = title
        recRow.isHidden = true
        pendRow.isHidden = false
        present(width: 240)
    }

    func hide() {
        stopTimer()
        dot.stop()
        panel?.orderOut(nil)
    }

    // ── Построение ───────────────────────────────────────────────────────────────
    private func ensurePanel() {
        if panel != nil { return }
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 150, height: 38),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        p.hasShadow = true
        p.isMovableByWindowBackground = true
        p.backgroundColor = .clear

        let card = NSView()
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor(white: 0.13, alpha: 0.97).cgColor
        card.layer?.cornerRadius = 19

        icon.image = RoyArt.markImage(size: 24)
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 24).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 24).isActive = true

        // recording
        timeLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
        timeLabel.textColor = .white
        styleIconButton(stopBtn, symbol: "stop.fill", color: .systemRed, action: #selector(stopAction))
        recRow.orientation = .horizontal
        recRow.spacing = 7
        recRow.alignment = .centerY
        recRow.setViews([icon, dot, timeLabel, NSView(), stopBtn], in: .leading)

        // pending
        pendLabel.font = .systemFont(ofSize: 12.5, weight: .semibold)
        pendLabel.textColor = .white
        pendLabel.lineBreakMode = .byTruncatingTail
        pendLabel.maximumNumberOfLines = 1
        // длинное название усекаем, чтобы кнопки не вылезали за капсулу
        pendLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        stylePillButton(recordBtn, title: "Записать", action: #selector(recordAction))
        styleIconButton(dismissBtn, symbol: "xmark", color: NSColor(white: 1, alpha: 0.6), action: #selector(dismissAction))
        pendRow.orientation = .horizontal
        pendRow.spacing = 8
        pendRow.alignment = .centerY
        let pendIcon = NSImageView()
        pendIcon.image = RoyArt.markImage(size: 24)
        pendIcon.widthAnchor.constraint(equalToConstant: 24).isActive = true
        pendIcon.heightAnchor.constraint(equalToConstant: 24).isActive = true
        pendRow.setViews([pendIcon, pendLabel, NSView(), recordBtn, dismissBtn], in: .leading)
        pendRow.isHidden = true

        for row in [recRow, pendRow] {
            row.translatesAutoresizingMaskIntoConstraints = false
            row.edgeInsets = NSEdgeInsets(top: 0, left: 12, bottom: 0, right: 10)
            card.addSubview(row)
            NSLayoutConstraint.activate([
                row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
                row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
                row.topAnchor.constraint(equalTo: card.topAnchor),
                row.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            ])
        }
        p.contentView = card
        panel = p
    }

    private func styleIconButton(_ b: NSButton, symbol: String, color: NSColor, action: Selector) {
        b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        b.imagePosition = .imageOnly
        b.isBordered = false
        b.bezelStyle = .regularSquare
        b.contentTintColor = color
        b.target = self
        b.action = action
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: 22).isActive = true
    }

    private func stylePillButton(_ b: NSButton, title: String, action: Selector) {
        b.title = title
        b.font = .systemFont(ofSize: 12, weight: .semibold)
        b.bezelStyle = .rounded
        b.contentTintColor = RoyArt.amber
        b.target = self
        b.action = action
    }

    private func present(width: CGFloat) {
        guard let p = panel, let screen = NSScreen.main else { return }
        let h: CGFloat = 38
        let vf = screen.visibleFrame
        if p.isVisible {
            // сохраняем правый верхний угол при смене ширины (юзер мог перетащить)
            let f = p.frame
            p.setFrame(NSRect(x: f.maxX - width, y: f.maxY - h, width: width, height: h), display: true)
        } else {
            // правый верх, чуть ниже области уведомлений
            p.setFrame(NSRect(x: vf.maxX - width - 18, y: vf.maxY - h - 96, width: width, height: h), display: true)
        }
        p.orderFrontRegardless()
    }

    private func startTimer() {
        stopTimer(); tick()
        let t = Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
    private func stopTimer() { timer?.invalidate(); timer = nil }

    @objc private func tick() {
        guard let s = startedAt else { return }
        let sec = Int(Date().timeIntervalSince(s))
        timeLabel.stringValue = String(format: "%02d:%02d", sec / 60, sec % 60)
    }

    @objc private func stopAction() { onStop?() }
    @objc private func recordAction() { onRecord?() }
    @objc private func dismissAction() { onDismiss?() }
}

// Пульсирующая красная точка-индикатор записи.
final class PulseDot: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.systemRed.cgColor
        layer?.cornerRadius = 4
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: 8).isActive = true
        heightAnchor.constraint(equalToConstant: 8).isActive = true
    }
    required init?(coder: NSCoder) { fatalError() }

    func start() {
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = 1.0; a.toValue = 0.25
        a.duration = 0.8
        a.autoreverses = true
        a.repeatCount = .infinity
        layer?.add(a, forKey: "pulse")
    }
    func stop() { layer?.removeAnimation(forKey: "pulse") }
}
