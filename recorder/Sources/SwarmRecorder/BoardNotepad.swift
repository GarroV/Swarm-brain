import AppKit
import RecorderKit

// Блокнот дня на доске «Сегодня» — список блоков (решение владельца 23.10.2026): тезис с
// кружком слева, пункт чек-листа с квадратом или таблица. У тезиса, пункта и строки таблицы при
// наведении появляется «→ В задачу». Хранится ТОЛЬКО на этом Mac
// (`~/Library/Application Support/SwarmRecorder/notepad.json`), в Swarm не уходит (п. 10 и 14
// docs/decisions/2026-10-22-bumblebee-hub.md). Сам не обнуляется — только корзина.
//
// Данные и перенос старого текстового блокнота (notepad.rtf) — RecorderKit/NoteBlocks (под
// тестом), виды блоков — NotepadBlockViews.swift.

/// Документ блокнота: перевёрнутые координаты — блоки идут сверху вниз; клик ниже последнего
/// блока ставит курсор в конец.
private final class NotepadDocument: NSView {
    var onClickBelow: (() -> Void)?
    override var isFlipped: Bool { true }
    override func mouseDown(with event: NSEvent) { onClickBelow?() }
}

final class BoardNotepad: NSObject, NoteLineHost, NoteTableHost {
    /// Доска присваивает язык на каждом обновлении (раз в 10 с); пересборка строк убивает поле под
    /// курсором, поэтому — только при настоящей смене языка (23.10.2026: «очень быстро пропадает фокус»).
    var lang: String { didSet { guard lang != oldValue else { return }; relabel(); rebuild(focus: nil) } }
    /// «→ В задачу»: заголовок будущей задачи.
    var onToTask: ((String) -> Void)?

    let view: NSView

    private var blocks: [NoteBlock] = [.empty]
    private var blockViews: [NSView] = []
    private let stack = NSStackView()
    private let document = NotepadDocument()
    private let scroll = NSScrollView()
    private var padHeight: NSLayoutConstraint!
    /// Столбцом слева блокнот тянется на всю высоту доски, но не ниже заданной высоты.
    private var padMinHeight: NSLayoutConstraint!
    private var lastFocused = 0

    // Шапка как у «Заметок»: капсула значков, корзина, под ними дата последней правки и замок
    // с подсказкой «хранится только на этом Mac».
    private let toolbar = boardStack(.horizontal, spacing: 6)
    private let toolCapsule = boardStack(.horizontal, spacing: 0)
    private let confirmRow = boardStack(.horizontal, spacing: 8)
    private let confirmLabel = boardLabel("", size: 12, color: BoardTheme.ink2)
    private var confirmYes: FlatButton!
    private var confirmNo: FlatButton!
    private var thesisBtn: FlatButton!, checkBtn: FlatButton!, tableBtn: FlatButton!, clearBtn: FlatButton!
    private let stamp = boardLabel("", size: 11, color: BoardTheme.ink3)
    private let lock = NSImageView()

    private let fileURL: URL
    private var saveTimer: Timer?
    private var sweepTimer: Timer?
    /// Когда блокнот последний раз убирали от отмеченного (NoteSweep): в 9:00 нового дня.
    static let sweptAtKey = "BoardNotepadSweptAt"
    private var dirty = false
    /// Когда блокнот правили последний раз: дата файла на диске, потом — момент сохранения.
    private var editedAt: Date?

