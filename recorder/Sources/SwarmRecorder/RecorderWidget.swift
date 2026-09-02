import AppKit
import RecorderKit

// Минимальная плавающая ВЕРТИКАЛЬНАЯ капсула. Без текста. Сверху вниз:
//   • запись  → ✕ (стоп) / 🎙 (красный, пульсирует) + полоса уровня / марка «Рой»;
//   • встреча → ✕ (не сейчас) / ▶ (янтарный, записать) / марка «Рой».
// Тёмная пилюля поверх всех окон, правый верх (ниже уведомлений), перетаскивается.
final class RecorderWidget {
    var onStop: (() -> Void)?
    var onRecord: (() -> Void)?
    var onDismiss: (() -> Void)?
    // ✕ на капсуле «в обработке» — убрать индикатор с экрана (обработка продолжится в фоне).
    var onProcessingDismiss: (() -> Void)?
    // Клик по марке «Рой» во время записи — свернуть/развернуть панель заметок (Granola-режим).
    var onToggleNotes: (() -> Void)?
    // Источник уровня входа 0…1 (ставит AppDelegate → recorder.currentMicLevel()).
    // Виджет сам опрашивает его таймером, пока идёт запись.
    var levelProvider: (() -> Float)?
    // Уровень СИСТЕМНОЙ дорожки 0…1 (собеседники/коллеги → recorder.currentSystemLevel()).
    // Рисуется второй тонкой полосой — видно, что коллег пишем живьём. Опрашивается тем же таймером.
    var systemLevelProvider: (() -> Float)?

    private var panel: NSPanel?
    private let recMark = NSImageView()
    private let micIndicator = NSImageView()
    private let stopBtn = NSButton()
    private let recRow = NSStackView()
    private let micRow = NSStackView()  // микрофон + уровень (горизонтально, внутри вертикального recRow)
    // Живые индикаторы уровня: две тонкие полосы (трек + заполнение).
    //   • mic    — красная, локальный микрофон («я»);
    //   • system — голубая, системная дорожка («собеседники/коллеги»).
    private let levelTrack = NSView()
    private let levelFill = CALayer()
    private let sysLevelTrack = NSView()
    private let sysLevelFill = CALayer()
    private let levelColumn = NSStackView()   // mic-полоса над system-полосой (вертикально)
    private static let levelWidth: CGFloat = 26
    private static let levelHeight: CGFloat = 4
    // Размер капсулы — один на создание панели и на расчёт позиции (WidgetPlacement).
    private static let panelSize = CGSize(width: 72, height: 110)
    // Куда человек перетащил капсулу. UI-состояние, поэтому UserDefaults, а не config.json.
    private static let originKey = "widget.origin"

    private var levelTimer: Timer?
    private var lastLevel: CGFloat = 0
    private var lastSysLevel: CGFloat = 0

    private let pendMark = NSImageView()
    private let playBtn = NSButton()
    private let dismissBtn = NSButton()
    private let pendRow = NSStackView()

    // Состояние «в обработке»: ✕ (убрать) сверху → крутилка / зелёная галка → марка «Рой».
    private let procMark = NSImageView()
    private let procDismissBtn = NSButton()
    private let procSpinner = NSProgressIndicator()
    private let procCheck = NSImageView()
    private let procRow = NSStackView()

    func showRecording(startedAt: Date) {
        ensurePanel()
        recRow.isHidden = false
        pendRow.isHidden = true
        hideProcessingRow()
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
        hideProcessingRow()
        present()
    }

    // Запись отправлена и обрабатывается на сервере — крутилка (без текста, как и вся капсула).
    func showProcessing() {
        ensurePanel()
        stopPulse()
        stopLevelMeter()
        recRow.isHidden = true
        pendRow.isHidden = true
        procRow.isHidden = false
        procCheck.isHidden = true
        procSpinner.isHidden = false
        procSpinner.startAnimation(nil)
        present()
    }

    // Обработка завершена — короткая зелёная галка (AppDelegate сам прячет через пару секунд).
    func showProcessingDone() {
        ensurePanel()
        stopPulse()
        stopLevelMeter()
        recRow.isHidden = true
        pendRow.isHidden = true
        procRow.isHidden = false
        procSpinner.stopAnimation(nil)
        procSpinner.isHidden = true
        procCheck.isHidden = false
        present()
    }

