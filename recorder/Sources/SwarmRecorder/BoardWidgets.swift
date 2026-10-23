import AppKit
import RecorderKit

// Мелкие самодельные виджеты и палитра доски «Сегодня». Тёмная графитовая панель с янтарём —
// тот же язык, что у виджета записи и живых заметок (RoyArt.amber, MarkRenderer.graphite).
// Тема — системная (решение владельца 23.10.2026): каждый цвет динамический, пара тёмный/светлый.
// Цвета слоёв (`layer.backgroundColor`) сами не перекрашиваются — виды ниже пересчитывают их в
// `viewDidChangeEffectiveAppearance` через `LayerPaint`.

enum BoardTheme {
    private static func pair(dark: NSColor, light: NSColor) -> NSColor {
        NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light }
    }
    static let panelBg = pair(dark: NSColor(srgbRed: 0.09, green: 0.075, blue: 0.05, alpha: 1),
                              light: NSColor(srgbRed: 0.985, green: 0.975, blue: 0.955, alpha: 1))
    static let ink = pair(dark: NSColor(white: 1, alpha: 0.94), light: NSColor(white: 0, alpha: 0.86))
    static let ink2 = pair(dark: NSColor(white: 1, alpha: 0.58), light: NSColor(white: 0, alpha: 0.56))
    static let ink3 = pair(dark: NSColor(white: 1, alpha: 0.36), light: NSColor(white: 0, alpha: 0.36))
    static let line = pair(dark: NSColor(white: 1, alpha: 0.09), light: NSColor(white: 0, alpha: 0.09))
    static let cellLine = pair(dark: NSColor(white: 1, alpha: 0.16), light: NSColor(white: 0, alpha: 0.16))
    static let fill = pair(dark: NSColor(white: 1, alpha: 0.06), light: NSColor(white: 0, alpha: 0.045))
    static let fillHover = pair(dark: NSColor(white: 1, alpha: 0.11), light: NSColor(white: 0, alpha: 0.08))
    /// Подсветка строки под мышью (начало градиента).
    static let glow = pair(dark: NSColor(white: 1, alpha: 0.07), light: NSColor(white: 0, alpha: 0.05))
    // Янтарь на светлом фоне темнее: исходный как текст на белом почти не читается.
    static let amber = pair(dark: RoyArt.amber, light: NSColor(srgbRed: 0.74, green: 0.45, blue: 0.04, alpha: 1))
    static let amberSoft = pair(dark: RoyArt.amber.withAlphaComponent(0.16), light: RoyArt.amber.withAlphaComponent(0.2))
    static let amberInk = NSColor(srgbRed: 0.10, green: 0.08, blue: 0.03, alpha: 1)
    static let rec = NSColor(srgbRed: 0.94, green: 0.31, blue: 0.24, alpha: 1)
    static let ok = NSColor(srgbRed: 0.44, green: 0.75, blue: 0.45, alpha: 1)
    static let padBg = pair(dark: NSColor(white: 0, alpha: 0.22), light: NSColor(white: 0, alpha: 0.04))

    static func font(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> NSFont {
        .systemFont(ofSize: size, weight: weight)
    }
    static func mono(_ size: CGFloat) -> NSFont { .monospacedSystemFont(ofSize: size, weight: .regular) }
}

/// Цвет слоя в теме вида: динамический NSColor → CGColor под `effectiveAppearance` вида.
enum LayerPaint {
    static func cg(_ color: NSColor, in view: NSView) -> CGColor {
        var out = color.cgColor
        view.effectiveAppearance.performAsCurrentDrawingAppearance { out = color.cgColor }
        return out
    }
}

func boardLabel(_ text: String = "", size: CGFloat = 13, weight: NSFont.Weight = .regular,
                color: NSColor = BoardTheme.ink, mono: Bool = false) -> NSTextField {
    let f = NSTextField(labelWithString: text)
    f.font = mono ? BoardTheme.mono(size) : BoardTheme.font(size, weight)
    f.textColor = color
    f.lineBreakMode = .byTruncatingTail
    f.maximumNumberOfLines = 1
    f.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    f.translatesAutoresizingMaskIntoConstraints = false
    return f
}

