import AppKit
import RecorderKit

// Плавающая панель рекордера поверх всех окон. Два облика:
//   • запись / обработка → узкая ВЕРТИКАЛЬНАЯ капсула без текста (72×110):
//       ✕ (стоп) / 🎙 (красный, пульсирует) + полосы уровня / марка «Рой»;
//   • встреча или звонок → БАННЕР (см. buildBanner): янтарная полоска · название ·
//       время слота с обратным счётом · «Подключиться» + «Записать» · ✕ в правом верхнем углу.
//
// Размер меняется вместе с обликом (currentSize), место считает RecorderKit/WidgetPlacement:
// куда перетащили — там и появляется, иначе правый край ниже полосы управления.
// Баннер — решение владельца 02.09.2026, docs/decisions/2026-09-02-pill-and-join-button.md.
final class RecorderWidget {
    var onStop: (() -> Void)?
    var onRecord: (() -> Void)?
    // «Подключиться» на баннере встречи — открыть звонок И включить запись (референс Granola).
    var onJoin: (() -> Void)?
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
    /// Фактическая рамка окна на экране — только для чтения. Нужна режиму
    /// `--selftest-widget`: положение виджета иначе проверяется глазами по скриншоту,
    /// а «кажется, стало выше» — не проверка (правка дефолта 03.09.2026).
    var currentFrame: CGRect? { panel?.frame }
    /// Поставить КОНКРЕТНЫЙ кадр переливания и заморозить его (режим самопроверки: снять
    /// крайние фазы). Без замка тик уровней через 0.2 с снова включил бы анимацию и
    /// перекрыл кадр — на этом и попался первый замер.
    func previewShimmer(frame: Int) {
        stopShimmer()
        shimmerFrozen = true
        recMark.image = Self.shimmerImages[min(max(frame, 0), Self.shimmerFrames - 1)]
    }
    /// Идёт ли переливание значка (IdleShimmer) — для того же режима самопроверки:
    /// «мигает или нет» по скриншоту не определить, а по флагу и шагу — определить.
    var shimmerState: (active: Bool, step: Int) { (shimmerTimer != nil, shimmerStep) }
    /// Прозрачность содержимого окна: ловит регресс, когда fade при смене режима не доехал
    /// до 1 и капсула осталась полупрозрачной.
    var contentAlpha: CGFloat { panel?.contentView?.alphaValue ?? -1 }
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
    // Узкая вертикальная капсула (запись / обработка) — размер проверен временем.
    private static let pillSize = CGSize(width: 72, height: 110)
    // Баннер встречи шире: в нём название, время слота и кнопки. Ширину берём по контенту,
    // а не числом из головы — длинные названия и локали иначе обрезаются по-разному.
    private static let bannerMinSize = CGSize(width: 300, height: 84)
    // Куда человек перетащил капсулу. UI-состояние, поэтому UserDefaults, а не config.json.
    private static let originKey = "widget.origin"

    private var levelTimer: Timer?
    private var lastLevel: CGFloat = 0
    private var lastSysLevel: CGFloat = 0
    // Переливание значка в простое (IdleShimmer). Кадры считаем ОДИН раз: перерисовывать
    // марку 12 раз в секунду ради смены цвета — пустая работа для CPU в фоне.
    private var shimmerTimer: Timer?
    private var shimmerStep = 0
    /// Замок для `previewShimmer` (только режим самопроверки): автоматика не трогает кадр.
    private var shimmerFrozen = false
    private var silentTicks = 0
    private static let shimmerFrames = 10
    private static let shimmerFPS: TimeInterval = 1.0 / 12
    private static let shimmerImages: [NSImage] = (0..<shimmerFrames).map { i in
        let t = IdleShimmer.phase(step: i, frames: shimmerFrames)
        // Жёлто-чёрная волна, как полосы на шмеле (просьба владельца: «чтоб переливалась
        // желтым/черным»): шмель идёт от янтаря к тёмному графиту, подложка — навстречу,
        // от графита к тёплому. Двустороннее движение заметно на значке 24 пт, где одного
        // изменения цвета глифа почти не видно — проверено замером (разброс был 5 единиц).
        let glyph = RoyArt.amber.blended(withFraction: t * 0.85, of: RoyArt.graphite) ?? RoyArt.amber
        let plate = RoyArt.graphite.blended(withFraction: t * 0.35, of: RoyArt.amber) ?? RoyArt.graphite
        return RoyArt.markImage(size: 24, glyphColor: glyph, plate: plate)
    }

