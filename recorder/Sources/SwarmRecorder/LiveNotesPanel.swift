import AppKit
import WebKit

/// Правая док-панель «Рой · заметки» (Granola-режим, Фаза 3, вариант B).
/// Всплывает на старте записи, грузит /live?host=recorder в WKWebView — пользователь пишет
/// «пометки на полях». meetingId во время записи ещё нет (claim — на стопе), поэтому пометки
/// копятся в нативный буфер через JS→native мост (royNotes). На стопе рекордер вызывает
/// flush() → обменивает токен на web-JWT (meeting-webtoken) и POST'ит в /agent-meetings/:id/notes.
@MainActor
final class LiveNotesPanel: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let shared = LiveNotesPanel()
    private override init() { super.init() }

    private var panel: NSPanel?
    private var webView: WKWebView?
    private struct Buffered { let offset: Int; let text: String }
    private var buffer: [Buffered] = []

    private static let panelWidth: CGFloat = 380
    private static let margin: CGFloat = 16

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
        wv.navigationDelegate = self
        webView = wv

        // Тёмный плейсхолдер сразу (чтобы не было белого «молчания», пока грузится /live).
        wv.loadHTMLString("<html><body style='margin:0;background:#0a0b07;color:#9a937f;font:14px -apple-system;display:grid;place-items:center;height:100vh'>загрузка…</body></html>", baseURL: nil)

        // Обычное перетаскиваемое окно (титлбар = ручка для перемещения).
        let p = NSPanel(contentRect: frame,
                        styleMask: [.titled, .closable, .resizable],
                        backing: .buffered, defer: false)
        p.title = "Рой · заметки"
        p.level = .floating                                   // поверх обычных окон
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.043, blue: 0.027, alpha: 1) // #0a0b07
        p.contentView = wv
        panel = p

        // Грузим реальный экран ПОСЛЕ установки делегата/окна.
        let base = config.webBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if let url = URL(string: "\(base)/live?host=recorder") {
            var req = URLRequest(url: url)
            req.cachePolicy = .reloadIgnoringLocalCacheData      // свежий /live, без старого кэша
            wv.load(req)
        }
    }

    private func positionAtRightEdge() {
        guard let panel, let screen = NSScreen.main else { return }
        let vf = screen.visibleFrame
        let h = min(vf.height - Self.margin * 2, 820)
        let x = vf.maxX - Self.panelWidth - Self.margin
        let y = vf.maxY - h - Self.margin
        panel.setFrame(NSRect(x: x, y: y, width: Self.panelWidth, height: h), display: true)
    }

    // MARK: - WKNavigationDelegate (диагностика: ошибку видно, а не «белый экран»)

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("SwarmRecorder: LiveNotes /live не загрузился (provisional): \(error.localizedDescription)")
        showLoadError(error.localizedDescription)
    }
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("SwarmRecorder: LiveNotes /live ошибка навигации: \(error.localizedDescription)")
        showLoadError(error.localizedDescription)
    }
    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        NSLog("SwarmRecorder: LiveNotes /live загрузился")
    }
    private nonisolated func showLoadError(_ msg: String) {
        Task { @MainActor in
            let safe = msg.replacingOccurrences(of: "<", with: "&lt;")
            self.webView?.loadHTMLString("<html><body style='margin:0;background:#0a0b07;color:#ece5d4;font:14px -apple-system;padding:24px'>Не удалось загрузить заметки:<br><br><span style='color:#ff8a7a'>\(safe)</span><br><br>проверь сеть/доступ к swarm-brain.pages.dev</body></html>", baseURL: nil)
        }
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
