import AppKit
import WebKit

/// Правая док-панель «Рой · заметки» (Granola-режим, Фаза 3, вариант B).
/// Всплывает на старте записи, грузит /live?host=recorder в WKWebView — пользователь пишет
/// «пометки на полях». meetingId во время записи ещё нет (claim — на стопе), поэтому пометки
/// НЕ сохраняются по ходу, а копятся в нативный буфер через JS→native мост (royNotes).
/// На стопе (когда claim даёт meetingId) рекордер вызывает flush() → обменивает свой токен
/// на web-JWT (meeting-webtoken) и POST'ит пометки в /agent-meetings/:id/notes.
/// Плавает поверх всех окон у правого края (как блокнот Granola); место не резервирует.
@MainActor
final class LiveNotesPanel: NSObject, WKScriptMessageHandler {
    static let shared = LiveNotesPanel()
    private override init() { super.init() }

    private var panel: NSPanel?
    private var webView: WKWebView?
    private struct Buffered { let offset: Int; let text: String }
    private var buffer: [Buffered] = []

    private static let panelWidth: CGFloat = 380
    private static let margin: CGFloat = 16

    /// Показать панель (грузит /live в режиме рекордера). Буфер пометок начинаем заново.
    func show(config: SwarmConfig) {
        buffer.removeAll()
        ensurePanel(config: config)
        positionAtRightEdge()
        panel?.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }

    // MARK: - panel

    private func ensurePanel(config: SwarmConfig) {
        if panel != nil { return }
        let frame = NSRect(x: 0, y: 0, width: Self.panelWidth, height: 600)
        let wkc = WKWebViewConfiguration()
        wkc.userContentController.add(self, name: "royNotes")     // JS → native мост
        let wv = WKWebView(frame: frame, configuration: wkc)
        wv.setValue(false, forKey: "drawsBackground")              // без белой вспышки (тёмная /live)
        webView = wv
        let base = config.webBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if let url = URL(string: "\(base)/live?host=recorder") { wv.load(URLRequest(url: url)) }

        let p = NSPanel(contentRect: frame,
                        styleMask: [.titled, .closable, .resizable, .utilityWindow, .fullSizeContentView],
                        backing: .buffered, defer: false)
        p.title = "Рой · заметки"
        p.titlebarAppearsTransparent = true
        p.isMovableByWindowBackground = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.contentView = wv
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

    // MARK: - JS → native (каждая пометка из /live копится в буфер)

    nonisolated func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "royNotes", let body = message.body as? [String: Any] else { return }
        let offset = (body["offset_sec"] as? Int) ?? Int((body["offset_sec"] as? Double) ?? 0)
        let text = ((body["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task { @MainActor in self.buffer.append(Buffered(offset: max(0, offset), text: text)) }
    }

    // MARK: - flush на стопе (meetingId известен после claim)

    /// Слить накопленные пометки к встрече. Best-effort: web-JWT через meeting-webtoken →
    /// POST /swarm-api/agent-meetings/:id/notes (Bearer JWT). Не блокирует критичный путь отправки.
    func flush(meetingId: String, config: SwarmConfig) async {
        let pending = buffer
        guard !pending.isEmpty else { hide(); return }
        guard let jwt = await fetchWebToken(config: config) else {
            NSLog("SwarmRecorder: live-пометки не слиты — нет web-JWT (\(pending.count) шт. в буфере)")
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
        NSLog("SwarmRecorder: live-пометки слиты \(sent)/\(pending.count) к встрече \(meetingId)")
        if sent == pending.count { buffer.removeAll() }
        hide()
    }

    /// recorder-токен → web-JWT (meeting-webtoken).
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