    // Баннер встречи (состояние «встреча — записать?»): название, время слота, две кнопки.
    // Решение владельца 02.09.2026 (#193): «лаконичнее, аккуратнее, мягче + кнопка перехода
    // на встречу». Референс — баннер Granola.
    private let bannerAccent = NSView()
    private let bannerTitle = NSTextField(labelWithString: "")
    private let bannerSubtitle = NSTextField(labelWithString: "")
    private let bannerJoin = NSButton()
    private let bannerRecord = NSButton()
    private let bannerClose = NSButton()
    private let bannerButtons = NSStackView()
    private let bannerColumn = NSStackView()
    private let bannerRow = NSStackView()

    // Состояние «в обработке»: ✕ (убрать) сверху → крутилка / зелёная галка → марка «Рой».
    private let procMark = NSImageView()
    private let procDismissBtn = NSButton()
    private let procSpinner = NSProgressIndicator()
    private let procCheck = NSImageView()
    private let procRow = NSStackView()

    func showRecording(startedAt: Date) {
        ensurePanel()
        recRow.isHidden = false
        bannerRow.isHidden = true
        bannerClose.isHidden = true
        hideProcessingRow()
        startPulse()
        startLevelMeter()
        present()
    }

    /// Баннер встречи. `notice` — что читает человек (RecorderKit/MeetingNotice),
    /// `canJoin` — есть ли ссылка на звонок (нет → кнопки «Подключиться» тоже нет).
    func showPending(notice: MeetingNotice, canJoin: Bool) {
        ensurePanel()
        stopLevelMeter()
        bannerTitle.stringValue = notice.title
        bannerTitle.toolTip = notice.title          // название целиком, если обрезалось
        bannerSubtitle.stringValue = notice.subtitle
        bannerSubtitle.isHidden = notice.subtitle.isEmpty
        bannerJoin.isHidden = !canJoin
        bannerClose.isHidden = false
        // Единственное действие обязано выглядеть главным: нет ссылки — «Записать» заливаем.
        paint(bannerRecord, filled: !canJoin)
        recRow.isHidden = true
        bannerRow.isHidden = false
        hideProcessingRow()
        present()
    }

    // Запись отправлена и обрабатывается на сервере — крутилка (без текста, как и вся капсула).
    func showProcessing() {
        ensurePanel()
        stopPulse()
        stopLevelMeter()
        recRow.isHidden = true
        bannerRow.isHidden = true
        bannerClose.isHidden = true
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
        bannerRow.isHidden = true
        bannerClose.isHidden = true
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
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: Self.pillSize),
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

        buildBanner()

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

