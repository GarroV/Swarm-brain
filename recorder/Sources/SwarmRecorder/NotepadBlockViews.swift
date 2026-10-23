import AppKit
import RecorderKit

// Виды блоков блокнота доски: строка (тезис с кружком слева или пункт чек-листа с квадратом) и
// таблица. Данные — RecorderKit/NoteBlocks; здесь только ввод, клавиши и наведение. Строки
// и таблицы ничего не знают о соседях: Enter, Backspace в начале и стрелки они отдают наверх,
// в BoardNotepad, который перестраивает список.

enum NotepadStyle {
    static let bodySize: CGFloat = 14
    static let markerSide: CGFloat = 20
    static let rowGap: CGFloat = 2
    static let cellPadding: CGFloat = 6
}

/// Редактируемое NSTextField считает свою высоту под одну строку даже с переносом (замер:
/// 17 pt при тексте на две строки) — высоту берём у ячейки по ширине переноса.
final class WrappingField: NSTextField {
    override var intrinsicContentSize: NSSize {
        guard let cell, preferredMaxLayoutWidth > 0 else { return super.intrinsicContentSize }
        let size = cell.cellSize(forBounds: NSRect(x: 0, y: 0, width: preferredMaxLayoutWidth,
                                                   height: .greatestFiniteMagnitude))
        return NSSize(width: NSView.noIntrinsicMetric, height: ceil(size.height))
    }
}

/// Поле ввода блокнота: многострочное по переносу, без рамки и подложки.
func notepadField(size: CGFloat = NotepadStyle.bodySize) -> NSTextField {
    let f = WrappingField(wrappingLabelWithString: "")
    f.isEditable = true
    f.isSelectable = true
    f.drawsBackground = false
    f.isBordered = false
    f.focusRingType = .none
    f.font = BoardTheme.font(size)
    f.textColor = BoardTheme.ink
    f.cell?.wraps = true
    f.cell?.isScrollable = false
    f.translatesAutoresizingMaskIntoConstraints = false
    f.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    f.setContentHuggingPriority(.defaultLow, for: .horizontal)
    return f
}

/// Кружок тезиса — «радиокнопка» слева от строки: клик отмечает тезис сделанным (зелёный
/// кружок с галочкой, текст зачёркнут), повторный — снимает отметку.
final class ThesisDot: NSButton {
    var isOn = false { didSet { needsDisplay = true } }

    init(target: AnyObject?, action: Selector?) {
        super.init(frame: NSRect(x: 0, y: 0, width: NotepadStyle.markerSide, height: NotepadStyle.markerSide))
        isBordered = false
        title = ""
        setButtonType(.momentaryChange)
        focusRingType = .none
        self.target = target
        self.action = action
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: NotepadStyle.markerSide).isActive = true
        heightAnchor.constraint(equalToConstant: NotepadStyle.markerSide).isActive = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let r = NSRect(x: 3, y: 3, width: 14, height: 14)
        if isOn {
            BoardTheme.ok.setFill()
            NSBezierPath(ovalIn: r).fill()
            let tick = NSBezierPath()
            tick.move(to: NSPoint(x: 6.5, y: 10)); tick.line(to: NSPoint(x: 9, y: 7.5)); tick.line(to: NSPoint(x: 13.5, y: 12.5))
            NSColor(srgbRed: 0.07, green: 0.13, blue: 0.06, alpha: 1).setStroke()
            tick.lineWidth = 1.8; tick.lineCapStyle = .round; tick.lineJoinStyle = .round; tick.stroke()
        } else {
            let p = NSBezierPath(ovalIn: r.insetBy(dx: 1.5, dy: 1.5))
            p.lineWidth = 1.5
            BoardTheme.ink3.setStroke()
            p.stroke()
        }
    }
}

