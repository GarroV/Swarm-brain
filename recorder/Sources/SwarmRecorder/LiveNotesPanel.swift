import AppKit

/// Правая док-панель «Рой · заметки» (Granola-режим, Фаза 3) — нативный AppKit-блокнот
/// в айдентике «Роя»: тёмное стекло + янтарь + марка-рой + моно-тайм-штампы + пометки-маргиналии.
/// Всплывает на старте записи; пометки копятся в буфер (meetingId появляется на стопе → claim),
/// на стопе flush() меняет токен на web-JWT (meeting-webtoken) и POST'ит в /agent-meetings/:id/notes.
@MainActor
final class LiveNotesPanel: NSObject, NSTextFieldDelegate {
    static let shared = LiveNotesPanel()
    private override init() { super.init() }

    private var panel: NSPanel?
    private var notesStack: NSStackView?
    private var input: NSTextField?
    private var fieldBox: NSView?
    private var emptyView: NSView?
    private var timerLabel: NSTextField?
    private var timer: Timer?
    private struct Buffered { let offset: Int; let text: String }
    private var buffer: [Buffered] = []
    private var startedAt: Date?

    private static let panelWidth: CGFloat = 360
    private static let margin: CGFloat = 16
    private static let amber = RoyArt.amber                                   // #D98A2B (= --primary)
    private static let amberHi = NSColor(srgbRed: 0.96, green: 0.77, blue: 0.42, alpha: 1)  // #f4c46a
    private static let amberSoft = RoyArt.amber.withAlphaComponent(0.16)
    private static let ink = NSColor(srgbRed: 0.93, green: 0.90, blue: 0.83, alpha: 1)
    private static let mute = NSColor(srgbRed: 0.55, green: 0.51, blue: 0.43, alpha: 1)
    private static let line = NSColor(srgbRed: 0.91, green: 0.78, blue: 0.55, alpha: 0.13)
    private static let rec = NSColor(srgbRed: 1, green: 0.42, blue: 0.37, alpha: 1)

    func show(config: SwarmConfig) {
        buffer.removeAll()
        startedAt = Date()
        ensurePanel()
        clearNotes()
        startTimer()
        positionAtRightEdge()
        panel?.orderFrontRegardless()
        panel?.makeFirstResponder(input)
    }

    func hide() { stopTimer(); panel?.orderOut(nil) }

    func toggleVisibility() {
        guard let panel else { return }
        if panel.isVisible { panel.orderOut(nil) }
        else { positionAtRightEdge(); panel.orderFrontRegardless(); panel.makeFirstResponder(input) }
    }

    // MARK: - сборка

    private func ensurePanel() {
        if panel != nil { return }
        let frame = NSRect(x: 0, y: 0, width: Self.panelWidth, height: 620)
        let p = NSPanel(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
                        backing: .buffered, defer: false)
        p.title = "Рой · заметки"
        p.titlebarAppearsTransparent = true
        p.titleVisibility = .hidden
        p.isMovableByWindowBackground = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.isOpaque = false
        p.backgroundColor = .clear

        let vfx = NSVisualEffectView(frame: frame)
        vfx.material = .hudWindow
        vfx.blendingMode = .behindWindow
        vfx.state = .active
        vfx.appearance = NSAppearance(named: .vibrantDark)

        // ── шапка: марка + REC-пульс + «Заметки» + таймер ──
        let mark = NSImageView(image: RoyArt.markImage(size: 22))
        mark.setContentHuggingPriority(.required, for: .horizontal)

        let dot = NSView()
        dot.wantsLayer = true
        dot.layer?.backgroundColor = Self.rec.cgColor
        dot.layer?.cornerRadius = 4
        dot.layer?.shadowColor = Self.rec.cgColor
        dot.layer?.shadowRadius = 4; dot.layer?.shadowOpacity = 0.8; dot.layer?.shadowOffset = .zero
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.widthAnchor.constraint(equalToConstant: 8).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 8).isActive = true
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 1; pulse.toValue = 0.25; pulse.duration = 0.85
        pulse.autoreverses = true; pulse.repeatCount = .infinity
        dot.layer?.add(pulse, forKey: "pulse")
        let recLabel = NSTextField(labelWithString: "REC")
        recLabel.font = .monospacedSystemFont(ofSize: 10, weight: .semibold)
        recLabel.textColor = Self.rec
        let recRow = NSStackView(views: [dot, recLabel]); recRow.spacing = 6; recRow.alignment = .centerY

