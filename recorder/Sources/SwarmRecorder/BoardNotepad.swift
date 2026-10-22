import AppKit
import RecorderKit

// Блокнот дня на доске «Сегодня»: простой rich-text редактор. Текст хранится ТОЛЬКО на этом Mac
// (`~/Library/Application Support/SwarmRecorder/notepad.rtf`), в Swarm не уходит и на сервере не
// лежит (решение владельца 22.10.2026, п. 10 и 14 docs/decisions/2026-10-22-bumblebee-hub.md).
// Сам не обнуляется: ни на следующий день, ни при ошибке чтения — только кнопка «Очистить».
//
// Списки — символы в начале строки («• », «☐ », «1. »), логика распознавания и продолжения —
// в RecorderKit/NotepadMarkup (под тестом). Таблица — NSTextTable 3×3, поэтому текстовая система
// собирается вручную на TextKit 1: TextKit 2 таблиц не умеет.

/// Текстовое поле блокнота: вставка — только простым текстом (чужие цвета на тёмной подложке
/// превращаются в нечитаемое).
private final class NotepadTextView: NSTextView {
    override func paste(_ sender: Any?) { pasteAsPlainText(sender) }
}

final class BoardNotepad: NSObject, NSTextViewDelegate {
    var lang: String { didSet { relabel() } }
    /// «→ В задачу»: заголовок будущей задачи.
    var onToTask: ((String) -> Void)?

    let view: NSView

    private let textView: NotepadTextView
    private let scroll = NSScrollView()
    private let header = boardLabel("", size: 10.5, weight: .semibold, color: BoardTheme.ink3)
    private var padHeight: NSLayoutConstraint!
    private let toolbar = boardStack(.horizontal, spacing: 2)
    private let confirmRow = boardStack(.horizontal, spacing: 8)
    private let confirmLabel = boardLabel("", size: 12, color: BoardTheme.ink2)
    private var confirmYes: FlatButton!
    private var confirmNo: FlatButton!
    private var headingBtn: FlatButton!, bulletBtn: FlatButton!, numberBtn: FlatButton!
    private var checkBtn: FlatButton!, tableBtn: FlatButton!, clearBtn: FlatButton!, toTaskBtn: FlatButton!
    private let footer = boardLabel("", size: 11, color: BoardTheme.ink3)
    private let placeholder = boardLabel("", size: 13, color: BoardTheme.ink3)

    private let fileURL: URL
    private var saveTimer: Timer?
    private var dirty = false
    private var applyingEdit = false
    private var footerResetTimer: Timer?

    private static let bodySize: CGFloat = 13
    private static let headingSize: CGFloat = 15