/// Кнопка «→ В задачу», проявляется при наведении на строку. Место под неё есть всегда —
/// прозрачность, а не `isHidden`: спрятанный вид стек выкидывает из раскладки, текст строки
/// становится шире и переносится заново — строки «ездили» под мышью (владелец 23.10.2026).
func notepadTaskArrow(target: AnyObject, action: Selector, tip: String) -> FlatButton {
    let b = FlatButton(title: "", fill: .clear, hover: BoardTheme.amberSoft, radius: 11, target: target, action: action)
    b.setSymbol("arrow.right", color: BoardTheme.amber, pointSize: 12, side: 22)
    b.toolTip = tip
    b.alphaValue = 0
    return b
}

/// Показать/спрятать кнопку наведения плавно, не трогая раскладку.
func setRevealed(_ v: NSView, _ on: Bool) {
    NSAnimationContext.runAnimationGroup { ctx in
        ctx.duration = 0.12
        v.animator().alphaValue = on ? 1 : 0
    }
}

/// Вид, у которого при наведении появляются свои кнопки и (если `glows`) мягкая подсветка:
/// градиент слева направо, гаснущий к правому краю, со скруглением — видно, на какой строке мышь.
class HoverView: NSView {
    var onHover: ((Bool) -> Void)?
    var glows = false
    private var tracking: NSTrackingArea?
    private var glowLayer: CAGradientLayer?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let t = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(t); tracking = t
    }
    override func mouseEntered(with event: NSEvent) { onHover?(true); glow(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false); glow(false) }

    private func glow(_ on: Bool) {
        guard glows else { return }
        wantsLayer = true
        let g = glowLayer ?? {
            let g = CAGradientLayer()
            g.startPoint = CGPoint(x: 0, y: 0.5)
            g.endPoint = CGPoint(x: 1, y: 0.5)
            g.cornerRadius = 8
            g.opacity = 0
            layer?.insertSublayer(g, at: 0)
            glowLayer = g
            return g
        }()
        paintGlow()
        g.frame = glowFrame
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = g.presentation()?.opacity ?? g.opacity
        a.duration = 0.15
        g.opacity = on ? 1 : 0
        g.add(a, forKey: "fade")
    }

    private var glowFrame: CGRect { bounds.insetBy(dx: -6, dy: 0) }

    private func paintGlow() {
        let c = BoardTheme.glow
        glowLayer?.colors = [LayerPaint.cg(c, in: self), LayerPaint.cg(c.withAlphaComponent(0), in: self)]
        glowLayer?.locations = [0.35, 1]
    }

    override func layout() {
        super.layout()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        glowLayer?.frame = glowFrame
        CATransaction.commit()
    }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); paintGlow() }
}

/// Команды строки, которые решает список целиком.
protocol NoteLineHost: AnyObject {
    func lineChanged(_ line: NoteLineView)
    /// Enter: текст до курсора остаётся в строке, текст после уходит в новую строку того же вида.
    func lineSplit(_ line: NoteLineView, before: String, after: String)
    /// Backspace в самом начале строки: слить с предыдущей (пустую — убрать).
    func lineBackspaceAtStart(_ line: NoteLineView)
    func lineMove(_ line: NoteLineView, by delta: Int)
    func lineFocused(_ line: NoteLineView)
    func lineToTask(_ text: String)
}

/// Строка блокнота: тезис или пункт чек-листа.
final class NoteLineView: HoverView, NSTextFieldDelegate {
    private(set) var block: NoteBlock
    weak var host: NoteLineHost?
    let field = notepadField()
    private let markerSlot = NSStackView()
    private var arrow: FlatButton!
    private var check: CheckBoxButton?
    private var dot: ThesisDot?