    static var defaultFileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SwarmRecorder", isDirectory: true)
            .appendingPathComponent("notepad.json")
    }
    /// Прежний текстовый блокнот (до 23.10.2026): читается один раз, если notepad.json ещё нет.
    private var legacyURL: URL { fileURL.deletingLastPathComponent().appendingPathComponent("notepad.rtf") }

    init(lang: String, height: CGFloat, fileURL: URL = BoardNotepad.defaultFileURL) {
        self.lang = lang
        self.fileURL = fileURL
        view = NSView()
        super.init()
        build(height: height)
        loadFromDisk()
        sweepIfDue()
        relabel()
        rebuild(focus: nil)
        let t = Timer(timeInterval: 60, repeats: true) { [weak self] _ in self?.sweepTick() }
        RunLoop.main.add(t, forMode: .common)
        sweepTimer = t
        NotificationCenter.default.addObserver(self, selector: #selector(flushNow),
                                               name: NSApplication.willTerminateNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func t(_ key: String) -> String { BoardL10n.text(key, lang: lang) }

    // MARK: сборка

    private func build(height: CGFloat) {
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        document.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(stack)
        document.onClickBelow = { [weak self] in self?.clickBelow() }
        scroll.documentView = document
        scroll.hasVerticalScroller = true
        // При «показывать полосы прокрутки всегда» macOS подменяет overlay на дорожку — без
        // автоскрытия у короткого блокнота висела пустая полоса справа (владелец 26.10.2026).
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.scrollerStyle = .overlay
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let clip = scroll.contentView
        NSLayoutConstraint.activate([
            document.leadingAnchor.constraint(equalTo: clip.leadingAnchor),
            document.trailingAnchor.constraint(equalTo: clip.trailingAnchor),
            document.topAnchor.constraint(equalTo: clip.topAnchor),
            document.heightAnchor.constraint(greaterThanOrEqualTo: clip.heightAnchor),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -4),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 2),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: document.bottomAnchor, constant: -8),
        ])
        padHeight = scroll.heightAnchor.constraint(equalToConstant: height)
        padHeight.isActive = true
        padMinHeight = scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: height)
        scroll.setContentHuggingPriority(.init(1), for: .vertical)

        thesisBtn = tool("list.bullet", #selector(thesisTapped))
        checkBtn = tool("checklist", #selector(checkTapped))
        tableBtn = tool("tablecells", #selector(tableTapped))
        let capsule = BoxView(fill: BoardTheme.fill, radius: 15, border: .clear)
        for v in [thesisBtn!, checkBtn!, tableBtn!] { toolCapsule.addArrangedSubview(v) }
        capsule.addSubview(toolCapsule)
        NSLayoutConstraint.activate([
            toolCapsule.leadingAnchor.constraint(equalTo: capsule.leadingAnchor, constant: 2),
            toolCapsule.trailingAnchor.constraint(equalTo: capsule.trailingAnchor, constant: -2),
            toolCapsule.topAnchor.constraint(equalTo: capsule.topAnchor, constant: 2),
            toolCapsule.bottomAnchor.constraint(equalTo: capsule.bottomAnchor, constant: -2),
        ])
        clearBtn = FlatButton(title: "", fill: .clear, radius: 13, target: self, action: #selector(clearTapped))
        clearBtn.setSymbol("trash", color: BoardTheme.ink3, pointSize: 12)
        for v in [capsule, boardSpacer(), clearBtn!] as [NSView] { toolbar.addArrangedSubview(v) }

        confirmYes = FlatButton(title: "", fill: BoardTheme.rec.withAlphaComponent(0.85), hover: BoardTheme.rec,
                                color: .white, size: 12, target: self, action: #selector(clearConfirmed))
        confirmNo = FlatButton(title: "", target: self, action: #selector(clearCancelled))
        confirmRow.addArrangedSubview(confirmLabel)
        confirmRow.addArrangedSubview(confirmYes)
        confirmRow.addArrangedSubview(confirmNo)
        confirmRow.isHidden = true

        lock.image = NSImage(systemSymbolName: "lock.fill", accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 8.5, weight: .regular))
        lock.contentTintColor = BoardTheme.ink3
        lock.translatesAutoresizingMaskIntoConstraints = false
        let (spaceL, spaceR) = (boardSpacer(), boardSpacer())
        let stampRow = paddedRow(spacing: 4, insets: NSEdgeInsets(top: 2, left: 14, bottom: 6, right: 14),
                                 views: [spaceL, stamp.hugText(), lock, spaceR])
        spaceL.widthAnchor.constraint(equalTo: spaceR.widthAnchor).isActive = true

        let toolWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 10, left: 12, bottom: 4, right: 12), views: [toolbar, confirmRow])
        let padWrap = boardStack(.vertical, insets: NSEdgeInsets(top: 0, left: 14, bottom: 10, right: 10), views: [scroll])
        let root = boardStack(.vertical, views: [toolWrap, stampRow, padWrap])
        for v in [toolWrap, stampRow, padWrap] { v.setContentHuggingPriority(.required, for: .vertical) }
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
            scroll.widthAnchor.constraint(equalTo: padWrap.widthAnchor, constant: -24),
        ])
    }

    private func tool(_ symbol: String, _ action: Selector) -> FlatButton {
        let b = FlatButton(title: "", fill: .clear, radius: 13, target: self, action: action)
        b.setSymbol(symbol, color: BoardTheme.ink2)
        b.widthAnchor.constraint(equalToConstant: 30).isActive = true
        b.heightAnchor.constraint(equalToConstant: 26).isActive = true
        return b
    }

    func setHeight(_ h: CGFloat) { padHeight.constant = h; padMinHeight.constant = h }

    /// Блокнот столбцом: высота — по колонке, а не фиксированная.
    func setFillsColumn(_ fills: Bool) {
        padHeight.isActive = !fills
        padMinHeight.isActive = fills
    }

    func relabel() {
        thesisBtn.toolTip = t("notes.thesis")
        checkBtn.toolTip = t("notes.check")
        tableBtn.toolTip = t("notes.table")
        clearBtn.toolTip = t("notes.clear")
        confirmLabel.stringValue = t("notes.clear.ask")
        confirmYes.setTitle(t("notes.clear.yes"), color: .white, size: 12)
        confirmNo.setTitle(t("notes.clear.no"), color: BoardTheme.ink, size: 12)
        lock.toolTip = t("notes.footer")
        stamp.toolTip = lock.toolTip
        updateStamp()
    }

    private func updateStamp() {
        let f = DateFormatter()
        f.locale = Locale(identifier: lang == "en" ? "en_GB" : "ru_RU")
        f.dateStyle = .long
        f.timeStyle = .short
        f.doesRelativeDateFormatting = true
        stamp.stringValue = f.string(from: editedAt ?? Date())
    }

    // MARK: список блоков

    /// Виды строятся заново по `blocks` на каждое изменение состава (добавить, убрать, сменить
    /// вид); набор текста их не пересоздаёт. Блокнот дня короткий — так проще и без рассинхрона.
    private func rebuild(focus target: (index: Int, caret: Int?)?) {
        blocks = NoteBlocks.normalized(blocks)
        for v in stack.arrangedSubviews { stack.removeArrangedSubview(v); v.removeFromSuperview() }
        blockViews = blocks.enumerated().map { i, block in makeView(i, block) }
        // Чек-лист — карточка: название и пункты на подложке, пункты с отступом под названием.
        let groups = NoteBlocks.checklistGroups(blocks)
        var i = 0
        while i < blockViews.count {
            if let g = groups.first(where: { $0.lowerBound == i }) {
                stack.addArrangedSubview(checklistCard(Array(blockViews[g]), titled: blocks[i].isTitle))
                i = g.upperBound + 1
            } else {
                stack.addArrangedSubview(blockViews[i])
                i += 1
            }
        }
        for v in stack.arrangedSubviews { v.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        guard let target, target.index < blockViews.count else { return }
        document.layoutSubtreeIfNeeded()
        focusBlock(target.index, caret: target.caret)
    }

    private func makeView(_ i: Int, _ block: NoteBlock) -> NSView {
        if case .table(let rows) = block {
            let table = NoteTableView(rows: rows, taskTip: t("notes.toTask.tip"), removeTip: t("notes.table.remove"))
            table.host = self
            return table
        }
        let line = NoteLineView(block: block, taskTip: t("notes.toTask.tip"))
        line.host = self
        if i == 0 && blocks == [.empty] { line.setPlaceholder(t("notes.placeholder")) }
        if block == .title("") { line.setPlaceholder(t("notes.checklist.title")) }
        return line
    }

    private static let cardIndent: CGFloat = 22

    private func checklistCard(_ views: [NSView], titled: Bool) -> NSView {
        let card = BoxView(fill: BoardTheme.fill, radius: 10)
        let inner = boardStack(.vertical, spacing: 0)
        card.addSubview(inner)
        NSLayoutConstraint.activate([
            inner.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 10),
            inner.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -6),
            inner.topAnchor.constraint(equalTo: card.topAnchor, constant: 6),
            inner.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -6),
        ])
        for (n, v) in views.enumerated() {
            let indent = titled && n > 0 ? Self.cardIndent : 0
            let wrap = boardStack(.vertical, insets: NSEdgeInsets(top: 0, left: indent, bottom: 0, right: 0), views: [v])
            inner.addArrangedSubview(wrap)
        }
        // Воздух вокруг карточки, чтобы она не слипалась с тезисами.
        return boardStack(.vertical, insets: NSEdgeInsets(top: 4, left: 0, bottom: 4, right: 0), views: [card])
    }

    private func focusBlock(_ i: Int, caret: Int? = nil, atEnd: Bool = true) {
        guard blockViews.indices.contains(i) else { return }
        lastFocused = i
        if let line = blockViews[i] as? NoteLineView { line.focus(atEnd: atEnd, caret: caret) }
        if let table = blockViews[i] as? NoteTableView { table.focusFirstCell() }
        blockViews[i].scrollToVisible(blockViews[i].bounds)
    }

    private func index(of v: NSView) -> Int? { blockViews.firstIndex(of: v) }

    private func clickBelow() {
        if let last = blocks.last, last == .empty {
            focusBlock(blocks.count - 1)
        } else {
            blocks.append(.empty)
            rebuild(focus: (blocks.count - 1, nil))
            changed()
        }
    }

    // MARK: NoteLineHost

    func lineChanged(_ line: NoteLineView) {
        guard let i = index(of: line) else { return }
        blocks[i] = line.block
        changed()
    }

    func lineSplit(_ line: NoteLineView, before: String, after: String) {
        guard let i = index(of: line) else { return }
        // Enter на пустом пункте чек-листа — выход из чек-листа в тезис, как в «Заметках».
        if case .check("", _) = line.block, after.isEmpty {
            blocks[i] = .empty
            rebuild(focus: (i, 0))
            changed()
            return
        }
        blocks[i] = line.block.withText(before)
        let next: NoteBlock
        switch line.block {
        case .check, .title: next = .check(after, done: false)   // под названием — первый пункт
        default: next = .thesis(after)
        }
        blocks.insert(next, at: i + 1)
        rebuild(focus: (i + 1, 0))
        changed()
    }

    func lineBackspaceAtStart(_ line: NoteLineView) {
        guard let i = index(of: line) else { return }
        // Пустой пункт чек-листа просто убирается, курсор — в конец строки выше.
        if case .check("", _) = line.block, i > 0 {
            blocks.remove(at: i)
            rebuild(focus: (i - 1, nil))
            changed()
            return
        }
        // Непустой пункт и название сначала становятся тезисом, и только потом сливаются со строкой выше.
        switch line.block {
        case .check(let text, let done):
            blocks[i] = .thesis(text, done: done)
            rebuild(focus: (i, 0)); changed(); return
        case .title(let text):
            blocks[i] = .thesis(text)
            rebuild(focus: (i, 0)); changed(); return
        default:
            break
        }
        guard i > 0 else { return }
        let text = line.block.text ?? ""
        if let prevText = blocks[i - 1].text {
            blocks[i - 1] = blocks[i - 1].withText(prevText + text)
            blocks.remove(at: i)
            rebuild(focus: (i - 1, (prevText as NSString).length))
        } else if text.isEmpty {
            blocks.remove(at: i)   // пустая строка под таблицей — убрать, курсор в таблицу
            rebuild(focus: (i - 1, nil))
        } else {
            return
        }
        changed()
    }

    func lineMove(_ line: NoteLineView, by delta: Int) {
        guard let i = index(of: line) else { return }
        focusBlock(i + delta, atEnd: delta < 0)
    }

    func lineFocused(_ line: NoteLineView) { if let i = index(of: line) { lastFocused = i } }

    func lineToTask(_ text: String) { onToTask?(text) }

    // MARK: NoteTableHost

    func tableChanged(_ table: NoteTableView) {
        guard let i = index(of: table) else { return }
        blocks[i] = .table(table.rows)
        changed()
    }

    func tableRemove(_ table: NoteTableView) {
        guard let i = index(of: table) else { return }
        blocks.remove(at: i)
        rebuild(focus: (max(0, min(i, blocks.count - 1)), nil))
        changed()
    }

    func tableFocused(_ table: NoteTableView) { if let i = index(of: table) { lastFocused = i } }

    // MARK: панель

    /// Кнопка тезиса: текущая строка (пункт, название) становится тезисом. На таблице — новый тезис под ней.
    private func makeThesis() {
        let i = min(lastFocused, blocks.count - 1)
        guard let text = blocks[i].text else {
            blocks.insert(.empty, at: i + 1)
            rebuild(focus: (i + 1, nil)); changed(); return
        }
        blocks[i] = .thesis(text, done: blocks[i].isDone)
        rebuild(focus: (i, nil))
        changed()
    }

    /// Кнопка чек-листа: строка становится названием чек-листа, под ней — первый пункт (курсор в
    /// нём; на пустой строке — в названии). Внутри чек-листа — новый пункт под текущим. На
    /// таблице — новый чек-лист под ней.
    private func makeChecklist() {
        let i = min(lastFocused, blocks.count - 1)
        switch blocks[i] {
        case .check, .title:
            blocks.insert(.check("", done: false), at: i + 1)
            rebuild(focus: (i + 1, nil))
        case .table:
            blocks.insert(contentsOf: [.title(""), .check("", done: false)], at: i + 1)
            rebuild(focus: (i + 1, nil))
        case .thesis(let text, _):
            blocks[i] = .title(text)
            blocks.insert(.check("", done: false), at: i + 1)
            rebuild(focus: (text.isEmpty ? i : i + 1, nil))
        }
        changed()
    }

    @objc private func thesisTapped() { makeThesis() }
    @objc private func checkTapped() { makeChecklist() }

    @objc private func tableTapped() {
        var i = min(lastFocused, blocks.count - 1)
        // Пустая строка под курсором — таблица встаёт на её место, иначе — под ней.
        if blocks[i] == .empty { blocks.remove(at: i) } else { i += 1 }
        blocks.insert(NoteBlock.newTable(), at: i)
        if i + 1 >= blocks.count { blocks.append(.empty) }   // под таблицей есть где писать
        rebuild(focus: (i, nil))
        changed()
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
        blocks = [.empty]
        rebuild(focus: (0, nil))
        changed()
        flush()
        clearCancelled()
    }

    // MARK: утренняя уборка

    /// Убрать отмеченное, если наступила новая граница 9:00. Уборки ещё не было — отсчёт от
    /// последней правки блокнота (отмеченное вчера уходит сегодня); пустой блокнот — от «сейчас».
    /// true — блоки поменялись.
    @discardableResult
    private func sweepIfDue(now: Date = Date()) -> Bool {
        let defaults = UserDefaults.standard
        let last = (defaults.object(forKey: Self.sweptAtKey) as? Date) ?? editedAt
        guard last != nil else { defaults.set(now, forKey: Self.sweptAtKey); return false }
        guard NoteSweep.isDue(lastSweep: last, now: now) else { return false }
        defaults.set(now, forKey: Self.sweptAtKey)
        let swept = NoteSweep.removingDone(blocks)
        guard swept != blocks else { return false }
        blocks = swept
        changed()
        return true
    }

    /// Раз в минуту: подпись даты правки пересчитывается; пересборка строк сняла бы курсор, поэтому, пока человек печатает в
    /// блокноте, уборка ждёт следующей минуты.
    private func sweepTick() {
        updateStamp()   // «Сегодня в 19:27» после полуночи должно стать «вчера»
        if let editor = view.window?.firstResponder as? NSView, editor.isDescendant(of: view) { return }
        if sweepIfDue() { rebuild(focus: nil) }
    }

    // MARK: хранение

    private func changed() {
        dirty = true
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: false) { [weak self] _ in self?.flush() }
    }

    private func loadFromDisk() {
        if let data = try? Data(contentsOf: fileURL) {
            do {
                blocks = try NoteBlocks.decode(data)
                editedAt = (try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            } catch {
                park(fileURL, error: error)   // не затираем: файл с текстом человека откладываем рядом
            }
            return
        }
        guard FileManager.default.fileExists(atPath: legacyURL.path) else { return }   // чистый блокнот
        do {
            let old = try NSAttributedString(url: legacyURL, options: [.documentType: NSAttributedString.DocumentType.rtf],
                                             documentAttributes: nil)
            blocks = NoteBlocks.migrate(plainText: old.string)
            editedAt = (try? legacyURL.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            dirty = true
            flush()   // перенос сразу в notepad.json; старый файл остаётся как был
        } catch {
            park(legacyURL, error: error)
        }
    }

    private func park(_ url: URL, error: Error) {
        let when = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let name = url.deletingPathExtension().lastPathComponent + "-unreadable-\(when)." + url.pathExtension
        let parked = url.deletingLastPathComponent().appendingPathComponent(name)
        try? FileManager.default.moveItem(at: url, to: parked)
        NSLog("SwarmRecorder: блокнот доски не прочитался (\(error)) — файл отложен в \(parked.path)")
    }

    @objc private func flushNow() { flush() }

    /// Записать на диск сейчас (закрытие панели, выход из приложения).
    func flush() {
        saveTimer?.invalidate(); saveTimer = nil
        guard dirty else { return }
        do {
            let data = try NoteBlocks.encode(blocks)
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: fileURL, options: .atomic)
            dirty = false
            editedAt = Date()
            updateStamp()
        } catch {
            NSLog("SwarmRecorder: блокнот доски не сохранился: \(error)")   // dirty остаётся — повторим при следующей правке
        }
    }
}
