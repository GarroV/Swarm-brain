import AppKit

// Минимальная плавающая капсула: марка «Рой» + центральная иконка + ✕. Без текста.
//   • запись  → 🎙 (красный, пульсирует) индикатор, ✕ = остановить;
//   • встреча → ▶ (янтарный) = записать, ✕ = не сейчас.
// Тёмная пилюля поверх всех окон, правый верх (ниже уведомлений), перетаскивается.
final class RecorderWidget {
    var onStop: (() -> Void)?
    var onRecord: (() -> Void)?
    var onDismiss: (() -> Void)?
    // Источник уровня входа 0…1 (ставит AppDelegate → recorder.currentMicLevel()).
    // Виджет сам опрашивает его таймером, пока идёт запись.
    var levelProvider: (() -> Float)?

    private var panel: NSPanel?
    private let recMark = NSImageView()
    private let micIndicator = NSImageView()
    private let stopBtn = NSButton()
    private let recRow = NSStackView()
    // Живой индикатор уровня: тонкая полоса (трек + заполнение).
    private let levelTrack = NSView()
    private let levelFill = CALayer()
    private static let levelWidth: CGFloat = 26
    private static let levelHeight: CGFloat = 4
    private var levelTimer: Timer?
    private var lastLevel: CGFloat = 0

    private let pendMark = NSImageView()
    private let playBtn = NSButton()
    private let dismissBtn = NSButton()
    private let pendRow = NSStackView()

    func showRecording(startedAt: Date) {
        ensurePanel()
        recRow.isHidden = false
        pendRow.isHidden = true
        startPulse()
        startLevelMeter()
        present()
    }

    func showPending(title: String, when: String) {
        ensurePanel()
        stopLevelMeter()
        playBtn.toolTip = title
        recRow.isHidden = true
        pendRow.isHidden = false
        present()
    }

    func hide() {
        stopPulse()
        stopLevelMeter()
        panel?.orderOut(nil)
    }

    // ── Построение ───────────────────────────────────────────────────────────────
    private func ensurePanel() {
        if panel != nil { return }
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 96, height: 36),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        p.hasShadow = true
        p.isMovableByWindowBackground = true
        p.backgroundColor = .clear
        p.appearance = NSAppearance(named: .darkAqua)

        let card = NSView()
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor(white: 0.13, alpha: 0.97).cgColor
        card.layer?.cornerRadius = 18

        configMark(recMark)
        configMark(pendMark)

