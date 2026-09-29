import AppKit
import Foundation

// Щуп самопроверок (--selftest-pick): жмёт кнопки капсулы, читает её тексты и снимает кадр
// ИЗНУТРИ процесса. Нужен, когда экран Мака заблокирован: System Events тогда не видит окон
// (windows=0), а screencapture не отдаёт кадр — живую проверку без щупа не провести. Нажатие —
// performClick по кнопке с тем же AXIdentifier, что жмёт System Events: тот же target/action,
// та же кнопка на экране. В рабочем режиме рекордера щуп не создаётся.
//
// Команды — строками в файл SWARM_SELFTEST_CMD (читается раз в секунду, после чтения стирается):
//   press <accessibility id>   нажать кнопку (choice.invite.1, missed.invite, banner.close, …)
//   texts                      напечатать все видимые тексты и кнопки капсулы
//   shot <путь.png>            снять капсулу в PNG (в целевом размере окна)
final class SelfTestProbe {
    private let widget: RecorderWidget
    private let path: String
    private let tag: String
    private var timer: Timer?

    init?(widget: RecorderWidget, tag: String) {
        guard let path = ProcessInfo.processInfo.environment["SWARM_SELFTEST_CMD"] else { return nil }
        self.widget = widget
        self.path = path
        self.tag = tag
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func tick() {
        guard let raw = try? String(contentsOfFile: path, encoding: .utf8), !raw.isEmpty else { return }
        try? "".write(toFile: path, atomically: true, encoding: .utf8)
        for line in raw.split(separator: "\n") {
            let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
            switch (parts.first, parts.count > 1 ? parts[1] : "") {
            case ("press", let id): press(id)
            case ("texts", _): texts()
            case ("shot", let out): shot(out)
            default: print("\(tag): щуп — непонятная команда «\(line)»")
            }
        }
    }

    private var root: NSView? { widget.panel?.isVisible == true ? widget.panel?.contentView : nil }

    private func visible(_ v: NSView) -> Bool {
        var cur: NSView? = v
        while let c = cur { if c.isHidden { return false }; cur = c.superview }
        return true
    }

    private func all(_ v: NSView) -> [NSView] { [v] + v.subviews.flatMap(all) }

    private func press(_ id: String) {
        guard let root else { print("\(tag): щуп — капсулы нет, «\(id)» не нажат"); return }
        let hit = all(root).compactMap { $0 as? NSButton }.first { $0.accessibilityIdentifier() == id && visible($0) }
        guard let hit else { print("\(tag): щуп — кнопки «\(id)» на экране нет"); return }
        print("\(tag): щуп — нажимаю «\(id)» («\(hit.title)», \(hit.isEnabled ? "активна" : "неактивна"))")
        hit.performClick(nil)
    }

    private func texts() {
        guard let root else { print("\(tag): щуп — тексты: капсулы нет"); return }
        let rows = all(root).filter(visible).compactMap { v -> String? in
            if let b = v as? NSButton {
                let id = b.accessibilityIdentifier()
                return b.title.isEmpty ? nil : "кнопка «\(b.title)»\(id.isEmpty ? "" : " [\(id)]")\(b.isEnabled ? "" : " (неактивна)")"
            }
            if let t = v as? NSTextField, !t.stringValue.isEmpty { return "текст «\(t.stringValue)»" }
            return nil
        }
        print("\(tag): щуп — тексты капсулы: \(rows.joined(separator: " · "))")
    }

    // При заблокированном экране анимация смены размера окна не доезжает (окно застревает в
    // прошлом размере), поэтому перед кадром окно ставится в целевой размер без анимации —
    // тот, который present() считает для текущего содержимого.
    private func shot(_ out: String) {
        guard let root, let p = widget.panel else { print("\(tag): щуп — кадр: капсулы нет"); return }
        let was = p.frame.size, want = widget.currentSize()
        if was != want {
            p.setFrame(NSRect(origin: NSPoint(x: p.frame.maxX - want.width, y: p.frame.maxY - want.height), size: want), display: true)
            root.layoutSubtreeIfNeeded()
            print("\(tag): щуп — окно было \(Int(was.width))×\(Int(was.height)), поставлено в целевое \(Int(want.width))×\(Int(want.height))")
        }
        guard let rep = root.bitmapImageRepForCachingDisplay(in: root.bounds) else { return }
        root.cacheDisplay(in: root.bounds, to: rep)
        do {
            try rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: out))
            print("\(tag): щуп — кадр \(Int(root.bounds.width))×\(Int(root.bounds.height)) → \(out)")
        } catch { print("\(tag): щуп — кадр не записан: \(error)") }
    }
}
