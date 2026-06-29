import AppKit

/// Правая док-панель «Рой · заметки» (Granola-режим, Фаза 3) — НАТИВНЫЙ блокнот.
/// Всплывает на старте записи, даёт писать «пометки на полях» по ходу встречи. meetingId
/// во время записи ещё нет (claim — на стопе), поэтому пометки копятся в буфер; на стопе
/// рекордер вызывает flush() → меняет токен на web-JWT (meeting-webtoken) → POST в
/// /agent-meetings/:id/notes. Без WKWebView (он не грузится в self-signed аппе) — чистый AppKit.
@MainActor
final class LiveNotesPanel: NSObject {
    static let shared = LiveNotesPanel()
    private override init() { super.init() }

    private var panel: NSPanel?
    private var notesStack: NSStackView?
    private var input: NSTextField?
    private struct Buffered { let offset: Int; let text: String }
    private var buffer: [Buffered] = []
    private var startedAt: Date?

    private static let panelWidth: CGFloat = 360
    private static let margin: CGFloat = 16
    private static let amber = NSColor(srgbRed: 0.95, green: 0.72, blue: 0.35, alpha: 1)
    private static let amberSoft = NSColor(srgbRed: 0.95, green: 0.72, blue: 0.35, alpha: 0.16)
    private static let bg = NSColor(srgbRed: 0.04, green: 0.043, blue: 0.027, alpha: 1)
    private static let ink = NSColor(srgbRed: 0.93, green: 0.90, blue: 0.83, alpha: 1)
    private static let mute = NSColor(srgbRed: 0.60, green: 0.57, blue: 0.49, alpha: 1)

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

    // MARK: - сборка панели

    private func ensurePanel() {
        if panel != nil { return }
        let frame = NSRect(x: 0, y: 0, width: Self.panelWidth, height: 620)
        let p = NSPanel(contentRect: frame, styleMask: [.titled, .closable, .resizable],
                        backing: .buffered, defer: false)
        p.title = "Рой · заметки"
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.backgroundColor = Self.bg

        let content = NSView(frame: frame)
        content.wantsLayer = true
        content.layer?.backgroundColor = Self.bg.cgColor

        let header = NSTextField(labelWithString: "🔴  Заметки встречи — пиши свободно")
        header.font = .systemFont(ofSize: 12, weight: .semibold)
        header.textColor = Self.mute

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 9
        stack.translatesAutoresizingMaskIntoConstraints = false
        notesStack = stack

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

        let field = NSTextField()
        field.placeholderString = "пометка на полях…"
        field.font = .systemFont(ofSize: 13)
        field.textColor = Self.ink
        field.bezelStyle = .roundedBezel
        field.focusRingType = .none
        field.target = self
        field.action = #selector(addFromField)
        input = field

        let outer = NSStackView(views: [header, scroll, field])
        outer.orientation = .vertical
        outer.alignment = .leading
        outer.spacing = 12
        outer.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        outer.translatesAutoresizingMaskIntoConstraints = false
        outer.setHuggingPriority(.defaultLow, for: .vertical)
        content.addSubview(outer)
        NSLayoutConstraint.activate([
            outer.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            outer.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            outer.topAnchor.constraint(equalTo: content.topAnchor),
            outer.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            scroll.widthAnchor.constraint(equalTo: outer.widthAnchor, constant: -32),
            field.widthAnchor.constraint(equalTo: outer.widthAnchor, constant: -32),
        ])
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        p.contentView = content
        panel = p
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
        notesStack?.arrangedSubviews.forEach { $0.removeFromSuperview() }
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
    }

    private func appendNoteRow(offset: Int, text: String) {
        guard let stack = notesStack else { return }
        let chip = NSTextField(labelWithString: fmt(offset))
        chip.font = .monospacedSystemFont(ofSize: 10.5, weight: .semibold)
        chip.textColor = Self.amber
        chip.wantsLayer = true
        chip.layer?.backgroundColor = Self.amberSoft.cgColor
        chip.layer?.cornerRadius = 5
        chip.setContentHuggingPriority(.required, for: .horizontal)

        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 13, weight: .semibold)   // пометки — жирные
        label.textColor = Self.ink

        let row = NSStackView(views: [chip, label])
        row.orientation = .horizontal
        row.alignment = .firstBaseline
        row.spacing = 9
        row.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(row)
        row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        // прокрутить вниз к свежей
        if let doc = stack.enclosingScrollView { doc.documentView?.scroll(NSPoint(x: 0, y: 0)) }
    }

    // MARK: - flush на стопе (meetingId известен после claim)

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
