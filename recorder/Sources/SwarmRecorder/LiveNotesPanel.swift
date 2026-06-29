import AppKit

/// Правая док-панель «Рой · заметки» (Granola-режим, Фаза 3) — нативный AppKit-блокнот
/// в стиле проекта (тёмное стекло + янтарь + моно-тайм-штампы). Всплывает на старте записи,
/// даёт писать «пометки на полях». meetingId во время записи ещё нет (claim — на стопе),
/// поэтому пометки копятся в буфер; на стопе flush() меняет токен на web-JWT (meeting-webtoken)
/// и POST'ит в /agent-meetings/:id/notes. WKWebView не используем — он не грузится в self-signed аппе.
@MainActor
final class LiveNotesPanel: NSObject {
    static let shared = LiveNotesPanel()
    private override init() { super.init() }

    private var panel: NSPanel?
    private var notesStack: NSStackView?
    private var input: NSTextField?
    private var emptyHint: NSTextField?
    private struct Buffered { let offset: Int; let text: String }
    private var buffer: [Buffered] = []
    private var startedAt: Date?

    private static let panelWidth: CGFloat = 360
    private static let margin: CGFloat = 16
    private static let amber = RoyArt.amber                                   // #D98A2B (= --primary)
    private static let amberSoft = RoyArt.amber.withAlphaComponent(0.16)
    private static let ink = NSColor(srgbRed: 0.93, green: 0.90, blue: 0.83, alpha: 1)
    private static let mute = NSColor(srgbRed: 0.62, green: 0.58, blue: 0.50, alpha: 1)

    /// Показ на старте записи: сбросить буфер/список, построить, показать.
    func show(config: SwarmConfig) {
        buffer.removeAll()
        startedAt = Date()
        ensurePanel()
        clearNotes()
        positionAtRightEdge()
        panel?.orderFrontRegardless()
        panel?.makeFirstResponder(input)
    }

    func hide() { panel?.orderOut(nil) }

    /// Клик по виджету: спрятать/показать БЕЗ сброса (та же встреча, буфер сохраняется).
    func toggleVisibility() {
        guard let panel else { return }                 // панель есть только во время записи
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

        // Тёмное стекло (как «стекло» в вебе «Рой»).
        let vfx = NSVisualEffectView(frame: frame)
        vfx.material = .hudWindow
        vfx.blendingMode = .behindWindow
        vfx.state = .active
        vfx.appearance = NSAppearance(named: .vibrantDark)

        // Шапка: марка «Рой» + REC-точка + заголовок.
        let mark = NSImageView(image: RoyArt.markImage(size: 18))
        mark.setContentHuggingPriority(.required, for: .horizontal)
        let recDot = makeDot(color: NSColor(srgbRed: 1, green: 0.42, blue: 0.37, alpha: 1), d: 8)
        let title = NSTextField(labelWithString: "Заметки встречи")
        title.font = .systemFont(ofSize: 13, weight: .bold)
        title.textColor = Self.ink
        let header = NSStackView(views: [mark, recDot, title])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 8

        let sub = NSTextField(labelWithString: "пиши свободно — попадут к встрече по времени")
        sub.font = .systemFont(ofSize: 11)
        sub.textColor = Self.mute

        // Список пометок.
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        notesStack = stack

        let hint = NSTextField(labelWithString: "пометок пока нет")
        hint.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        hint.textColor = Self.mute
        emptyHint = hint
        stack.addArrangedSubview(hint)

        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.documentView = stack
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentView.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
        ])

        // Ввод: поле + кнопка «+».
        let field = NSTextField()
        field.placeholderString = "пометка на полях…"
        field.font = .systemFont(ofSize: 13)
        field.textColor = Self.ink
        field.bezelStyle = .roundedBezel
        field.focusRingType = .none
        field.target = self
        field.action = #selector(addFromField)
        input = field
        let addBtn = NSButton(title: "+", target: self, action: #selector(addFromField))
        addBtn.bezelStyle = .rounded
        addBtn.keyEquivalent = "\r"
        addBtn.setContentHuggingPriority(.required, for: .horizontal)
        let inputRow = NSStackView(views: [field, addBtn])
        inputRow.orientation = .horizontal
        inputRow.spacing = 8

        let outer = NSStackView(views: [header, sub, scroll, inputRow])
        outer.orientation = .vertical
        outer.alignment = .leading
        outer.spacing = 10
        outer.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        outer.translatesAutoresizingMaskIntoConstraints = false
        outer.setHuggingPriority(.defaultLow, for: .vertical)
        vfx.addSubview(outer)
        NSLayoutConstraint.activate([
            outer.leadingAnchor.constraint(equalTo: vfx.leadingAnchor),
            outer.trailingAnchor.constraint(equalTo: vfx.trailingAnchor),
            outer.topAnchor.constraint(equalTo: vfx.topAnchor, constant: 26),   // под прозрачный титлбар
            outer.bottomAnchor.constraint(equalTo: vfx.bottomAnchor),
            scroll.widthAnchor.constraint(equalTo: outer.widthAnchor, constant: -32),
            inputRow.widthAnchor.constraint(equalTo: outer.widthAnchor, constant: -32),
        ])
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        p.contentView = vfx
        panel = p
    }

    private func makeDot(color: NSColor, d: CGFloat) -> NSView {
        let v = NSView(frame: NSRect(x: 0, y: 0, width: d, height: d))
        v.wantsLayer = true
        v.layer?.backgroundColor = color.cgColor
        v.layer?.cornerRadius = d / 2
        v.translatesAutoresizingMaskIntoConstraints = false
        v.widthAnchor.constraint(equalToConstant: d).isActive = true
        v.heightAnchor.constraint(equalToConstant: d).isActive = true
        return v
    }

    private func positionAtRightEdge() {
        guard let panel, let screen = NSScreen.main else { return }
        let vf = screen.visibleFrame
        let h = min(vf.height - Self.margin * 2, 820)
        let x = vf.maxX - Self.panelWidth - Self.margin
        let y = vf.maxY - h - Self.margin
        panel.setFrame(NSRect(x: x, y: y, width: Self.panelWidth, height: h), display: true)
    }

    private func clearNotes() {
        notesStack?.arrangedSubviews.forEach { if $0 != emptyHint { $0.removeFromSuperview() } }
        emptyHint?.isHidden = false
    }

    private func fmt(_ s: Int) -> String { String(format: "%02d:%02d", s / 60, s % 60) }

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

    private func appendNoteRow(offset: Int, text: String) {
        guard let stack = notesStack else { return }
        emptyHint?.isHidden = true

        let chip = NSTextField(labelWithString: " \(fmt(offset)) ")
        chip.font = .monospacedSystemFont(ofSize: 10.5, weight: .semibold)
        chip.textColor = Self.amber
        chip.wantsLayer = true
        chip.layer?.backgroundColor = Self.amberSoft.cgColor
        chip.layer?.cornerRadius = 5
        chip.setContentHuggingPriority(.required, for: .horizontal)
        chip.setContentCompressionResistancePriority(.required, for: .horizontal)

        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 13, weight: .semibold)   // пометки — жирные
        label.textColor = Self.ink

        let row = NSStackView(views: [chip, label])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 9
        row.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(row)
        row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    }

    // MARK: - flush на стопе

    func flush(meetingId: String, config: SwarmConfig) async {
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