        for row in [recRow, procRow] {
            row.translatesAutoresizingMaskIntoConstraints = false
            row.edgeInsets = NSEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
            card.addSubview(row)
            NSLayoutConstraint.activate([
                row.centerXAnchor.constraint(equalTo: card.centerXAnchor),
                row.centerYAnchor.constraint(equalTo: card.centerYAnchor)
            ])
        }
        // Баннер — текстовый блок, он читается слева направо: центрировать его нельзя,
        // иначе при коротком названии слева зияет пустота, а название «плывёт».
        bannerRow.translatesAutoresizingMaskIntoConstraints = false
        bannerRow.edgeInsets = NSEdgeInsets(top: 10, left: 14, bottom: 10, right: 12)
        card.addSubview(bannerRow)
        NSLayoutConstraint.activate([
            bannerRow.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            bannerRow.centerYAnchor.constraint(equalTo: card.centerYAnchor)
        ])
        // ✕ живёт в правом верхнем углу карточки, а не в стеке: в стеке он ездил за длиной
        // названия и при коротком прилипал к тексту.
        bannerClose.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(bannerClose)
        NSLayoutConstraint.activate([
            bannerClose.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            bannerClose.topAnchor.constraint(equalTo: card.topAnchor, constant: 12)
        ])
        p.contentView = card
        panel = p
        // Капсула таскается за фон (isMovableByWindowBackground) — ловим конец перетаскивания.
        NotificationCenter.default.addObserver(self, selector: #selector(panelDidMove),
                                               name: NSWindow.didMoveNotification, object: p)
    }

    // ── Баннер встречи ──────────────────────────────────────────────────────────
    // Название → время слота → действия. Ни одного служебного слова: вопрос «записать?»
    // раньше стоял в тексте и дублировал кнопку.
    private func buildBanner() {
        bannerAccent.wantsLayer = true
        bannerAccent.layer?.backgroundColor = RoyArt.amber.cgColor
        bannerAccent.layer?.cornerRadius = 2
        bannerAccent.translatesAutoresizingMaskIntoConstraints = false
        bannerAccent.widthAnchor.constraint(equalToConstant: 4).isActive = true
        bannerAccent.heightAnchor.constraint(equalToConstant: 62).isActive = true

        bannerTitle.font = .systemFont(ofSize: 13, weight: .semibold)
        bannerTitle.textColor = NSColor(white: 1, alpha: 0.95)
        bannerTitle.lineBreakMode = .byTruncatingTail
        bannerTitle.maximumNumberOfLines = 1
        bannerSubtitle.font = .systemFont(ofSize: 11, weight: .regular)
        bannerSubtitle.textColor = NSColor(white: 1, alpha: 0.55)
        bannerSubtitle.lineBreakMode = .byTruncatingTail
        bannerSubtitle.maximumNumberOfLines = 1
        for label in [bannerTitle, bannerSubtitle] {
            label.translatesAutoresizingMaskIntoConstraints = false
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 232).isActive = true
        }

        // Главное действие — «Подключиться»: один клик заходит в звонок И включает запись,
        // чтобы не бежать в календарь. Поэтому она залита янтарём, а «Записать» — вторичная.
        textButton(bannerJoin, title: "Подключиться", filled: true, action: #selector(joinAction))
        bannerJoin.toolTip = "Откроет звонок и включит запись"
        textButton(bannerRecord, title: "Записать", filled: false, action: #selector(recordAction))
        iconButton(bannerClose, symbol: "xmark", color: NSColor(white: 1, alpha: 0.5), action: #selector(dismissAction))
        sizeIcon(bannerClose, 11)
        bannerClose.toolTip = "Не записывать эту встречу"

        bannerButtons.orientation = .horizontal
        bannerButtons.spacing = 6
        bannerButtons.alignment = .centerY
        bannerButtons.setViews([bannerJoin, bannerRecord], in: .leading)

        bannerColumn.orientation = .vertical
        bannerColumn.spacing = 4
        bannerColumn.alignment = .leading
        bannerColumn.setViews([bannerTitle, bannerSubtitle, bannerButtons], in: .top)

        bannerRow.orientation = .horizontal
        bannerRow.spacing = 10
        bannerRow.alignment = .top
        bannerRow.setViews([bannerAccent, bannerColumn], in: .leading)
        bannerRow.isHidden = true
    }

    // Кнопка с подписью: мягкая, скруглённая, без системной рамки.
    private func textButton(_ b: NSButton, title: String, filled: Bool, action: Selector) {
        b.title = title
        b.font = .systemFont(ofSize: 11, weight: .medium)
        b.isBordered = false
        b.bezelStyle = .regularSquare
        b.wantsLayer = true
        b.layer?.cornerRadius = 7
        paint(b, filled: filled)
        b.target = self
        b.action = action
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 24).isActive = true
        // Ширина = подпись + воздух по бокам. У кнопки без рамки нет своих отступов,
        // и текст иначе упирается прямо в скругление.
        let textWidth = (title as NSString).size(withAttributes: [.font: b.font ?? .systemFont(ofSize: 11)]).width
        b.widthAnchor.constraint(equalToConstant: ceil(textWidth) + 22).isActive = true
    }

    // Главное действие — янтарная заливка, вторичное — приглушённая подложка.
    private func paint(_ b: NSButton, filled: Bool) {
        b.contentTintColor = filled ? NSColor(srgbRed: 0.10, green: 0.08, blue: 0.05, alpha: 1)
                                    : NSColor(white: 1, alpha: 0.85)
        b.layer?.backgroundColor = filled ? RoyArt.amber.cgColor : NSColor(white: 1, alpha: 0.10).cgColor
    }

    @objc private func joinAction() { onJoin?() }

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

    // Длительность перехода между режимами. 0.22 с — окно успевает «вытечь», но не тормозит
    // реакцию на действие человека (кнопка «Записать» → капсула).
    private static let morphDuration: TimeInterval = 0.22

    private func present() {
        guard let p = panel, let screen = NSScreen.main else { return }
        let size = currentSize()
        if !p.isVisible {
            // Куда перетащили — там и появляется; кто не таскал — по дефолту WidgetPlacement.
            let saved = Self.savedOrigin()
            let origin = WidgetPlacement.origin(saved: saved, size: size, in: screen.visibleFrame)
            p.setFrame(NSRect(origin: origin, size: size), display: true)
        } else if p.frame.size != size {
            // Смена режима (баннер встречи ↔ капсула записи): окно ОДНО и то же, поэтому
            // не прыгаем на новую позицию, а плавно меняем ширину/высоту от правого-верхнего
            // угла — уведомление буквально вытекает из капсулы (просьба владельца 03.09.2026).
            let target = NSRect(origin: WidgetPlacement.morphOrigin(from: p.frame, to: size, in: screen.visibleFrame),
                                size: size)
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = Self.morphDuration
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                p.animator().setFrame(target, display: true)
            }
            // Содержимое нового режима проявляем, а не подменяем мгновенно: иначе текст
            // баннера возникает раньше, чем окно под него доехало.
            fadeInContent()
        }
        p.orderFrontRegardless()
    }

    // Мягкое проявление содержимого при смене режима (0 → 1 за половину перехода).
    private func fadeInContent() {
        guard let content = panel?.contentView else { return }
        content.alphaValue = 0.35
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = Self.morphDuration / 2
            content.animator().alphaValue = 1
        }
    }

    /// Размер под текущее состояние: баннер — по своему контенту, остальное — узкая капсула.
    private func currentSize() -> CGSize {
        guard !bannerRow.isHidden else { return Self.pillSize }
        let fit = bannerRow.fittingSize
        return CGSize(width: max(Self.bannerMinSize.width, fit.width + 20),
                      height: max(Self.bannerMinSize.height, fit.height + 20))
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
        silentTicks = 0
        stopShimmer()
        applyLevel(0, to: levelFill)
        applyLevel(0, to: sysLevelFill)
    }

    // Переливание: включается тишиной, гаснет первым же звуком (IdleShimmer).
    private func updateShimmer() {
        guard !shimmerFrozen else { return }
        let quiet = lastLevel < IdleShimmer.silenceLevel && lastSysLevel < IdleShimmer.silenceLevel
        silentTicks = quiet ? silentTicks + 1 : 0
        let want = IdleShimmer.shouldShimmer(micLevel: lastLevel, systemLevel: lastSysLevel, silentTicks: silentTicks)
        if want { startShimmer() } else { stopShimmer() }
    }

    private func startShimmer() {
        guard shimmerTimer == nil else { return }
        let t = Timer.scheduledTimer(timeInterval: Self.shimmerFPS, target: self,
                                     selector: #selector(tickShimmer), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        shimmerTimer = t
    }

    private func stopShimmer() {
        guard shimmerTimer != nil else { return }
        shimmerTimer?.invalidate()
        shimmerTimer = nil
        shimmerStep = 0
        recMark.image = RoyArt.markImage(size: 24)   // вернуть обычный белый шмель
    }

    @objc private func tickShimmer() {
        shimmerStep += 1
        // Кадр выбираем ЧЕРЕЗ протестированную фазу (IdleShimmer.phase), а не своей
        // арифметикой по модулю: именно в ней легко перепутать край цикла и получить рывок.
        let t = IdleShimmer.phase(step: shimmerStep, frames: Self.shimmerFrames)
        let idx = Int((t * CGFloat(Self.shimmerFrames - 1)).rounded())
        recMark.image = Self.shimmerImages[min(max(idx, 0), Self.shimmerFrames - 1)]
    }

    @objc private func tickLevel() {
        // Сглаживаем обе полосы: быстрый рост, плавный спад — не «прыгают».
        let rawMic = CGFloat(max(0, min(1, levelProvider?() ?? 0)))
        lastLevel = rawMic > lastLevel ? rawMic : lastLevel * 0.6 + rawMic * 0.4
        applyLevel(lastLevel, to: levelFill)

        let rawSys = CGFloat(max(0, min(1, systemLevelProvider?() ?? 0)))
        lastSysLevel = rawSys > lastSysLevel ? rawSys : lastSysLevel * 0.6 + rawSys * 0.4
        applyLevel(lastSysLevel, to: sysLevelFill)

        updateShimmer()
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