        let title = NSTextField(labelWithString: "Заметки")
        title.font = .systemFont(ofSize: 14, weight: .bold)
        title.textColor = Self.ink
        title.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let timerLbl = NSTextField(labelWithString: "00:00")
        timerLbl.font = .monospacedSystemFont(ofSize: 12, weight: .semibold)
        timerLbl.textColor = Self.mute
        timerLbl.alignment = .right
        timerLbl.setContentHuggingPriority(.required, for: .horizontal)
        timerLabel = timerLbl

        let header = NSStackView(views: [mark, recRow, title, timerLbl])
        header.orientation = .horizontal; header.alignment = .centerY; header.spacing = 9

        let divider = NSBox(); divider.boxType = .separator; divider.translatesAutoresizingMaskIntoConstraints = false

        let sub = NSTextField(labelWithString: "пиши по ходу — лягут к встрече по времени")
        sub.font = .monospacedSystemFont(ofSize: 10.5, weight: .regular)
        sub.textColor = Self.mute

        // ── список пометок ──
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 13
        stack.translatesAutoresizingMaskIntoConstraints = false
        notesStack = stack
        stack.addArrangedSubview(makeEmptyState())

        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        scroll.documentView = stack
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentView.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
        ])

        // ── ввод: рамка + перо + поле + «+» ──
        let pen = iconView("pencil", size: 15, color: Self.amber)
        let field = NSTextField()
        field.placeholderString = "пометка на полях…"
        field.font = .systemFont(ofSize: 13)
        field.textColor = Self.ink
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.delegate = self
        field.target = self; field.action = #selector(addFromField)
        input = field
        let addBtn = NSButton(title: "+", target: self, action: #selector(addFromField))
        addBtn.bezelStyle = .circular
        addBtn.keyEquivalent = "\r"
        addBtn.setContentHuggingPriority(.required, for: .horizontal)
        let fieldRow = NSStackView(views: [pen, field, addBtn])
        fieldRow.orientation = .horizontal; fieldRow.alignment = .centerY; fieldRow.spacing = 9
        fieldRow.translatesAutoresizingMaskIntoConstraints = false
        let box = NSView()
        box.wantsLayer = true
        box.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.30).cgColor
        box.layer?.cornerRadius = 11
        box.layer?.borderWidth = 1
        box.layer?.borderColor = Self.line.cgColor
        box.addSubview(fieldRow)
        NSLayoutConstraint.activate([
            fieldRow.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 12),
            fieldRow.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -10),
            fieldRow.topAnchor.constraint(equalTo: box.topAnchor, constant: 9),
            fieldRow.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -9),
        ])
        fieldBox = box

        // ── футер ──
        let sync = iconView("arrow.triangle.2.circlepath", size: 12, color: Self.mute)
        let footLbl = NSTextField(labelWithString: "на стопе записи уйдут к встрече")
        footLbl.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        footLbl.textColor = Self.mute
        let foot = NSStackView(views: [sync, footLbl]); foot.spacing = 7; foot.alignment = .centerY

        let outer = NSStackView(views: [header, divider, sub, scroll, box, foot])
        outer.orientation = .vertical; outer.alignment = .leading; outer.spacing = 11
        outer.setCustomSpacing(7, after: header)
        outer.setCustomSpacing(8, after: divider)
        outer.edgeInsets = NSEdgeInsets(top: 30, left: 16, bottom: 16, right: 16)
        outer.translatesAutoresizingMaskIntoConstraints = false
        outer.setHuggingPriority(.defaultLow, for: .vertical)
        vfx.addSubview(outer)
        let fullWidth: [NSView] = [divider, scroll, box]
        NSLayoutConstraint.activate([
            outer.leadingAnchor.constraint(equalTo: vfx.leadingAnchor),
            outer.trailingAnchor.constraint(equalTo: vfx.trailingAnchor),
            outer.topAnchor.constraint(equalTo: vfx.topAnchor),
            outer.bottomAnchor.constraint(equalTo: vfx.bottomAnchor),
        ] + fullWidth.map { $0.widthAnchor.constraint(equalTo: outer.widthAnchor, constant: -32) })
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        p.contentView = vfx
        panel = p
    }

    private func makeEmptyState() -> NSView {
        let glyph = iconView("mic", size: 36, color: Self.amber)
        let l1 = NSTextField(labelWithString: "пиши пометки по ходу встречи")
        let l2 = NSTextField(labelWithString: "они попадут к тезисам по времени")
        for l in [l1, l2] { l.font = .systemFont(ofSize: 12.5); l.textColor = Self.mute; l.alignment = .center }
        let v = NSStackView(views: [glyph, l1, l2])
        v.orientation = .vertical; v.alignment = .centerX; v.spacing = 6
        v.edgeInsets = NSEdgeInsets(top: 40, left: 0, bottom: 0, right: 0)
        emptyView = v
        return v
    }

    private func iconView(_ symbol: String, size: CGFloat, color: NSColor) -> NSImageView {
        let iv = NSImageView()
        iv.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        iv.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: size, weight: .regular)
        iv.contentTintColor = color
        iv.setContentHuggingPriority(.required, for: .horizontal)
        return iv
    }

    private func startTimer() {
        stopTimer()
        let t = Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(tickTimer), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
        tickTimer()
    }
    private func stopTimer() { timer?.invalidate(); timer = nil }
    @objc private func tickTimer() {
        let e = Int(max(0, Date().timeIntervalSince(startedAt ?? Date())))
        timerLabel?.stringValue = fmt(e)
    }

    private func positionAtRightEdge() {
        guard let panel, let screen = NSScreen.main else { return }
        let vf = screen.visibleFrame
        let h = min(vf.height - Self.margin * 2, 820)
        panel.setFrame(NSRect(x: vf.maxX - Self.panelWidth - Self.margin, y: vf.maxY - h - Self.margin,
                              width: Self.panelWidth, height: h), display: true)
    }

    private func clearNotes() {
        notesStack?.arrangedSubviews.forEach { if $0 != emptyView { $0.removeFromSuperview() } }
        emptyView?.isHidden = false
    }

    private func fmt(_ s: Int) -> String { String(format: "%02d:%02d", s / 60, s % 60) }

    // фокус-кольцо поля (янтарное)
    func controlTextDidBeginEditing(_ obj: Notification) {
        fieldBox?.layer?.borderColor = Self.amber.withAlphaComponent(0.55).cgColor
    }
    func controlTextDidEndEditing(_ obj: Notification) {
        fieldBox?.layer?.borderColor = Self.line.cgColor
    }

    @objc private func addFromField() {
        guard let field = input else { return }
        let t = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        let offset = Int(max(0, Date().timeIntervalSince(startedAt ?? Date())))
        buffer.append(Buffered(offset: offset, text: t))
        appendNoteRow(offset: offset, text: t)
        field.stringValue = ""
        panel?.makeFirstResponder(field)
    }

    // пометка-маргиналия: янтарная линейка | моно-тайм + жирный текст
    private func appendNoteRow(offset: Int, text: String) {
        guard let stack = notesStack else { return }
        emptyView?.isHidden = true

        let rule = NSView()
        rule.wantsLayer = true
        rule.layer?.backgroundColor = Self.amber.cgColor
        rule.layer?.cornerRadius = 1
        rule.translatesAutoresizingMaskIntoConstraints = false

        let chip = NSTextField(labelWithString: " \(fmt(offset)) ")
        chip.font = .monospacedSystemFont(ofSize: 10, weight: .semibold)
        chip.textColor = Self.amber
        chip.wantsLayer = true
        chip.layer?.backgroundColor = Self.amberSoft.cgColor
        chip.layer?.cornerRadius = 5
        chip.setContentHuggingPriority(.required, for: .horizontal)

        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 13, weight: .semibold)
        label.textColor = Self.ink

        let inner = NSStackView(views: [chip, label])
        inner.orientation = .vertical; inner.alignment = .leading; inner.spacing = 5
        inner.translatesAutoresizingMaskIntoConstraints = false

        let row = NSView()
        row.translatesAutoresizingMaskIntoConstraints = false
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
        stopTimer()
        let pending = buffer
        guard !pending.isEmpty else { hide(); return }
        guard let jwt = await fetchWebToken(config: config) else {
            NSLog("SwarmRecorder: live-пометки не слиты — нет web-JWT (\(pending.count) шт.)")
            return
        }
        let api = config.ingestBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/swarm-api/agent-meetings/\(meetingId)/notes"
        guard let url = URL(string: api) else { return }
        var sent = 0
        for n in pending {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
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
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 15
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200,
                  let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let jwt = obj["jwt"] as? String else { return nil }
            return jwt
        } catch {
            NSLog("SwarmRecorder: meeting-webtoken не удался: \(error)")
            return nil
        }
    }
}