/// Растяжка для горизонтальных стеков: единственный вид с самым низким приоритетом сжатия забирает
/// свободное место. Без явной растяжки раскладка неоднозначна, и содержимое строки «уезжает» вправо.
func boardSpacer() -> NSView {
    let v = NSView()
    v.translatesAutoresizingMaskIntoConstraints = false
    v.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .horizontal)
    v.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(1), for: .horizontal)
    return v
}

extension NSTextField {
    /// Подпись держится по размеру текста (счётчики, время): растягивается другой вид строки.
    func hugText() -> NSTextField {
        setContentHuggingPriority(.required, for: .horizontal)
        return self
    }
}

/// Плоская кнопка со скруглённой подложкой.
final class FlatButton: NSButton {
    private let normalFill: NSColor
    private let hoverFill: NSColor
    private var tracking: NSTrackingArea?

    init(title: String, fill: NSColor = BoardTheme.fill, hover: NSColor = BoardTheme.fillHover,
         color: NSColor = BoardTheme.ink, size: CGFloat = 12.5, weight: NSFont.Weight = .regular,
         radius: CGFloat = 7, target: AnyObject?, action: Selector?) {
        normalFill = fill
        hoverFill = hover
        super.init(frame: .zero)
        isBordered = false
        bezelStyle = .regularSquare
        wantsLayer = true
        layer?.cornerRadius = radius
        self.target = target
        self.action = action
        setButtonType(.momentaryChange)
        focusRingType = .none
        translatesAutoresizingMaskIntoConstraints = false
        setContentHuggingPriority(.required, for: .horizontal)
        setContentCompressionResistancePriority(.required, for: .horizontal)
        setTitle(title, color: color, size: size, weight: weight)
        paint()
    }

    private var hovered = false
    private func paint() { layer?.backgroundColor = LayerPaint.cg(hovered ? hoverFill : normalFill, in: self) }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); paint() }
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    func setTitle(_ t: String, color: NSColor, size: CGFloat = 12.5, weight: NSFont.Weight = .regular) {
        attributedTitle = NSAttributedString(string: t, attributes: [
            .font: BoardTheme.font(size, weight), .foregroundColor: color])
        invalidateIntrinsicContentSize()
    }

    /// Кнопка-значок: SF Symbol вместо текста, фиксированный квадрат `side`.
    func setSymbol(_ name: String, color: NSColor, pointSize: CGFloat = 13, side: CGFloat = 26) {
        title = ""
        // Шаблон + contentTintColor: цвет значка перекрашивается вместе с темой (палитра в
        // конфигурации символа запекается в момент создания).
        let conf = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .regular)
        let img = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(conf)
        img?.isTemplate = true
        image = img
        contentTintColor = color
        imagePosition = .imageOnly
        symbolSide = side
        invalidateIntrinsicContentSize()
    }
    private var symbolSide: CGFloat?

    override var intrinsicContentSize: NSSize {
        if let side = symbolSide { return NSSize(width: side, height: side) }
        let s = super.intrinsicContentSize
        return NSSize(width: s.width + 16, height: max(s.height, 26))
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways], owner: self, userInfo: nil)
        addTrackingArea(t); tracking = t
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; paint() }
    override func mouseExited(with event: NSEvent) { hovered = false; paint() }
}

/// Чекбокс строки задачи: пустой квадрат / зелёный с галочкой.
final class CheckBoxButton: NSButton {
    var isStruck = false { didSet { needsDisplay = true } }

