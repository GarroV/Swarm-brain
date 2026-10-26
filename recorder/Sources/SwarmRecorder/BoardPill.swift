import AppKit
import RecorderKit

// Значок-пилюля доски: маленькое плавающее окно, всегда видно, перетаскивается, позиция
// запоминается. Отдельное окно от `RecorderWidget` — со своим местом по умолчанию (под полосой
// меню, левее капсулы записи), чтобы не перекрывать и не путать с ним. На значке — число задач
// на сегодня (0 — без цифры). Клик открывает/закрывает доску.
final class BoardPill {
    var onClick: (() -> Void)?
    /// Значок перетащили: доска, развёрнутая из него, едет следом.
    var onMoved: (() -> Void)?

    private static let size = NSSize(width: 44, height: 44)
    private static let originKey = "BoardPillOrigin"
    /// Ширина капсулы записи (`RecorderWidget.pillSize`) и её отступ от края — чтобы встать левее.
    private static let widgetWidth: CGFloat = 72
    private static let edgeInset: CGFloat = 18

    private var panel: NSPanel?
    private let view = PillView(frame: NSRect(origin: .zero, size: BoardPill.size))

    var isVisible: Bool { panel?.isVisible == true }
    /// Где значок на экране — из этого угла разворачивается доска. nil — значок скрыт.
    var frame: NSRect? { isVisible ? panel?.frame : nil }

    func setCount(_ n: Int) { view.count = n }
    func setTooltip(_ s: String) { view.toolTip = s }

    func show() {
        ensurePanel()
        guard let panel else { return }
        panel.setFrameOrigin(Self.startOrigin())
        panel.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }

    private func ensurePanel() {
        if panel != nil { return }
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: Self.size),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        p.hidesOnDeactivate = false
        p.isFloatingPanel = true
        p.contentView = view
        view.onClick = { [weak self] in self?.onClick?() }
        view.onMoved = { [weak self] in self?.saveOrigin(); self?.onMoved?() }
        panel = p
    }

    private static func startOrigin() -> CGPoint {
        guard let main = NSScreen.main?.visibleFrame else { return .zero }
        if let raw = UserDefaults.standard.string(forKey: originKey) {
            let saved = NSPointFromString(raw)
            // Монитор, где стояла пилюля, могли отключить: такую позицию не «втягиваем», берём дефолт.
            if let vf = NSScreen.screens.map({ $0.visibleFrame }).first(where: { $0.intersects(CGRect(origin: saved, size: size)) }) {
                return CGPoint(x: min(max(saved.x, vf.minX), vf.maxX - size.width),
                               y: min(max(saved.y, vf.minY), vf.maxY - size.height))
            }
        }
        return defaultOrigin(in: main)
    }

    /// Правый верх, сразу под полосой меню, левее капсулы записи.
    private static func defaultOrigin(in vf: CGRect) -> CGPoint {
        CGPoint(x: vf.maxX - edgeInset - widgetWidth - 10 - size.width, y: vf.maxY - 8 - size.height)
    }

    private func saveOrigin() {
        guard let o = panel?.frame.origin else { return }
        UserDefaults.standard.set(NSStringFromPoint(o), forKey: Self.originKey)
    }
}

private final class PillView: NSView {
    var count = 0 { didSet { needsDisplay = true } }
    var onClick: (() -> Void)?
    var onMoved: (() -> Void)?

    private var downScreen = NSPoint.zero
    private var downOrigin = NSPoint.zero
    private var dragged = false

    override var isOpaque: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let mark = RoyArt.markImage(size: 40)
        mark.draw(in: NSRect(x: 2, y: 2, width: 40, height: 40))
        guard count > 0 else { return }
        let text = count > 99 ? "99+" : String(count)
        let attrs: [NSAttributedString.Key: Any] = [.font: BoardTheme.mono(10.5), .foregroundColor: BoardTheme.amberInk]
        let size = text.size(withAttributes: attrs)
        let w = max(size.width + 8, 16)
        let badge = NSRect(x: bounds.maxX - w, y: bounds.maxY - 16, width: w, height: 16)
        BoardTheme.amber.setFill()
        NSBezierPath(roundedRect: badge, xRadius: 8, yRadius: 8).fill()
        text.draw(at: NSPoint(x: badge.midX - size.width / 2, y: badge.midY - size.height / 2), withAttributes: attrs)
    }

    override func mouseDown(with event: NSEvent) {
        downScreen = NSEvent.mouseLocation
        downOrigin = window?.frame.origin ?? .zero
        dragged = false
    }
    override func mouseDragged(with event: NSEvent) {
        let now = NSEvent.mouseLocation
        let dx = now.x - downScreen.x, dy = now.y - downScreen.y
        if !dragged, hypot(dx, dy) < 3 { return }
        dragged = true
        window?.setFrameOrigin(NSPoint(x: downOrigin.x + dx, y: downOrigin.y + dy))
        onMoved?()
    }
    override func mouseUp(with event: NSEvent) {
        if dragged { onMoved?() } else { onClick?() }
    }
}
