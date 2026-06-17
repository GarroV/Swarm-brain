import AppKit

// Плавающая плашка «Рой» поверх всех окон (как у Granola). Висит в правом нижнем углу,
// перетаскивается. Видна во время записи (марка + таймер + Стоп) и при детекте встречи
// (название + Записать/Не сейчас). В покое скрыта.
final class RecorderWidget {
    enum Mode {
        case hidden
        case recording
        case pending(title: String, when: String)
    }

    var onStop: (() -> Void)?
    var onRecord: (() -> Void)?
    var onDismiss: (() -> Void)?

    private var panel: NSPanel?
    private let iconView = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let subLabel = NSTextField(labelWithString: "")
    private let primaryBtn = NSButton()
    private let secondaryBtn = NSButton()
    private var timer: Timer?
    private var startedAt: Date?

    // ── Публичное API ────────────────────────────────────────────────────────────
    func showRecording(startedAt: Date) {
        self.startedAt = startedAt
        ensurePanel()
        iconView.image = RoyArt.markImage(size: 30)
        titleLabel.stringValue = "● Запись"
        titleLabel.textColor = .systemRed
        secondaryBtn.isHidden = true
        primaryBtn.isHidden = false
        style(primaryBtn, title: "Стоп", color: .systemRed, action: #selector(stopAction))
        startTimer()
        present()
    }

    func showPending(title: String, when: String) {
        stopTimer()
        ensurePanel()
        iconView.image = RoyArt.markImage(size: 30)
        titleLabel.stringValue = when.isEmpty ? "Встреча" : "Встреча \(when)"
        titleLabel.textColor = .labelColor
        subLabel.stringValue = title
        primaryBtn.isHidden = false
        secondaryBtn.isHidden = false
        style(primaryBtn, title: "Записать", color: RoyArt.amber, action: #selector(recordAction))
        style(secondaryBtn, title: "Не сейчас", color: .clear, action: #selector(dismissAction))
        present()
    }

    func hide() {
        stopTimer()
        panel?.orderOut(nil)
    }

    // ── Построение панели ─────────────────────────────────────────────────────────
    private func ensurePanel() {
        if panel != nil { return }
        let p = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 300, height: 76),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        p.hasShadow = true
        p.isMovableByWindowBackground = true
        p.backgroundColor = .clear

        let card = NSView()
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor(srgbRed: 0xF4 / 255.0, green: 0xF1 / 255.0, blue: 0xEB / 255.0, alpha: 1).cgColor
        card.layer?.cornerRadius = 16
        card.layer?.borderWidth = 1
        card.layer?.borderColor = NSColor(white: 0, alpha: 0.08).cgColor

        iconView.imageScaling = .scaleProportionallyUpOrDown
        titleLabel.font = .systemFont(ofSize: 13, weight: .bold)
        subLabel.font = .systemFont(ofSize: 11)
        subLabel.textColor = .secondaryLabelColor
        subLabel.lineBreakMode = .byTruncatingTail
        subLabel.maximumNumberOfLines = 1

        let text = NSStackView(views: [titleLabel, subLabel])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 1

        let buttons = NSStackView(views: [secondaryBtn, primaryBtn])
        buttons.orientation = .horizontal
        buttons.spacing = 6

        let row = NSStackView(views: [iconView, text, NSView(), buttons])
        row.orientation = .horizontal
        row.spacing = 10
        row.alignment = .centerY
        row.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        row.translatesAutoresizingMaskIntoConstraints = false
        iconView.setContentHuggingPriority(.required, for: .horizontal)
        iconView.widthAnchor.constraint(equalToConstant: 30).isActive = true
        iconView.heightAnchor.constraint(equalToConstant: 30).isActive = true

        card.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            row.topAnchor.constraint(equalTo: card.topAnchor),
            row.bottomAnchor.constraint(equalTo: card.bottomAnchor),
        ])
        p.contentView = card
        panel = p
    }

    private func style(_ b: NSButton, title: String, color: NSColor, action: Selector) {
        b.title = title
        b.bezelStyle = .rounded
        b.target = self
        b.action = action
        b.controlSize = .regular
        b.contentTintColor = color == .clear ? .secondaryLabelColor : color
    }

    private func present() {
        guard let p = panel, let screen = NSScreen.main else { return }
        if !p.isVisible {
            let vf = screen.visibleFrame
            let size = p.frame.size
            p.setFrameOrigin(NSPoint(x: vf.maxX - size.width - 20, y: vf.minY + 20))
        }
        p.orderFrontRegardless()
    }

    // ── Таймер ─────────────────────────────────────────────────────────────────────
    private func startTimer() {
        stopTimer()
        tick()
        let t = Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    @objc private func tick() {
        guard let s = startedAt else { return }
        let sec = Int(Date().timeIntervalSince(s))
        subLabel.stringValue = String(format: "%02d:%02d", sec / 60, sec % 60)
        subLabel.textColor = .secondaryLabelColor
    }

    @objc private func stopAction() { onStop?() }
    @objc private func recordAction() { onRecord?() }
    @objc private func dismissAction() { onDismiss?() }
}
