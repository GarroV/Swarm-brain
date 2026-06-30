import AppKit

/// Единое окно рекордера «Рой · заметки» (Granola-режим, Фаза 3).
/// Один морф-объект: компактная пилюля-шапка (контролы) ⇄ развёрнутый блокнот (шапка + пометки).
/// Шапка всегда: марка(toggle) · REC+таймер · полоски уровня (я/собеседники) · ✕ стоп.
/// На старте записи открыт развёрнутым; клик по марке — морф высоты. meetingId появляется на
/// стопе (claim) → пометки копятся в буфер, на стопе flush() меняет токен на web-JWT и POST'ит.
@MainActor
final class LiveNotesPanel: NSObject, NSTextFieldDelegate {
    static let shared = LiveNotesPanel()
    private override init() { super.init() }

    private var panel: NSPanel?
    private var notesSection: NSView?          // сворачиваемая часть (divider+sub+notes+input+footer)
    private var notesStack: NSStackView?
    private var input: NSTextField?
    private var titleField: NSTextField?       // редактируемое название встречи (в шапке, всегда видно)
    private var editedTitle: String?           // переопределение названия пользователем (nil → берём дефолт claim)
    private var fieldBox: NSView?
    private var timerLabel: NSTextField?
    private var micTrack: NSView?, sysTrack: NSView?
    private let micFill = CALayer(), sysFill = CALayer()
    private var timer: Timer?, levelTimer: Timer?
    private var micLevel: (() -> Float)?, sysLevel: (() -> Float)?, onStop: (() -> Void)?
    private var onCollapse: (() -> Void)?      // клик по марке в блокноте → свернуть в пилюлю (виджет)

    private struct Buffered { let offset: Int; let text: String }
    private var buffer: [Buffered] = []
    private var startedAt: Date?

    private static let panelWidth: CGFloat = 312
    private static let margin: CGFloat = 16
    private static let amber = RoyArt.amber
    private static let amberHi = NSColor(srgbRed: 0.96, green: 0.77, blue: 0.42, alpha: 1)
    private static let amberSoft = RoyArt.amber.withAlphaComponent(0.16)
    private static let ink = NSColor(srgbRed: 0.93, green: 0.90, blue: 0.83, alpha: 1)
    private static let mute = NSColor(srgbRed: 0.55, green: 0.51, blue: 0.43, alpha: 1)
    private static let line = NSColor(srgbRed: 0.91, green: 0.78, blue: 0.55, alpha: 0.13)
    private static let rec = NSColor(srgbRed: 1, green: 0.42, blue: 0.37, alpha: 1)

    /// Старт записи: сбрасываем буфер/таймстампы, показываем блокнот.
    func show(config: SwarmConfig, initialTitle: String?, micLevel: @escaping () -> Float, systemLevel: @escaping () -> Float, onStop: @escaping () -> Void, onCollapse: @escaping () -> Void) {
        self.micLevel = micLevel; self.sysLevel = systemLevel; self.onStop = onStop; self.onCollapse = onCollapse
        buffer.removeAll()
        editedTitle = nil
        startedAt = Date()
        ensurePanel()
        titleField?.stringValue = initialTitle ?? ""
        clearNotes()
        showExpanded()
    }

    /// Развернуть блокнот заново (из пилюли) — БЕЗ сброса буфера/таймстампов.
    func expand() { ensurePanel(); showExpanded() }

    private func showExpanded() {
        notesSection?.isHidden = false
        guard let panel, let screen = NSScreen.main else { return }
        let vf = screen.visibleFrame
        let h = min(vf.height - Self.margin * 2, 440)
        panel.setFrame(NSRect(x: vf.maxX - Self.panelWidth - Self.margin, y: vf.maxY - h - Self.margin,
                              width: Self.panelWidth, height: h), display: true)
        startTimers()
        panel.orderFrontRegardless()
        panel.makeFirstResponder(input)
    }

    /// Текущее переопределение названия (читается на стопе при claim). Синхронизируется со
    /// значением поля на момент вызова — даже если пользователь не нажал Enter/не ушёл с поля.
    func currentTitleOverride() -> String? {
        let t = titleField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !t.isEmpty { editedTitle = t }
        return editedTitle
    }

