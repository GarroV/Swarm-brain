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

final class BoardNotepad: NSObject, NSTextViewDelegate, NSTextStorageDelegate, NSLayoutManagerDelegate {
    var lang: String { didSet { relabel() } }
    /// «→ В задачу»: заголовок будущей задачи.
    var onToTask: ((String) -> Void)?

    let view: NSView

    private let textView: NotepadTextView
    private let scroll = NSScrollView()
    private var padHeight: NSLayoutConstraint!
    // Вид — как у «Заметок»: текст лежит прямо на панели, без рамки; сверху капсула значков и
    // дата последней правки. Пояснение «хранится только на этом Mac» — у замка рядом с датой.
    private let toolbar = boardStack(.horizontal, spacing: 6)
    private let toolCapsule = boardStack(.horizontal, spacing: 0)
    private let confirmRow = boardStack(.horizontal, spacing: 8)
    private let confirmLabel = boardLabel("", size: 12, color: BoardTheme.ink2)
    private var confirmYes: FlatButton!
    private var confirmNo: FlatButton!
    private var headingBtn: FlatButton!, bulletBtn: FlatButton!, numberBtn: FlatButton!
    private var checkBtn: FlatButton!, tableBtn: FlatButton!, clearBtn: FlatButton!, toTaskBtn: FlatButton!
    private let stamp = boardLabel("", size: 11, color: BoardTheme.ink3)
    private let lock = NSImageView()
    private let footer = boardLabel("", size: 11, color: BoardTheme.amber)
    private let placeholder = boardLabel("", size: BoardNotepad.bodySize, color: BoardTheme.ink3)

    private let fileURL: URL
    private var saveTimer: Timer?
    private var dirty = false
    private var applyingEdit = false
    private var footerResetTimer: Timer?
    /// Когда текст правили последний раз: дата файла на диске, потом — момент сохранения.
    private var editedAt: Date?

    private static let bodySize: CGFloat = 14
    private static let headingSize: CGFloat = 19
    private static let textInset = NSSize(width: 2, height: 4)