    init(block: NoteBlock, taskTip: String) {
        self.block = block
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        field.delegate = self
        arrow = notepadTaskArrow(target: self, action: #selector(arrowTapped), tip: taskTip)
        markerSlot.translatesAutoresizingMaskIntoConstraints = false
        let row = NSStackView(views: [markerSlot, field, arrow])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 6
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor, constant: NotepadStyle.rowGap),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -NotepadStyle.rowGap),
            arrow.widthAnchor.constraint(equalToConstant: 22),
        ])
        glows = true
        onHover = { [weak self] inside in self?.showArrow(inside) }
        apply()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    /// Ширина переноса известна только после раскладки: задаём её и раскладываем ещё раз,
    /// иначе длинный тезис обрезается одной строкой.
    override func layout() {
        super.layout()
        if field.preferredMaxLayoutWidth != field.frame.width {
            field.preferredMaxLayoutWidth = field.frame.width
            field.invalidateIntrinsicContentSize()
            super.layout()
        }
    }

    private var text: String { field.stringValue }

    private func apply() {
        markerSlot.arrangedSubviews.forEach { $0.removeFromSuperview() }
        check = nil
        dot = nil
        switch block {
        case .thesis(let t, let done):
            let d = ThesisDot(target: self, action: #selector(markerTapped))
            d.isOn = done
            markerSlot.addArrangedSubview(d)
            dot = d
            field.stringValue = t
        case .check(let t, let done):
            let c = CheckBoxButton(target: self, action: #selector(markerTapped))
            c.isStruck = done
            markerSlot.addArrangedSubview(c)
            check = c
            field.stringValue = t
        case .title(let t):
            field.stringValue = t   // название чек-листа — без маркера
        case .table:
            break
        }
        styleDone()
    }

    /// Сделанное — бледное и зачёркнутое; правке не мешает: зачёркивание держится и при наборе.
    private func styleDone() {
        let done = block.isDone
        var isTitle = false
        if case .title = block { isTitle = true }
        let attrs: [NSAttributedString.Key: Any] = [
            .font: BoardTheme.font(NotepadStyle.bodySize, isTitle ? .semibold : .regular),
            .foregroundColor: done ? BoardTheme.ink3 : BoardTheme.ink,
            .strikethroughStyle: done ? NSUnderlineStyle.single.rawValue : 0,
        ]
        field.textColor = done ? BoardTheme.ink3 : BoardTheme.ink
        field.attributedStringValue = NSAttributedString(string: field.stringValue, attributes: attrs)
        (field.currentEditor() as? NSTextView)?.typingAttributes = attrs
    }

    func setPlaceholder(_ p: String?) {
        field.placeholderAttributedString = p.map {
            NSAttributedString(string: $0, attributes: [.font: BoardTheme.font(NotepadStyle.bodySize),
                                                        .foregroundColor: BoardTheme.ink3])
        }
    }

    func focus(atEnd: Bool = true, caret: Int? = nil) {
        window?.makeFirstResponder(field)
        guard let editor = field.currentEditor() else { return }
        let len = (field.stringValue as NSString).length
        editor.selectedRange = NSRange(location: min(caret ?? (atEnd ? len : 0), len), length: 0)
    }

    private var arrowShown = false
    private func showArrow(_ inside: Bool) {
        let on = inside && !text.trimmingCharacters(in: .whitespaces).isEmpty
        guard on != arrowShown else { return }
        arrowShown = on
        setRevealed(arrow, on)
    }

    @objc private func arrowTapped() {
        guard arrowShown, let title = NotepadMarkup.taskTitle(from: text) else { return }
        host?.lineToTask(title)
    }

    /// Клик по кружку тезиса или квадрату пункта: отметить сделанным / снять отметку.
    @objc private func markerTapped() {
        block = block.withText(text).withDone(!block.isDone)
        check?.isStruck = block.isDone
        dot?.isOn = block.isDone
        styleDone()
        host?.lineChanged(self)
    }

    // MARK: ввод

    func controlTextDidBeginEditing(_ obj: Notification) { host?.lineFocused(self) }

    func controlTextDidChange(_ obj: Notification) {
        // «[] » в начале тезиса делает из него пункт чек-листа (как автосписок раньше).
        if case .thesis = block, let hit = NotepadMarkup.autoList(linePrefix: String(text.prefix(4))), hit.kind == .check,
           text.count >= hit.replacing {
            block = .check(String(text.dropFirst(hit.replacing)), done: false)
            apply()
            focus(atEnd: false)
        } else {
            block = block.withText(text)
        }
        field.invalidateIntrinsicContentSize()
        showArrow(true)
        host?.lineChanged(self)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
        let range = textView.selectedRange()
        let ns = textView.string as NSString
        switch sel {
        case #selector(NSResponder.insertNewline(_:)):
            let before = ns.substring(to: range.location)
            let after = ns.substring(from: NSMaxRange(range))
            block = block.withText(before)
            host?.lineSplit(self, before: before, after: after)
            return true
        case #selector(NSResponder.deleteBackward(_:)) where range.location == 0 && range.length == 0:
            host?.lineBackspaceAtStart(self)
            return true
        case #selector(NSResponder.moveUp(_:)):
            host?.lineMove(self, by: -1); return true
        case #selector(NSResponder.moveDown(_:)):
            host?.lineMove(self, by: 1); return true
        default:
            return false
        }
    }
}

/// Команды таблицы для списка.
protocol NoteTableHost: AnyObject {
    func tableChanged(_ table: NoteTableView)
    func tableRemove(_ table: NoteTableView)
    func tableFocused(_ table: NoteTableView)
    func lineToTask(_ text: String)
}

/// Таблица блокнота: ячейки с рамкой, у каждой строки при наведении — «→ В задачу»;
/// справа сверху при наведении — убрать таблицу. Enter — ячейка ниже (на последней строке
/// добавляет строку), Tab — следующая ячейка.
final class NoteTableView: HoverView, NSTextFieldDelegate {
    weak var host: NoteTableHost?
    private(set) var rows: [[String]]
    private var fields: [[NSTextField]] = []
    private var arrows: [FlatButton] = []
    private let grid = NSStackView()
    private var removeBtn: FlatButton!
    private let taskTip: String

    init(rows: [[String]], taskTip: String, removeTip: String) {
        self.rows = rows.isEmpty ? [[""]] : rows
        self.taskTip = taskTip
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        grid.orientation = .vertical
        grid.spacing = 0
        grid.alignment = .leading
        grid.translatesAutoresizingMaskIntoConstraints = false
        removeBtn = FlatButton(title: "", fill: .clear, radius: 11, target: self, action: #selector(removeTapped))
        removeBtn.setSymbol("trash", color: BoardTheme.ink3, pointSize: 11, side: 22)
        removeBtn.toolTip = removeTip
        removeBtn.isHidden = true
        addSubview(grid)
        addSubview(removeBtn)
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: trailingAnchor),
            grid.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            grid.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
            removeBtn.trailingAnchor.constraint(equalTo: trailingAnchor),
            removeBtn.bottomAnchor.constraint(equalTo: grid.topAnchor, constant: 22),
        ])
        onHover = { [weak self] inside in self?.removeBtn.isHidden = !inside; if !inside { self?.hideArrows() } }
        build()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    private var columns: Int { rows.map(\.count).max() ?? 1 }

    private func build() {
        grid.arrangedSubviews.forEach { $0.removeFromSuperview() }
        fields = []; arrows = []
        for (r, row) in rows.enumerated() {
            var rowFields: [NSTextField] = []
            let cells = NSStackView()
            cells.orientation = .horizontal
            cells.distribution = .fillEqually
            cells.spacing = -1   // соседние рамки ложатся одна на другую
            cells.translatesAutoresizingMaskIntoConstraints = false
            for c in 0..<columns {
                let f = notepadField(size: 13)
                f.stringValue = c < row.count ? row[c] : ""
                f.delegate = self
                let box = BoxView(fill: .clear, radius: 0, border: BoardTheme.cellLine)
                box.addSubview(f)
                let pad = NotepadStyle.cellPadding
                NSLayoutConstraint.activate([
                    f.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: pad),
                    f.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -pad),
                    f.topAnchor.constraint(equalTo: box.topAnchor, constant: 4),
                    f.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -4),
                ])
                cells.addArrangedSubview(box)
                rowFields.append(f)
            }
            let arrow = notepadTaskArrow(target: self, action: #selector(arrowTapped(_:)), tip: taskTip)
            arrow.tag = r
            let line = HoverView()
            line.glows = true
            line.translatesAutoresizingMaskIntoConstraints = false
            let stack = NSStackView(views: [cells, arrow])
            stack.orientation = .horizontal
            stack.spacing = 6
            stack.alignment = .centerY
            stack.translatesAutoresizingMaskIntoConstraints = false
            line.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: line.leadingAnchor),
                stack.trailingAnchor.constraint(equalTo: line.trailingAnchor),
                stack.topAnchor.constraint(equalTo: line.topAnchor, constant: r == 0 ? 0 : -1),
                stack.bottomAnchor.constraint(equalTo: line.bottomAnchor),
                arrow.widthAnchor.constraint(equalToConstant: 22),
            ])
            line.onHover = { [weak self, weak arrow] inside in
                guard let self, let arrow else { return }
                setRevealed(arrow, inside && NoteBlocks.taskTitle(row: self.rows[arrow.tag]) != nil)
            }
            grid.addArrangedSubview(line)
            line.widthAnchor.constraint(equalTo: grid.widthAnchor).isActive = true
            fields.append(rowFields)
            arrows.append(arrow)
        }
    }

    override func layout() {
        super.layout()
        var changed = false
        for f in fields.joined() where f.preferredMaxLayoutWidth != f.frame.width {
            f.preferredMaxLayoutWidth = f.frame.width
            f.invalidateIntrinsicContentSize()
            changed = true
        }
        if changed { super.layout() }
    }

    private func hideArrows() { arrows.forEach { setRevealed($0, false) } }

    private func position(of field: NSTextField) -> (row: Int, col: Int)? {
        for (r, row) in fields.enumerated() { if let c = row.firstIndex(of: field) { return (r, c) } }
        return nil
    }

    func focusFirstCell() { if let f = fields.first?.first { window?.makeFirstResponder(f) } }

    private func focus(_ r: Int, _ c: Int) {
        guard r < fields.count, c < fields[r].count else { return }
        window?.makeFirstResponder(fields[r][c])
    }

    @objc private func arrowTapped(_ sender: FlatButton) {
        guard sender.alphaValue > 0.5, sender.tag < rows.count, let title = NoteBlocks.taskTitle(row: rows[sender.tag]) else { return }
        host?.lineToTask(title)
    }

    @objc private func removeTapped() { host?.tableRemove(self) }

    func controlTextDidBeginEditing(_ obj: Notification) { host?.tableFocused(self) }

    func controlTextDidChange(_ obj: Notification) {
        guard let f = obj.object as? NSTextField, let (r, c) = position(of: f) else { return }
        var row = rows[r]
        while row.count <= c { row.append("") }
        row[c] = f.stringValue
        rows[r] = row
        f.invalidateIntrinsicContentSize()
        host?.tableChanged(self)
    }

    private func addRow(focusColumn c: Int) {
        rows.append(Array(repeating: "", count: columns))
        build()
        host?.tableChanged(self)
        focus(rows.count - 1, c)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
        guard let f = control as? NSTextField, let (r, c) = position(of: f) else { return false }
        switch sel {
        case #selector(NSResponder.insertNewline(_:)):
            if r + 1 < rows.count { focus(r + 1, c) } else { addRow(focusColumn: c) }
            return true
        case #selector(NSResponder.insertTab(_:)):
            if c + 1 < columns { focus(r, c + 1) } else if r + 1 < rows.count { focus(r + 1, 0) } else { addRow(focusColumn: 0) }
            return true
        case #selector(NSResponder.insertBacktab(_:)):
            if c > 0 { focus(r, c - 1) } else if r > 0 { focus(r - 1, columns - 1) }
            return true
        default:
            return false
        }
    }
}