    func hide() {
        stopPulse()
        stopLevelMeter()
        hideProcessingRow()
        panel?.orderOut(nil)
    }

    private func hideProcessingRow() {
        procSpinner.stopAnimation(nil)
        procRow.isHidden = true
    }

    // ── Построение ───────────────────────────────────────────────────────────────
    private func ensurePanel() {
        if panel != nil { return }
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: Self.panelSize),
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
        card.layer?.backgroundColor = NSColor(srgbRed: 0.09, green: 0.075, blue: 0.05, alpha: 0.97).cgColor  // тёплый графит
        card.layer?.cornerRadius = 18
        card.layer?.borderWidth = 1
        card.layer?.borderColor = RoyArt.amber.withAlphaComponent(0.30).cgColor   // янтарная обводка (без белых углов)

        configMark(recMark)
        configMark(pendMark)
        configMark(procMark)
        // Клик по марке «Рой» во время записи → свернуть/развернуть панель заметок.
        recMark.addGestureRecognizer(NSClickGestureRecognizer(target: self, action: #selector(toggleNotesAction)))
        recMark.toolTip = "Заметки встречи (свернуть/развернуть)"

        micIndicator.image = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: "запись")
        micIndicator.contentTintColor = .systemRed
        micIndicator.wantsLayer = true
        sizeIcon(micIndicator, 17)

        configLevelBar()

        iconButton(stopBtn, symbol: "xmark", color: NSColor(white: 1, alpha: 0.65), action: #selector(stopAction))
        iconButton(playBtn, symbol: "play.fill", color: RoyArt.amber, action: #selector(recordAction))
        sizeIcon(playBtn, 17)
        iconButton(dismissBtn, symbol: "xmark", color: NSColor(white: 1, alpha: 0.65), action: #selector(dismissAction))

        // Две полосы уровня стопкой: mic (я) сверху, system (собеседники) снизу.
        levelColumn.orientation = .vertical
        levelColumn.spacing = 4
        levelColumn.alignment = .leading
        levelColumn.setViews([levelTrack, sysLevelTrack], in: .top)

        // Вертикальная капсула: ✕ сверху → 🎙 микрофон + 2 полосы уровня посередине → «Рой» снизу.
        micRow.orientation = .horizontal
        micRow.spacing = 6
        micRow.alignment = .centerY
        micRow.setViews([micIndicator, levelColumn], in: .leading)

        recRow.orientation = .vertical
        recRow.spacing = 10
        recRow.alignment = .centerX
        recRow.setViews([stopBtn, micRow, recMark], in: .top)

        // Состояние «встреча — записать?»: ✕ сверху → ▶ → иконка «Рой» снизу (та же вертикаль).
        pendRow.orientation = .vertical
        pendRow.spacing = 10
        pendRow.alignment = .centerX
        pendRow.setViews([dismissBtn, playBtn, pendMark], in: .top)
        pendRow.isHidden = true

        // Состояние «в обработке»: ✕ (убрать) сверху → крутилка / зелёная галка → марка «Рой».
        iconButton(procDismissBtn, symbol: "xmark", color: NSColor(white: 1, alpha: 0.65), action: #selector(procDismissAction))
        procSpinner.style = .spinning
        procSpinner.controlSize = .small
        procSpinner.isIndeterminate = true
        procSpinner.translatesAutoresizingMaskIntoConstraints = false
        procSpinner.widthAnchor.constraint(equalToConstant: 18).isActive = true
        procSpinner.heightAnchor.constraint(equalToConstant: 18).isActive = true
        procCheck.image = NSImage(systemSymbolName: "checkmark.circle.fill", accessibilityDescription: "готово")
        procCheck.contentTintColor = .systemGreen
        sizeIcon(procCheck, 22)
        procCheck.isHidden = true
        procRow.orientation = .vertical
        procRow.spacing = 10
        procRow.alignment = .centerX
        procRow.setViews([procDismissBtn, procSpinner, procCheck, procMark], in: .top)
        procRow.isHidden = true

        for row in [recRow, pendRow, procRow] {
            row.translatesAutoresizingMaskIntoConstraints = false
            row.edgeInsets = NSEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
            card.addSubview(row)
            NSLayoutConstraint.activate([
                row.centerXAnchor.constraint(equalTo: card.centerXAnchor),
                row.centerYAnchor.constraint(equalTo: card.centerYAnchor)
            ])
        }
        p.contentView = card
        panel = p
        // Капсула таскается за фон (isMovableByWindowBackground) — ловим конец перетаскивания.
        NotificationCenter.default.addObserver(self, selector: #selector(panelDidMove),
                                               name: NSWindow.didMoveNotification, object: p)
    }

    private func configMark(_ v: NSImageView) {
        v.image = RoyArt.markImage(size: 24)
        sizeIcon(v, 24)
    }

    // Две тонкие полосы уровня в айдентике «Роя»: mic (янтарь, «я») и system (светлый янтарь, «собеседники»).
    private func configLevelBar() {
        configOneBar(track: levelTrack, fill: levelFill, color: RoyArt.amber)
        configOneBar(track: sysLevelTrack, fill: sysLevelFill, color: NSColor(srgbRed: 0.96, green: 0.77, blue: 0.42, alpha: 1))
    }

    // Одна полоса: тёмный трек + цветное заполнение (CALayer), ширина по уровню 0…1.
    private func configOneBar(track: NSView, fill: CALayer, color: NSColor) {
        let w = Self.levelWidth, h = Self.levelHeight
        track.wantsLayer = true
        track.translatesAutoresizingMaskIntoConstraints = false
        track.widthAnchor.constraint(equalToConstant: w).isActive = true
        track.heightAnchor.constraint(equalToConstant: h).isActive = true
        if let layer = track.layer {
            layer.backgroundColor = NSColor(white: 1, alpha: 0.18).cgColor
            layer.cornerRadius = h / 2
            layer.masksToBounds = true
        }
        fill.backgroundColor = color.cgColor
        fill.cornerRadius = h / 2
        fill.frame = CGRect(x: 0, y: 0, width: 0, height: h)
        track.layer?.addSublayer(fill)
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
        if !p.isVisible {
            // Куда перетащили — там и появляется; кто не таскал — ниже полосы управления
            // веб-приложений (issue #197). Правила и границы — WidgetPlacement.
            let origin = WidgetPlacement.origin(saved: Self.savedOrigin(),
                                                size: Self.panelSize,
                                                in: screen.visibleFrame)
            p.setFrame(NSRect(origin: origin, size: Self.panelSize), display: true)
        }
        p.orderFrontRegardless()
    }

    // ── Память положения ─────────────────────────────────────────────────────────
    private static func savedOrigin() -> CGPoint? {
        guard let raw = UserDefaults.standard.string(forKey: originKey) else { return nil }
        let p = NSPointFromString(raw)
        return p == .zero ? nil : p   // .zero — и «не задано», и разбор мусора
    }

    @objc private func panelDidMove() {
        guard let p = panel, p.isVisible else { return }
        UserDefaults.standard.set(NSStringFromPoint(p.frame.origin), forKey: Self.originKey)
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
        lastSysLevel = 0
        let t = Timer.scheduledTimer(timeInterval: 0.2, target: self, selector: #selector(tickLevel), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        levelTimer = t
    }

    private func stopLevelMeter() {
        levelTimer?.invalidate()
        levelTimer = nil
        applyLevel(0, to: levelFill)
        applyLevel(0, to: sysLevelFill)
    }

    @objc private func tickLevel() {
        // Сглаживаем обе полосы: быстрый рост, плавный спад — не «прыгают».
        let rawMic = CGFloat(max(0, min(1, levelProvider?() ?? 0)))
        lastLevel = rawMic > lastLevel ? rawMic : lastLevel * 0.6 + rawMic * 0.4
        applyLevel(lastLevel, to: levelFill)

        let rawSys = CGFloat(max(0, min(1, systemLevelProvider?() ?? 0)))
        lastSysLevel = rawSys > lastSysLevel ? rawSys : lastSysLevel * 0.6 + rawSys * 0.4
        applyLevel(lastSysLevel, to: sysLevelFill)
    }

    private func applyLevel(_ level: CGFloat, to fill: CALayer) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        fill.frame = CGRect(x: 0, y: 0, width: Self.levelWidth * level, height: Self.levelHeight)
        CATransaction.commit()
    }

    @objc private func toggleNotesAction() { onToggleNotes?() }
    @objc private func stopAction() { onStop?() }
    @objc private func recordAction() { onRecord?() }
    @objc private func dismissAction() { onDismiss?() }
    @objc private func procDismissAction() { onProcessingDismiss?() }
}