    func hide() { stopTimers(); panel?.orderOut(nil) }

    // Свернуть блокнот в пилюлю — по клику на марке ИЛИ когда пользователь ушёл в другую программу.
    func collapse() {
        guard panel?.isVisible == true else { return }   // уже свёрнут — не дёргаем onCollapse повторно
        stopTimers()
        panel?.orderOut(nil)
        onCollapse?()
    }
    @objc private func collapseToPill() { collapse() }

    // MARK: - сборка

    private func ensurePanel() {
        if panel != nil { return }
        let frame = NSRect(x: 0, y: 0, width: Self.panelWidth, height: 540)
        let p = NSPanel(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
                        backing: .buffered, defer: false)
        p.titleVisibility = .hidden
        p.titlebarAppearsTransparent = true
        p.isMovableByWindowBackground = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.isOpaque = false
        p.backgroundColor = .clear
        p.minSize = NSSize(width: 80, height: 80)   // titled-окно иначе не даёт ужать до узкой пилюли
        [.closeButton, .miniaturizeButton, .zoomButton].forEach { p.standardWindowButton($0)?.isHidden = true }

        // Сплошной тёмный фон (НЕ вибрэнси): сквозь блюр лез пёстрый созвон/стол. Так — чисто,
        // без просветов и без белых углов (скругление слоя + masksToBounds на непрозрачном фоне).
        let vfx = NSView(frame: frame)
        vfx.wantsLayer = true
        vfx.layer?.backgroundColor = NSColor(srgbRed: 0.075, green: 0.062, blue: 0.04, alpha: 0.98).cgColor
        vfx.layer?.cornerRadius = 16
        vfx.layer?.masksToBounds = true
        vfx.layer?.borderWidth = 1
        vfx.layer?.borderColor = RoyArt.amber.withAlphaComponent(0.20).cgColor

        // ── шапка (всегда видна) ──
        let mark = NSImageView(image: RoyArt.markImage(size: 17))
        mark.toolTip = "Свернуть в пилюлю"
        mark.addGestureRecognizer(NSClickGestureRecognizer(target: self, action: #selector(collapseToPill)))
        mark.setContentHuggingPriority(.required, for: .horizontal)

        let dot = NSView(); dot.wantsLayer = true
        dot.layer?.backgroundColor = Self.rec.cgColor; dot.layer?.cornerRadius = 4
        dot.layer?.shadowColor = Self.rec.cgColor; dot.layer?.shadowRadius = 4; dot.layer?.shadowOpacity = 0.8; dot.layer?.shadowOffset = .zero
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.widthAnchor.constraint(equalToConstant: 8).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 8).isActive = true
        let pulse = CABasicAnimation(keyPath: "opacity"); pulse.fromValue = 1; pulse.toValue = 0.25
        pulse.duration = 0.85; pulse.autoreverses = true; pulse.repeatCount = .infinity
        dot.layer?.add(pulse, forKey: "pulse")
        let timerLbl = NSTextField(labelWithString: "00:00")
        timerLbl.font = .monospacedSystemFont(ofSize: 12, weight: .semibold); timerLbl.textColor = Self.ink
        timerLbl.setContentHuggingPriority(.required, for: .horizontal)
        timerLabel = timerLbl
        let recGroup = NSStackView(views: [dot, timerLbl]); recGroup.spacing = 6; recGroup.alignment = .centerY
        recGroup.setContentHuggingPriority(.required, for: .horizontal)

        micTrack = levelTrack(micFill, color: Self.amber)
        sysTrack = levelTrack(sysFill, color: Self.amberHi)
        let levels = NSStackView(views: [micTrack!, sysTrack!]); levels.orientation = .vertical
        levels.spacing = 3; levels.alignment = .leading; levels.distribution = .fillEqually
        levels.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let stop = NSButton(); stop.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "стоп")
        stop.imagePosition = .imageOnly; stop.isBordered = false; stop.bezelStyle = .regularSquare
        stop.contentTintColor = Self.mute; stop.toolTip = "Остановить и отправить"
        stop.target = self; stop.action = #selector(stopTapped)
        stop.setContentHuggingPriority(.required, for: .horizontal)

        let header = NSStackView(views: [mark, recGroup, levels, stop])
        header.orientation = .horizontal; header.alignment = .centerY; header.spacing = 9
        header.translatesAutoresizingMaskIntoConstraints = false

        // ── строка названия встречи (всегда видна, в т.ч. свёрнутой; правка на ходу → в claim) ──
        let tag = iconView("tag", size: 11, color: Self.amber)
        let titleFld = NSTextField()
        titleFld.placeholderString = "Название встречи…"
        titleFld.font = .systemFont(ofSize: 13, weight: .medium); titleFld.textColor = Self.ink
        titleFld.isBordered = false; titleFld.drawsBackground = false; titleFld.focusRingType = .none
        titleFld.lineBreakMode = .byTruncatingTail; titleFld.cell?.isScrollable = true
        titleFld.usesSingleLineMode = true
        titleFld.delegate = self; titleFld.target = self; titleFld.action = #selector(commitTitle)
        titleFld.setContentHuggingPriority(.defaultLow, for: .horizontal)
        titleFld.toolTip = "Название встречи — можно править на ходу, уйдёт в систему на стопе"
        titleField = titleFld
        let titleRow = NSStackView(views: [tag, titleFld])
        titleRow.orientation = .horizontal; titleRow.alignment = .centerY; titleRow.spacing = 7
        titleRow.translatesAutoresizingMaskIntoConstraints = false

        // ── сворачиваемая часть ──
        let divider = NSBox(); divider.boxType = .separator; divider.translatesAutoresizingMaskIntoConstraints = false
        let sub = NSTextField(labelWithString: "пиши по ходу — лягут к встрече по времени")
        sub.font = .monospacedSystemFont(ofSize: 10.5, weight: .regular); sub.textColor = Self.mute

        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 13
        stack.translatesAutoresizingMaskIntoConstraints = false
        notesStack = stack
        let doc = FlippedView(); doc.translatesAutoresizingMaskIntoConstraints = false
        doc.addSubview(stack)
        let scroll = NSScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true; scroll.drawsBackground = false; scroll.documentView = doc
        NSLayoutConstraint.activate([
            doc.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            doc.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            doc.trailingAnchor.constraint(equalTo: scroll.contentView.trailingAnchor),
            doc.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.topAnchor.constraint(equalTo: doc.topAnchor),
            stack.leadingAnchor.constraint(equalTo: doc.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: doc.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: doc.bottomAnchor),
        ])

        let pen = iconView("pencil", size: 15, color: Self.amber)
        let field = NSTextField(); field.placeholderString = "пометка на полях…"
        field.font = .systemFont(ofSize: 13); field.textColor = Self.ink
        field.isBordered = false; field.drawsBackground = false; field.focusRingType = .none
        field.delegate = self; field.target = self; field.action = #selector(addFromField)
        input = field
        let addBtn = NSButton(title: "+", target: self, action: #selector(addFromField))
        addBtn.bezelStyle = .circular; addBtn.keyEquivalent = "\r"; addBtn.setContentHuggingPriority(.required, for: .horizontal)
        let fieldRow = NSStackView(views: [pen, field, addBtn]); fieldRow.alignment = .centerY; fieldRow.spacing = 9
        fieldRow.translatesAutoresizingMaskIntoConstraints = false
        let box = NSView(); box.wantsLayer = true
        box.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.30).cgColor
        box.layer?.cornerRadius = 11; box.layer?.borderWidth = 1; box.layer?.borderColor = Self.line.cgColor
        box.addSubview(fieldRow)
        NSLayoutConstraint.activate([
            fieldRow.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 12),
            fieldRow.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -10),
            fieldRow.topAnchor.constraint(equalTo: box.topAnchor, constant: 9),
            fieldRow.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -9),
        ])
        fieldBox = box

        let sync = iconView("arrow.triangle.2.circlepath", size: 12, color: Self.mute)
        let footLbl = NSTextField(labelWithString: "на стопе уйдут к встрече")
        footLbl.font = .monospacedSystemFont(ofSize: 10, weight: .regular); footLbl.textColor = Self.mute
        let foot = NSStackView(views: [sync, footLbl]); foot.spacing = 7; foot.alignment = .centerY

        // Название встречи — в раскрываемой части (видно только в блокноте). Свёрнутая пилюля = только контролы.
        let section = NSStackView(views: [titleRow, divider, sub, scroll, box, foot])
        section.orientation = .vertical; section.alignment = .leading; section.spacing = 10
        section.translatesAutoresizingMaskIntoConstraints = false
        section.setHuggingPriority(.defaultLow, for: .vertical)
        notesSection = section

        let outer = NSStackView(views: [header, section])
        outer.orientation = .vertical; outer.alignment = .leading; outer.spacing = 8
        outer.edgeInsets = NSEdgeInsets(top: 13, left: 15, bottom: 12, right: 15)
        outer.translatesAutoresizingMaskIntoConstraints = false
        vfx.addSubview(outer)
        let fw: [NSView] = [header, titleRow, divider, scroll, box, section]
        NSLayoutConstraint.activate([
            outer.leadingAnchor.constraint(equalTo: vfx.leadingAnchor),
            outer.trailingAnchor.constraint(equalTo: vfx.trailingAnchor),
            outer.topAnchor.constraint(equalTo: vfx.topAnchor),
            outer.bottomAnchor.constraint(equalTo: vfx.bottomAnchor),
        ] + fw.map { $0.widthAnchor.constraint(equalTo: outer.widthAnchor, constant: -32) })
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        p.contentView = vfx
        panel = p
    }

    private func levelTrack(_ fill: CALayer, color: NSColor) -> NSView {
        let t = NSView(); t.wantsLayer = true
        t.layer?.backgroundColor = NSColor(white: 1, alpha: 0.08).cgColor
        t.layer?.cornerRadius = 1.5
        t.translatesAutoresizingMaskIntoConstraints = false
        t.heightAnchor.constraint(equalToConstant: 3).isActive = true
        fill.backgroundColor = color.cgColor; fill.cornerRadius = 1.5; fill.frame = .zero
        t.layer?.addSublayer(fill)
        return t
    }

    private func iconView(_ symbol: String, size: CGFloat, color: NSColor) -> NSImageView {
        let iv = NSImageView()
        iv.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        iv.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: size, weight: .regular)
        iv.contentTintColor = color; iv.setContentHuggingPriority(.required, for: .horizontal)
        return iv
    }

    // MARK: - таймеры

    private func startTimers() {
        stopTimers()
        let t = Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(tickTimer), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common); timer = t; tickTimer()
        let lt = Timer.scheduledTimer(timeInterval: 0.1, target: self, selector: #selector(tickLevels), userInfo: nil, repeats: true)
        RunLoop.main.add(lt, forMode: .common); levelTimer = lt
    }
    private func stopTimers() { timer?.invalidate(); timer = nil; levelTimer?.invalidate(); levelTimer = nil }
    @objc private func tickTimer() { timerLabel?.stringValue = fmt(Int(max(0, Date().timeIntervalSince(startedAt ?? Date())))) }
    @objc private func tickLevels() {
        applyLevel(CGFloat(micLevel?() ?? 0), track: micTrack, fill: micFill)
        applyLevel(CGFloat(sysLevel?() ?? 0), track: sysTrack, fill: sysFill)
    }
    private func applyLevel(_ lvl: CGFloat, track: NSView?, fill: CALayer) {
        guard let t = track else { return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        fill.frame = CGRect(x: 0, y: 0, width: max(0, min(1, lvl)) * t.bounds.width, height: 3)
        CATransaction.commit()
    }

    private func clearNotes() {
        notesStack?.arrangedSubviews.forEach { $0.removeFromSuperview() }
    }
    private func fmt(_ s: Int) -> String { String(format: "%02d:%02d", s / 60, s % 60) }

    private func isTitle(_ obj: Notification) -> Bool { (obj.object as AnyObject) === titleField }
    func controlTextDidBeginEditing(_ obj: Notification) {
        guard !isTitle(obj) else { return }   // подсветка — только у поля пометок
        fieldBox?.layer?.borderColor = Self.amber.withAlphaComponent(0.55).cgColor
    }
    func controlTextDidEndEditing(_ obj: Notification) {
        if isTitle(obj) { captureTitle(); return }
        fieldBox?.layer?.borderColor = Self.line.cgColor
    }

    private func captureTitle() {
        let t = titleField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        editedTitle = t.isEmpty ? nil : t
    }
    @objc private func commitTitle() { captureTitle(); panel?.makeFirstResponder(nil) }

    @objc private func stopTapped() { onStop?() }

    @objc private func addFromField() {
        guard let field = input else { return }
        let t = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        let offset = Int(max(0, Date().timeIntervalSince(startedAt ?? Date())))
        buffer.append(Buffered(offset: offset, text: t))
        appendNoteRow(offset: offset, text: t)
        field.stringValue = ""; panel?.makeFirstResponder(field)
    }

    private func appendNoteRow(offset: Int, text: String) {
        guard let stack = notesStack else { return }
        let rule = NSView(); rule.wantsLayer = true; rule.layer?.backgroundColor = Self.amber.cgColor
        rule.layer?.cornerRadius = 1; rule.translatesAutoresizingMaskIntoConstraints = false
        let chip = NSTextField(labelWithString: " \(fmt(offset)) ")
        chip.font = .monospacedSystemFont(ofSize: 10, weight: .semibold); chip.textColor = Self.amber
        chip.wantsLayer = true; chip.layer?.backgroundColor = Self.amberSoft.cgColor; chip.layer?.cornerRadius = 5
        chip.setContentHuggingPriority(.required, for: .horizontal)
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 13, weight: .semibold); label.textColor = Self.ink
        let inner = NSStackView(views: [chip, label]); inner.orientation = .vertical; inner.alignment = .leading; inner.spacing = 5
        inner.translatesAutoresizingMaskIntoConstraints = false
        let row = NSView(); row.translatesAutoresizingMaskIntoConstraints = false
        row.addSubview(rule); row.addSubview(inner)
        NSLayoutConstraint.activate([
            rule.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            rule.topAnchor.constraint(equalTo: row.topAnchor, constant: 2),
            rule.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -2),
            rule.widthAnchor.constraint(equalToConstant: 2),
            inner.leadingAnchor.constraint(equalTo: rule.trailingAnchor, constant: 12),
            inner.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            inner.topAnchor.constraint(equalTo: row.topAnchor),
            inner.bottomAnchor.constraint(equalTo: row.bottomAnchor),
        ])
        stack.addArrangedSubview(row)
        row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    }

    // MARK: - flush на стопе

    func flush(meetingId: String, config: SwarmConfig) async {
        stopTimers()
        let pending = buffer
        guard !pending.isEmpty else { hide(); return }
        guard let jwt = await fetchWebToken(config: config) else {
            NSLog("SwarmRecorder: live-пометки не слиты — нет web-JWT (\(pending.count) шт.)"); return
        }
        let api = config.ingestBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/swarm-api/agent-meetings/\(meetingId)/notes"
        guard let url = URL(string: api) else { return }
        var sent = 0
        for n in pending {
            var req = URLRequest(url: url); req.httpMethod = "POST"
            req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["offset_sec": n.offset, "text": n.text])
            req.timeoutInterval = 15
            if let (_, resp) = try? await URLSession.shared.data(for: req),
               let code = (resp as? HTTPURLResponse)?.statusCode, code == 200 || code == 201 { sent += 1 }
        }
        NSLog("SwarmRecorder: live-пометки слиты \(sent)/\(pending.count) → встреча \(meetingId)")
        if sent == pending.count { buffer.removeAll() }
        hide()
    }

    private func fetchWebToken(config: SwarmConfig) async -> String? {
        let base = config.ingestBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(base)/meeting-webtoken") else { return nil }
        var req = URLRequest(url: url); req.httpMethod = "POST"
        req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization"); req.timeoutInterval = 15
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200,
                  let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let jwt = obj["jwt"] as? String else { return nil }
            return jwt
        } catch { NSLog("SwarmRecorder: meeting-webtoken не удался: \(error)"); return nil }
    }
}

/// Flipped-контейнер: контент NSScrollView начинается СВЕРХУ (иначе пометки уезжают вниз).
private final class FlippedView: NSView { override var isFlipped: Bool { true } }