        micIndicator.image = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: "запись")
        micIndicator.contentTintColor = .systemRed
        micIndicator.wantsLayer = true
        sizeIcon(micIndicator, 17)

        configLevelBar()

        iconButton(stopBtn, symbol: "xmark", color: NSColor(white: 1, alpha: 0.65), action: #selector(stopAction))
        iconButton(playBtn, symbol: "play.fill", color: RoyArt.amber, action: #selector(recordAction))
        sizeIcon(playBtn, 17)
        iconButton(dismissBtn, symbol: "xmark", color: NSColor(white: 1, alpha: 0.65), action: #selector(dismissAction))

        recRow.orientation = .horizontal
        recRow.spacing = 9
        recRow.alignment = .centerY
        recRow.setViews([recMark, micIndicator, levelTrack, stopBtn], in: .leading)

        pendRow.orientation = .horizontal
        pendRow.spacing = 9
        pendRow.alignment = .centerY
        pendRow.setViews([pendMark, playBtn, dismissBtn], in: .leading)
        pendRow.isHidden = true

        for row in [recRow, pendRow] {
            row.translatesAutoresizingMaskIntoConstraints = false
            row.edgeInsets = NSEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
            card.addSubview(row)
            NSLayoutConstraint.activate([
                row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
                row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
                row.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            ])
        }
        p.contentView = card
        panel = p
    }

    private func configMark(_ v: NSImageView) {
        v.image = RoyArt.markImage(size: 24)
        sizeIcon(v, 24)
    }

    // Тонкая полоса уровня: тёмный трек + красное заполнение (CALayer), ширина по уровню 0…1.
    private func configLevelBar() {
        let w = Self.levelWidth, h = Self.levelHeight
        levelTrack.wantsLayer = true
        levelTrack.translatesAutoresizingMaskIntoConstraints = false
        levelTrack.widthAnchor.constraint(equalToConstant: w).isActive = true
        levelTrack.heightAnchor.constraint(equalToConstant: h).isActive = true
        if let layer = levelTrack.layer {
            layer.backgroundColor = NSColor(white: 1, alpha: 0.18).cgColor
            layer.cornerRadius = h / 2
            layer.masksToBounds = true
        }
        levelFill.backgroundColor = NSColor.systemRed.cgColor
        levelFill.cornerRadius = h / 2
        levelFill.frame = CGRect(x: 0, y: 0, width: 0, height: h)
        levelTrack.layer?.addSublayer(levelFill)
    }

    private func sizeIcon(_ v: NSView, _ s: CGFloat) {
        v.translatesAutoresizingMaskIntoConstraints = false
        v.widthAnchor.constraint(equalToConstant: s).isActive = true
        v.heightAnchor.constraint(equalToConstant: s).isActive = true
    }

    private func iconButton(_ b: NSButton, symbol: String, color: NSColor, action: Selector) {
        b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        b.imagePosition = .imageOnly
        b.isBordered = false
        b.bezelStyle = .regularSquare
        b.contentTintColor = color
        b.target = self
        b.action = action
    }

    private func present() {
        guard let p = panel, let screen = NSScreen.main else { return }
        // Шире прежнего (112): в строке записи добавилась полоса уровня. Капсула авто-подгоняется
        // под содержимое через стек-вью, фиксированной ширины достаточно под самую широкую строку.
        let w: CGFloat = 140, h: CGFloat = 36
        let vf = screen.visibleFrame
        if !p.isVisible {
            // правый верх, чуть ниже области уведомлений
            p.setFrame(NSRect(x: vf.maxX - w - 18, y: vf.maxY - h - 96, width: w, height: h), display: true)
        }
        p.orderFrontRegardless()
    }

    // ── Пульс индикатора записи ─────────────────────────────────────────────────
    private func startPulse() {
        micIndicator.layer?.removeAnimation(forKey: "pulse")
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = 1.0; a.toValue = 0.3
        a.duration = 0.8; a.autoreverses = true; a.repeatCount = .infinity
        micIndicator.layer?.add(a, forKey: "pulse")
    }
    private func stopPulse() { micIndicator.layer?.removeAnimation(forKey: "pulse") }

    // ── Живой индикатор уровня входа ─────────────────────────────────────────────
    // Опрашиваем levelProvider ~10 раз/с и обновляем ширину заполнения. Лёгкое сглаживание
    // (экспоненциальное) убирает дёрганье. Таймер живёт только во время записи.
    private func startLevelMeter() {
        stopLevelMeter()
        lastLevel = 0
        let t = Timer.scheduledTimer(timeInterval: 0.1, target: self, selector: #selector(tickLevel), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        levelTimer = t
    }

    private func stopLevelMeter() {
        levelTimer?.invalidate()
        levelTimer = nil
        applyLevel(0)
    }

    @objc private func tickLevel() {
        let raw = CGFloat(max(0, min(1, levelProvider?() ?? 0)))
        // Сглаживаем: быстрый рост, плавный спад — полоса не «прыгает».
        lastLevel = raw > lastLevel ? raw : lastLevel * 0.6 + raw * 0.4
        applyLevel(lastLevel)
    }

    private func applyLevel(_ level: CGFloat) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        levelFill.frame = CGRect(x: 0, y: 0, width: Self.levelWidth * level, height: Self.levelHeight)
        CATransaction.commit()
    }

    @objc private func stopAction() { onStop?() }
    @objc private func recordAction() { onRecord?() }
    @objc private func dismissAction() { onDismiss?() }
}