    init(target: AnyObject?, action: Selector?) {
        super.init(frame: NSRect(x: 0, y: 0, width: 20, height: 20))
        isBordered = false
        title = ""
        setButtonType(.momentaryChange)
        focusRingType = .none
        self.target = target
        self.action = action
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: 20).isActive = true
        heightAnchor.constraint(equalToConstant: 20).isActive = true
        setContentHuggingPriority(.required, for: .horizontal)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let box = NSRect(x: 2, y: 2, width: 16, height: 16)
        let path = NSBezierPath(roundedRect: box, xRadius: 5, yRadius: 5)
        if isStruck {
            BoardTheme.ok.setFill(); path.fill()
            let tick = NSBezierPath()
            tick.move(to: NSPoint(x: 6, y: 10)); tick.line(to: NSPoint(x: 9, y: 7)); tick.line(to: NSPoint(x: 14, y: 13))
            NSColor(srgbRed: 0.07, green: 0.13, blue: 0.06, alpha: 1).setStroke()
            tick.lineWidth = 2; tick.lineCapStyle = .round; tick.lineJoinStyle = .round; tick.stroke()
        } else {
            BoardTheme.ink3.setStroke()
            path.lineWidth = 1.5
            NSBezierPath(roundedRect: box.insetBy(dx: 0.75, dy: 0.75), xRadius: 4.5, yRadius: 4.5).stroke()
        }
    }
}

/// Красная пульсирующая точка записи.
final class RecDotView: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = BoardTheme.rec.cgColor
        layer?.cornerRadius = 5
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: 10).isActive = true
        heightAnchor.constraint(equalToConstant: 10).isActive = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    func setPulsing(_ on: Bool) {
        layer?.removeAllAnimations()
        guard on else { return }
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = 1; a.toValue = 0.3; a.duration = 0.6; a.autoreverses = true; a.repeatCount = .infinity
        layer?.add(a, forKey: "pulse")
    }
}

/// Контейнер с подложкой и скруглением (карточки, колонки блокнота).
final class BoxView: NSView {
    private let fill: NSColor
    private let border: NSColor?

    init(fill: NSColor, radius: CGFloat = 10, border: NSColor? = nil) {
        self.fill = fill
        self.border = border
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = radius
        if border != nil { layer?.borderWidth = 1 }
        translatesAutoresizingMaskIntoConstraints = false
        paint()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    private func paint() {
        layer?.backgroundColor = LayerPaint.cg(fill, in: self)
        if let border { layer?.borderColor = LayerPaint.cg(border, in: self) }
    }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); paint() }
}

/// Вертикальная разделительная/горизонтальная линия 1 pt.
func boardDivider(vertical: Bool) -> NSView {
    let v = BoxView(fill: BoardTheme.line, radius: 0)
    if vertical { v.widthAnchor.constraint(equalToConstant: 1).isActive = true }
    else { v.heightAnchor.constraint(equalToConstant: 1).isActive = true }
    return v
}

/// Стек, в котором вертикальные дети всегда занимают всю ширину (за вычетом отступов).
/// `NSStackView.alignment = .width` для этого не годится: он выравнивает детей по самому широкому,
/// а не по ширине контейнера, и строки «уезжают» вправо.
final class FillStack: NSStackView {
    override func addArrangedSubview(_ view: NSView) {
        super.addArrangedSubview(view)
        guard orientation == .vertical else { return }
        view.widthAnchor.constraint(equalTo: widthAnchor, constant: -(edgeInsets.left + edgeInsets.right)).isActive = true
    }
}

func boardStack(_ axis: NSUserInterfaceLayoutOrientation, spacing: CGFloat = 0,
                insets: NSEdgeInsets = NSEdgeInsets(), views: [NSView] = []) -> NSStackView {
    let s = FillStack()
    s.orientation = axis
    s.spacing = spacing
    s.edgeInsets = insets
    s.alignment = axis == .vertical ? .leading : .centerY
    s.distribution = .fill
    s.translatesAutoresizingMaskIntoConstraints = false
    for v in views { s.addArrangedSubview(v) }
    return s
}

/// Горизонтальная строка с отступами со всех сторон. Вертикальные отступы горизонтального
/// NSStackView AppKit не соблюдает (строка садится вплотную к краю), поэтому строка кладётся
/// в вертикальную обёртку, у которой отступы работают.
func paddedRow(spacing: CGFloat = 0, insets: NSEdgeInsets, alignment: NSLayoutConstraint.Attribute = .centerY,
               views: [NSView]) -> NSStackView {
    let row = boardStack(.horizontal, spacing: spacing, views: views)
    row.alignment = alignment
    return boardStack(.vertical, insets: insets, views: [row])
}