    static var defaultFileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SwarmRecorder", isDirectory: true)
            .appendingPathComponent("notepad.rtf")
    }

    /// Высота строки задана жёстко, чтобы строки с маркерами из запасного шрифта не скакали.
    private static func paragraphStyle(heading: Bool = false, indent: CGFloat = 0) -> NSParagraphStyle {
        let p = NSMutableParagraphStyle()
        let lineHeight = ((heading ? headingSize : bodySize) * 1.36).rounded()
        p.minimumLineHeight = lineHeight
        p.maximumLineHeight = lineHeight
        p.paragraphSpacing = heading ? 6 : 1
        p.paragraphSpacingBefore = heading ? 2 : 0
        p.headIndent = indent
        return p
    }

    private var bodyAttributes: [NSAttributedString.Key: Any] {
        [.font: BoardTheme.font(Self.bodySize), .foregroundColor: BoardTheme.ink, .paragraphStyle: Self.paragraphStyle()]
    }

    init(lang: String, height: CGFloat, fileURL: URL = BoardNotepad.defaultFileURL) {
        self.lang = lang
        self.fileURL = fileURL
        // TextKit 1 вручную: без этого NSTextView на macOS 13+ берёт TextKit 2, где таблиц нет.
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        layout.usesFontLeading = false
        let container = NSTextContainer(size: NSSize(width: 400, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        textView = NotepadTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 100), textContainer: container)
        view = NSView()
        super.init()
        storage.delegate = self
        layout.delegate = self
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
        textView.textContainerInset = Self.textInset
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

        let pad = NSView()
        pad.translatesAutoresizingMaskIntoConstraints = false
        pad.addSubview(scroll)
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        pad.addSubview(placeholder)
        let caretX = Self.textInset.width + 5   // 5 — lineFragmentPadding контейнера
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: pad.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: pad.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: pad.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: pad.bottomAnchor),
            placeholder.leadingAnchor.constraint(equalTo: pad.leadingAnchor, constant: caretX),
            placeholder.topAnchor.constraint(equalTo: pad.topAnchor, constant: Self.textInset.height + 1),
        ])
        padHeight = pad.heightAnchor.constraint(equalToConstant: height)
        padHeight.isActive = true

        headingBtn = tool(nil, #selector(headingTapped))
        bulletBtn = tool("list.bullet", #selector(bulletTapped))
        numberBtn = tool("list.number", #selector(numberedTapped))
        checkBtn = tool("checklist", #selector(checkTapped))
        tableBtn = tool("tablecells", #selector(tableTapped))
        let capsule = BoxView(fill: BoardTheme.fill, radius: 15, border: .clear)
        for v in [headingBtn!, bulletBtn!, numberBtn!, checkBtn!, tableBtn!] { toolCapsule.addArrangedSubview(v) }
        capsule.addSubview(toolCapsule)
        NSLayoutConstraint.activate([
            toolCapsule.leadingAnchor.constraint(equalTo: capsule.leadingAnchor, constant: 2),
            toolCapsule.trailingAnchor.constraint(equalTo: capsule.trailingAnchor, constant: -2),
            toolCapsule.topAnchor.constraint(equalTo: capsule.topAnchor, constant: 2),
            toolCapsule.bottomAnchor.constraint(equalTo: capsule.bottomAnchor, constant: -2),
        ])

        clearBtn = FlatButton(title: "", fill: .clear, radius: 13, target: self, action: #selector(clearTapped))
        clearBtn.setSymbol("trash", color: BoardTheme.ink3, pointSize: 12)
        toTaskBtn = FlatButton(title: "", fill: .clear, hover: BoardTheme.amberSoft,
                               color: BoardTheme.amber, size: 12, radius: 13, target: self, action: #selector(toTaskTapped))
        for v in [capsule, boardSpacer(), clearBtn!, toTaskBtn!] as [NSView] { toolbar.addArrangedSubview(v) }

        confirmYes = FlatButton(title: "", fill: BoardTheme.rec.withAlphaComponent(0.85), hover: BoardTheme.rec,
                                color: .white, size: 12, target: self, action: #selector(clearConfirmed))
        confirmNo = FlatButton(title: "", target: self, action: #selector(clearCancelled))
        confirmRow.addArrangedSubview(confirmLabel)
        confirmRow.addArrangedSubview(confirmYes)
        confirmRow.addArrangedSubview(confirmNo)
        confirmRow.isHidden = true

        lock.image = NSImage(systemSymbolName: "lock.fill", accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 8.5, weight: .regular).applying(.init(paletteColors: [BoardTheme.ink3])))
        lock.translatesAutoresizingMaskIntoConstraints = false
        let (spaceL, spaceR) = (boardSpacer(), boardSpacer())
        let stampRow = paddedRow(spacing: 4, insets: NSEdgeInsets(top: 2, left: 14, bottom: 4, right: 14),
                                 views: [spaceL, stamp.hugText(), lock, spaceR])
        spaceL.widthAnchor.constraint(equalTo: spaceR.widthAnchor).isActive = true
        footer.isHidden = true

        let toolWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 10, left: 12, bottom: 4, right: 12), views: [toolbar, confirmRow])
        let stampWrap = stampRow
        let padWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 0, left: 14, bottom: 8, right: 14), views: [pad])
        let footWrap = paddedRow(insets: NSEdgeInsets(top: 0, left: 16, bottom: 8, right: 16), views: [footer])

        let root = boardStack(.vertical, views: [toolWrap, stampWrap, padWrap, footWrap])
        for v in [toolWrap, stampWrap, padWrap, footWrap] { v.setContentHuggingPriority(.required, for: .vertical) }
        toolbar.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            toolbar.widthAnchor.constraint(equalTo: toolWrap.widthAnchor, constant: -24),
            confirmRow.widthAnchor.constraint(equalTo: toolWrap.widthAnchor, constant: -24),
            pad.widthAnchor.constraint(equalTo: padWrap.widthAnchor, constant: -28),
        ])
    }

    /// Значок панели. Без символа — «Aa» текстом, как кнопка стиля в «Заметках».
    private func tool(_ symbol: String?, _ action: Selector) -> FlatButton {
        let b = FlatButton(title: "", fill: .clear, radius: 13, target: self, action: action)
        if let symbol {
            b.setSymbol(symbol, color: BoardTheme.ink2)
        } else {
            b.setTitle("Aa", color: BoardTheme.ink2, size: 14, weight: .medium)
        }
        b.widthAnchor.constraint(equalToConstant: 30).isActive = true
        b.heightAnchor.constraint(equalToConstant: 26).isActive = true
        return b
    }

    func setHeight(_ h: CGFloat) { padHeight.constant = h }

    func relabel() {
        placeholder.stringValue = BoardL10n.text("notes.placeholder", lang: lang)
        headingBtn.toolTip = BoardL10n.text("notes.heading", lang: lang)
        bulletBtn.toolTip = BoardL10n.text("notes.bullets", lang: lang)
        numberBtn.toolTip = BoardL10n.text("notes.numbered", lang: lang)
        checkBtn.toolTip = BoardL10n.text("notes.check", lang: lang)
        tableBtn.toolTip = BoardL10n.text("notes.table", lang: lang)
        clearBtn.toolTip = BoardL10n.text("notes.clear", lang: lang)
        toTaskBtn.setTitle(BoardL10n.text("notes.toTask", lang: lang), color: BoardTheme.amber, size: 12)
        toTaskBtn.toolTip = BoardL10n.text("notes.toTask.tip", lang: lang)
        confirmLabel.stringValue = BoardL10n.text("notes.clear.ask", lang: lang)
        confirmYes.setTitle(BoardL10n.text("notes.clear.yes", lang: lang), color: .white, size: 12)
        confirmNo.setTitle(BoardL10n.text("notes.clear.no", lang: lang), color: BoardTheme.ink, size: 12)
        lock.toolTip = BoardL10n.text("notes.footer", lang: lang)
        stamp.toolTip = lock.toolTip
        updateStamp()
        updatePlaceholder()
    }

    private func updatePlaceholder() { placeholder.isHidden = textView.textStorage?.length ?? 0 > 0 }

    private func updateStamp() {
        let f = DateFormatter()
        f.locale = Locale(identifier: lang == "en" ? "en_GB" : "ru_RU")
        f.dateStyle = .long
        f.timeStyle = .short
        f.doesRelativeDateFormatting = true
        stamp.stringValue = f.string(from: editedAt ?? Date())
    }

    private func flashFooter(_ text: String) {
        footer.stringValue = text
        footer.isHidden = false
        footerResetTimer?.invalidate()
        footerResetTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in self?.footer.isHidden = true }
    }

    // MARK: вид абзацев

    /// Строка — по шрифту текста, а не по самому высокому глифу: «☐» приходит из запасного шрифта
    /// Apple Symbols со своими подъёмом и интерлиньяжем, и без этого строки чек-листа скачут
    /// относительно соседних (замер: 21,2 pt и базовая линия на 1 pt выше при норме 20).
    func layoutManager(_ lm: NSLayoutManager, shouldSetLineFragmentRect lineRect: UnsafeMutablePointer<NSRect>,
                       lineFragmentUsedRect usedRect: UnsafeMutablePointer<NSRect>, baselineOffset: UnsafeMutablePointer<CGFloat>,
                       in container: NSTextContainer, forGlyphRange glyphRange: NSRange) -> Bool {
        guard let storage = lm.textStorage, glyphRange.length > 0 else { return false }
        let ns = storage.string as NSString
        let chars = lm.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
        let para = ns.paragraphRange(for: NSRange(location: chars.location, length: 0))
        let markerLen = chars.location == para.location
            ? NotepadMarkup.markerLength(ofLine: ns.substring(with: para).trimmingCharacters(in: .newlines)) : 0
        let probe = min(chars.location + markerLen, max(NSMaxRange(chars) - 1, chars.location))
        guard let font = storage.attribute(.font, at: probe, effectiveRange: nil) as? NSFont,
              let style = storage.attribute(.paragraphStyle, at: probe, effectiveRange: nil) as? NSParagraphStyle,
              style.textBlocks.isEmpty, style.maximumLineHeight > 0 else { return false }
        let before = chars.location == para.location && chars.location > 0 ? style.paragraphSpacingBefore : 0
        let after = NSMaxRange(chars) == NSMaxRange(para) && ns.substring(with: para).hasSuffix("\n") ? style.paragraphSpacing : 0
        let height = before + style.maximumLineHeight + after
        lineRect.pointee.size.height = height
        usedRect.pointee.size.height = min(usedRect.pointee.height, height)
        baselineOffset.pointee = before + (style.maximumLineHeight + font.descender).rounded()
        return true
    }

    /// Списки с висячим отступом (перенос строки встаёт под текст, а не под маркер), маркер — тише
    /// текста; у заголовка — воздух сверху и снизу. Стиль считается по тексту и шрифту абзаца, а не
    /// хранится отдельно, поэтому старые файлы блокнота сами принимают новый вид при открытии.
    func textStorage(_ storage: NSTextStorage, didProcessEditing editedMask: NSTextStorageEditActions,
                     range editedRange: NSRange, changeInLength delta: Int) {
        guard editedMask.contains(.editedCharacters) else { return }
        restyle(storage, in: (storage.string as NSString).paragraphRange(for: editedRange))
    }

    private func restyle(_ storage: NSTextStorage, in range: NSRange) {
        let ns = storage.string as NSString
        var idx = range.location
        while idx < NSMaxRange(range) || (idx == range.location && idx < ns.length) {
            let para = ns.paragraphRange(for: NSRange(location: idx, length: 0))
            restyleParagraph(storage, para, ns)
            idx = max(NSMaxRange(para), idx + 1)
        }
    }

    private func restyleParagraph(_ storage: NSTextStorage, _ para: NSRange, _ ns: NSString) {
        guard para.length > 0 else { return }
        let current = storage.attribute(.paragraphStyle, at: para.location, effectiveRange: nil) as? NSParagraphStyle
        if let blocks = current?.textBlocks, !blocks.isEmpty { return }   // ячейка таблицы — свой стиль
        let line = ns.substring(with: para).trimmingCharacters(in: .newlines)
        let font = storage.attribute(.font, at: para.location, effectiveRange: nil) as? NSFont ?? BoardTheme.font(Self.bodySize)
        let markerLen = NotepadMarkup.markerLength(ofLine: line)
        let indent = markerLen > 0
            ? ((line as NSString).substring(to: markerLen) as NSString).size(withAttributes: [.font: font]).width
            : 0
        let heading = font.pointSize > Self.bodySize + 0.5
        storage.addAttribute(.paragraphStyle, value: Self.paragraphStyle(heading: heading, indent: indent), range: para)
        storage.addAttribute(.foregroundColor, value: BoardTheme.ink, range: para)
        if markerLen > 0 {
            storage.addAttribute(.foregroundColor, value: BoardTheme.ink2, range: NSRange(location: para.location, length: markerLen))
        }
    }

    // MARK: хранение

    private func loadFromDisk() {
        let url = fileURL
        guard let data = try? Data(contentsOf: url) else { return }   // файла нет — чистый блокнот
        editedAt = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
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
            editedAt = Date()
            updateStamp()
        } catch {
            NSLog("SwarmRecorder: блокнот доски не сохранился: \(error)")   // dirty остаётся — повторим при следующей правке
        }
    }

    // MARK: ввод — автосписки и Enter

    func textView(_ tv: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
        guard !applyingEdit, !tv.hasMarkedText(), let text, range.length == 0 else { return true }
        let ns = tv.string as NSString
        let lineStart = ns.paragraphRange(for: NSRange(location: range.location, length: 0)).location

        let para = ns.paragraphRange(for: NSRange(location: range.location, length: 0))
        let currentLine = ns.substring(with: para).trimmingCharacters(in: .newlines)
        if NotepadMarkup.autoBullet(line: currentLine, typed: text), !inTableOrHeading(at: range.location) {
            replace(range, with: NotepadMarkup.bullet + text)
            return false
        }
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

    /// Ячейка таблицы или строка-заголовок: туда тезисный маркер сам не ставится.
    private func inTableOrHeading(at location: Int) -> Bool {
        guard let storage = textView.textStorage else { return false }
        let attrs = location < storage.length ? storage.attributes(at: location, effectiveRange: nil)
            : location > 0 ? storage.attributes(at: location - 1, effectiveRange: nil) : textView.typingAttributes
        let typing = textView.typingAttributes
        if let style = (typing[.paragraphStyle] ?? attrs[.paragraphStyle]) as? NSParagraphStyle, !style.textBlocks.isEmpty { return true }
        if let f = typing[.font] as? NSFont, f.pointSize > Self.bodySize + 0.5 { return true }
        return false
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
        restyle(storage, in: para)
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
                block.setWidth(5, type: .absoluteValueType, for: .padding)
                block.setValue(100 / Double(columns), type: .percentageValueType, for: .width)
                let style = (body[.paragraphStyle] as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle
                    ?? NSMutableParagraphStyle()
                style.paragraphSpacing = 0
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