    static var defaultFileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SwarmRecorder", isDirectory: true)
            .appendingPathComponent("notepad.rtf")
    }

    private var bodyAttributes: [NSAttributedString.Key: Any] {
        let p = NSMutableParagraphStyle(); p.lineSpacing = 2
        return [.font: BoardTheme.font(Self.bodySize), .foregroundColor: BoardTheme.ink, .paragraphStyle: p]
    }

    init(lang: String, height: CGFloat, fileURL: URL = BoardNotepad.defaultFileURL) {
        self.lang = lang
        self.fileURL = fileURL
        // TextKit 1 вручную: без этого NSTextView на macOS 13+ берёт TextKit 2, где таблиц нет.
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: 400, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        textView = NotepadTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 100), textContainer: container)
        view = NSView()
        super.init()
        build(height: height)
        loadFromDisk()
        relabel()
        NotificationCenter.default.addObserver(self, selector: #selector(flushNow),
                                               name: NSApplication.willTerminateNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    // MARK: сборка

    private func build(height: CGFloat) {
        textView.isRichText = true
        textView.allowsUndo = true
        textView.importsGraphics = false
        textView.usesFontPanel = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.drawsBackground = false
        textView.textColor = BoardTheme.ink
        textView.insertionPointColor = BoardTheme.amber
        textView.selectedTextAttributes = [.backgroundColor: BoardTheme.amber.withAlphaComponent(0.35)]
        textView.typingAttributes = bodyAttributes
        textView.textContainerInset = NSSize(width: 4, height: 4)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.delegate = self

        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.scrollerStyle = .overlay
        scroll.translatesAutoresizingMaskIntoConstraints = false

        let pad = BoxView(fill: BoardTheme.padBg, radius: 10, border: BoardTheme.line)
        pad.addSubview(scroll)
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        pad.addSubview(placeholder)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: pad.leadingAnchor, constant: 8),
            scroll.trailingAnchor.constraint(equalTo: pad.trailingAnchor, constant: -8),
            scroll.topAnchor.constraint(equalTo: pad.topAnchor, constant: 6),
            scroll.bottomAnchor.constraint(equalTo: pad.bottomAnchor, constant: -6),
            placeholder.leadingAnchor.constraint(equalTo: pad.leadingAnchor, constant: 16),
            placeholder.topAnchor.constraint(equalTo: pad.topAnchor, constant: 12),
        ])
        padHeight = pad.heightAnchor.constraint(equalToConstant: height)
        padHeight.isActive = true

        headingBtn = tool("H", #selector(headingTapped), bold: true)
        bulletBtn = tool("•", #selector(bulletTapped))
        numberBtn = tool("1.", #selector(numberedTapped))
        checkBtn = tool("☐", #selector(checkTapped))
        tableBtn = tool("▦", #selector(tableTapped))
        clearBtn = FlatButton(title: "", fill: .clear, color: BoardTheme.ink2, size: 12, target: self, action: #selector(clearTapped))
        toTaskBtn = FlatButton(title: "", fill: BoardTheme.amberSoft, hover: BoardTheme.amber.withAlphaComponent(0.28),
                               color: BoardTheme.amber, size: 12, target: self, action: #selector(toTaskTapped))
        let spacer = boardSpacer()
        for v in [headingBtn!, bulletBtn!, numberBtn!, checkBtn!, tableBtn!, spacer, clearBtn!, toTaskBtn!] as [NSView] {
            toolbar.addArrangedSubview(v)
        }
        toolbar.setCustomSpacing(8, after: clearBtn)

        confirmYes = FlatButton(title: "", fill: BoardTheme.rec.withAlphaComponent(0.85), hover: BoardTheme.rec,
                                color: .white, size: 12, target: self, action: #selector(clearConfirmed))
        confirmNo = FlatButton(title: "", target: self, action: #selector(clearCancelled))
        confirmRow.addArrangedSubview(confirmLabel)
        confirmRow.addArrangedSubview(confirmYes)
        confirmRow.addArrangedSubview(confirmNo)
        confirmRow.isHidden = true

        let headRow = paddedRow(insets: NSEdgeInsets(top: 10, left: 14, bottom: 6, right: 14), views: [header])
        let toolWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 0, left: 10, bottom: 6, right: 10), views: [toolbar, confirmRow])
        let padWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 0, left: 12, bottom: 4, right: 12), views: [pad])
        let footWrap = paddedRow(insets: NSEdgeInsets(top: 0, left: 14, bottom: 10, right: 14), views: [footer])

        let root = boardStack(.vertical, views: [headRow, toolWrap, padWrap, footWrap])
        for v in [headRow, toolWrap, padWrap, footWrap] { v.setContentHuggingPriority(.required, for: .vertical) }
        toolbar.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            toolbar.widthAnchor.constraint(equalTo: toolWrap.widthAnchor, constant: -20),
            confirmRow.widthAnchor.constraint(equalTo: toolWrap.widthAnchor, constant: -20),
            pad.widthAnchor.constraint(equalTo: padWrap.widthAnchor, constant: -24),
        ])
    }

    private func tool(_ title: String, _ action: Selector, bold: Bool = false) -> FlatButton {
        let b = FlatButton(title: title, fill: .clear, color: BoardTheme.ink2, size: 13,
                           weight: bold ? .bold : .regular, radius: 6, target: self, action: action)
        return b
    }

    func setHeight(_ h: CGFloat) { padHeight.constant = h }

    func relabel() {
        header.stringValue = BoardL10n.text("notes.header", lang: lang).uppercased()
        placeholder.stringValue = BoardL10n.text("notes.placeholder", lang: lang)
        headingBtn.toolTip = BoardL10n.text("notes.heading", lang: lang)
        bulletBtn.toolTip = BoardL10n.text("notes.bullets", lang: lang)
        numberBtn.toolTip = BoardL10n.text("notes.numbered", lang: lang)
        checkBtn.toolTip = BoardL10n.text("notes.check", lang: lang)
        tableBtn.toolTip = BoardL10n.text("notes.table", lang: lang)
        clearBtn.setTitle(BoardL10n.text("notes.clear", lang: lang), color: BoardTheme.ink2, size: 12)
        toTaskBtn.setTitle(BoardL10n.text("notes.toTask", lang: lang), color: BoardTheme.amber, size: 12)
        toTaskBtn.toolTip = BoardL10n.text("notes.toTask.tip", lang: lang)
        confirmLabel.stringValue = BoardL10n.text("notes.clear.ask", lang: lang)
        confirmYes.setTitle(BoardL10n.text("notes.clear.yes", lang: lang), color: .white, size: 12)
        confirmNo.setTitle(BoardL10n.text("notes.clear.no", lang: lang), color: BoardTheme.ink, size: 12)
        resetFooter()
        updatePlaceholder()
    }

    private func updatePlaceholder() { placeholder.isHidden = textView.textStorage?.length ?? 0 > 0 }

    private func resetFooter() {
        footer.stringValue = BoardL10n.text("notes.footer", lang: lang)
        footer.textColor = BoardTheme.ink3
    }

    private func flashFooter(_ text: String) {
        footer.stringValue = text
        footer.textColor = BoardTheme.amber
        footerResetTimer?.invalidate()
        footerResetTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in self?.resetFooter() }
    }

    // MARK: хранение

    private func loadFromDisk() {
        let url = fileURL
        guard let data = try? Data(contentsOf: url) else { return }   // файла нет — чистый блокнот
        do {
            let text = try NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf],
                                              documentAttributes: nil)
            textView.textStorage?.setAttributedString(text)
        } catch {
            // Не затираем: файл с текстом человека откладываем рядом, блокнот стартует пустым.
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let parked = url.deletingLastPathComponent().appendingPathComponent("notepad-unreadable-\(stamp).rtf")
            try? FileManager.default.moveItem(at: url, to: parked)
            NSLog("SwarmRecorder: блокнот доски не прочитался (\(error)) — файл отложен в \(parked.path)")
        }
    }

    private func scheduleSave() {
        dirty = true
        updatePlaceholder()
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: false) { [weak self] _ in self?.flush() }
    }

    @objc private func flushNow() { flush() }

    /// Записать на диск сейчас (закрытие панели, выход из приложения).
    func flush() {
        saveTimer?.invalidate(); saveTimer = nil
        guard dirty, let storage = textView.textStorage else { return }
        let url = fileURL
        if storage.length == 0 {
            try? FileManager.default.removeItem(at: url)
            dirty = false
            return
        }
        do {
            let data = try storage.data(from: NSRange(location: 0, length: storage.length),
                                        documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            dirty = false
        } catch {
            NSLog("SwarmRecorder: блокнот доски не сохранился: \(error)")   // dirty остаётся — повторим при следующей правке
        }
    }

    // MARK: ввод — автосписки и Enter

    func textView(_ tv: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
        guard !applyingEdit, !tv.hasMarkedText(), let text, range.length == 0 else { return true }
        let ns = tv.string as NSString
        let lineStart = ns.paragraphRange(for: NSRange(location: range.location, length: 0)).location

        if text == " " {
            let typed = ns.substring(with: NSRange(location: lineStart, length: range.location - lineStart)) + " "
            guard let hit = NotepadMarkup.autoList(linePrefix: typed) else { return true }
            replace(NSRange(location: lineStart, length: range.location - lineStart), with: hit.kind.marker)
            return false
        }
        if text == "\n" {
            let para = ns.paragraphRange(for: NSRange(location: range.location, length: 0))
            let line = ns.substring(with: para).trimmingCharacters(in: .newlines)
            switch NotepadMarkup.continuation(forLine: line) {
            case .insert(let marker):
                replace(range, with: "\n" + marker)
                return false
            case .endList(let n) where range.location == lineStart + (line as NSString).length:
                replace(NSRange(location: lineStart, length: n), with: "")
                return false
            default:
                break
            }
            if headingFont(at: lineStart) {
                replace(range, with: "\n")
                tv.typingAttributes = bodyAttributes
                return false
            }
        }
        return true
    }

    /// Правка через `insertText`: undo, делегат и сохранение работают как при обычном наборе.
    private func replace(_ range: NSRange, with string: String) {
        applyingEdit = true
        textView.insertText(string, replacementRange: range)
        applyingEdit = false
    }

    private func headingFont(at location: Int) -> Bool {
        guard let storage = textView.textStorage, location < storage.length,
              let f = storage.attribute(.font, at: location, effectiveRange: nil) as? NSFont else { return false }
        return f.pointSize > Self.bodySize + 0.5
    }

    func textDidChange(_ notification: Notification) { scheduleSave() }

    // MARK: панель инструментов

    @objc private func headingTapped() {
        guard let storage = textView.textStorage else { return }
        let ns = textView.string as NSString
        let para = ns.paragraphRange(for: textView.selectedRange())
        guard para.length > 0, textView.shouldChangeText(in: para, replacementString: nil) else { return }
        let makeHeading = !headingFont(at: para.location)
        let font = makeHeading ? BoardTheme.font(Self.headingSize, .bold) : BoardTheme.font(Self.bodySize)
        storage.beginEditing()
        storage.addAttribute(.font, value: font, range: para)
        storage.endEditing()
        textView.didChangeText()
        window?.makeFirstResponder(textView)
    }

    @objc private func bulletTapped() { toggleList(.bullet) }
    @objc private func numberedTapped() { toggleList(.numbered(1)) }
    @objc private func checkTapped() { toggleList(.check) }

    private func sameKind(_ a: NotepadMarkup.Kind?, _ b: NotepadMarkup.Kind) -> Bool {
        guard let a else { return false }
        switch (a, b) {
        case (.bullet, .bullet), (.check, .check), (.numbered, .numbered): return true
        default: return false
        }
    }

    /// Ставит маркер списка на каждую строку выделения; если он уже стоит на всех — снимает.
    private func toggleList(_ kind: NotepadMarkup.Kind) {
        let ns = textView.string as NSString
        let para = ns.paragraphRange(for: textView.selectedRange())
        var starts: [Int] = []
        var idx = para.location
        repeat {
            let r = ns.paragraphRange(for: NSRange(location: idx, length: 0))
            starts.append(r.location)
            idx = max(NSMaxRange(r), idx + 1)
        } while idx < NSMaxRange(para)
        func line(at start: Int) -> String {
            ns.substring(with: ns.paragraphRange(for: NSRange(location: start, length: 0))).trimmingCharacters(in: .newlines)
        }
        let allHave = starts.allSatisfy { sameKind(NotepadMarkup.kind(ofLine: line(at: $0)), kind) }
        textView.undoManager?.beginUndoGrouping()
        for (i, start) in starts.enumerated().reversed() {
            let existing = NotepadMarkup.markerLength(ofLine: line(at: start))
            let marker: String
            switch kind {
            case .numbered: marker = "\(i + 1). "
            default: marker = kind.marker
            }
            replace(NSRange(location: start, length: existing), with: allHave ? "" : marker)
        }
        textView.undoManager?.endUndoGrouping()
        window?.makeFirstResponder(textView)
    }

    @objc private func tableTapped() {
        let sel = textView.selectedRange()
        let ns = textView.string as NSString
        let atLineStart = sel.location == 0 || ns.character(at: sel.location - 1) == 10
        let table = Self.tableText(rows: 3, columns: 3, body: bodyAttributes)
        let out = NSMutableAttributedString()
        if !atLineStart { out.append(NSAttributedString(string: "\n", attributes: bodyAttributes)) }
        out.append(table)
        applyingEdit = true
        textView.insertText(out, replacementRange: sel)
        applyingEdit = false
        window?.makeFirstResponder(textView)
    }

    /// Таблица `rows × columns`: каждая ячейка — абзац с блоком NSTextTableBlock; после таблицы
    /// остаётся обычная пустая строка, чтобы под ней можно было писать.
    static func tableText(rows: Int, columns: Int, body: [NSAttributedString.Key: Any]) -> NSAttributedString {
        let table = NSTextTable()
        table.numberOfColumns = columns
        table.collapsesBorders = true
        table.layoutAlgorithm = .automaticLayoutAlgorithm
        let out = NSMutableAttributedString()
        for r in 0..<rows {
            for c in 0..<columns {
                let block = NSTextTableBlock(table: table, startingRow: r, rowSpan: 1, startingColumn: c, columnSpan: 1)
                block.setBorderColor(NSColor(white: 1, alpha: 0.18))
                block.setWidth(1, type: .absoluteValueType, for: .border)
                block.setWidth(4, type: .absoluteValueType, for: .padding)
                block.setValue(100 / Double(columns), type: .percentageValueType, for: .width)
                let style = NSMutableParagraphStyle()
                if let base = body[.paragraphStyle] as? NSParagraphStyle { style.lineSpacing = base.lineSpacing }
                style.textBlocks = [block]
                var attrs = body
                attrs[.paragraphStyle] = style
                out.append(NSAttributedString(string: "\n", attributes: attrs))
            }
        }
        out.append(NSAttributedString(string: "\n", attributes: body))
        return out
    }

    @objc private func clearTapped() {
        toolbar.isHidden = true
        confirmRow.isHidden = false
    }
    @objc private func clearCancelled() {
        confirmRow.isHidden = true
        toolbar.isHidden = false
    }
    @objc private func clearConfirmed() {
        textView.textStorage?.setAttributedString(NSAttributedString())
        textView.typingAttributes = bodyAttributes
        textView.undoManager?.removeAllActions()
        scheduleSave()
        flush()
        clearCancelled()
    }

    @objc private func toTaskTapped() {
        let ns = textView.string as NSString
        let sel = textView.selectedRange()
        let source = sel.length > 0 ? ns.substring(with: sel) : ns.substring(with: ns.paragraphRange(for: sel))
        guard let title = NotepadMarkup.taskTitle(from: source) else {
            flashFooter(BoardL10n.text("notes.toTask.empty", lang: lang))
            return
        }
        onToTask?(title)
    }

    private var window: NSWindow? { view.window }
}
