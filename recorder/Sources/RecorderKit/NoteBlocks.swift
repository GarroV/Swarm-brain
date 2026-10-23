import Foundation

// Блокнот доски — набор блоков, а не сплошной текст (решение владельца 23.10.2026): тезис,
// пункт чек-листа или таблица. У каждого тезиса, пункта и строки таблицы при наведении —
// стрелка «→ В задачу». Здесь только данные, без AppKit: формат файла, перенос старого
// текстового блокнота и заголовок задачи из блока — под тестом.
public enum NoteBlock: Equatable, Codable {
    case thesis(String)
    case check(String, done: Bool)
    case table([[String]])

    /// Пустой тезис — с него начинается чистый блокнот и каждая новая строка.
    public static let empty = NoteBlock.thesis("")

    /// Таблица по кнопке: 3×3 пустых ячейки.
    public static func newTable(rows: Int = 3, columns: Int = 3) -> NoteBlock {
        .table(Array(repeating: Array(repeating: "", count: columns), count: rows))
    }

    /// Текст тезиса или пункта; у таблицы — nil.
    public var text: String? {
        switch self {
        case .thesis(let t), .check(let t, _): return t
        case .table: return nil
        }
    }

    /// Тот же текст в блоке другого вида (тезис ↔ пункт чек-листа). Таблица не меняется.
    public func withText(_ t: String) -> NoteBlock {
        switch self {
        case .thesis: return .thesis(t)
        case .check(_, let done): return .check(t, done: done)
        case .table: return self
        }
    }
}

public enum NoteBlocks {
    /// Файл блокнота: `{"version":1,"blocks":[…]}`.
    struct File: Codable {
        var version: Int
        var blocks: [NoteBlock]
    }

    public static func encode(_ blocks: [NoteBlock]) throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try enc.encode(File(version: 1, blocks: blocks))
    }

    public static func decode(_ data: Data) throws -> [NoteBlock] {
        try JSONDecoder().decode(File.self, from: data).blocks
    }

    /// Блокнот без единого блока не бывает: в нём всегда есть строка, куда поставить курсор.
    public static func normalized(_ blocks: [NoteBlock]) -> [NoteBlock] {
        blocks.isEmpty ? [.empty] : blocks
    }

    /// Перенос старого текстового блокнота (notepad.rtf до 23.10.2026): строка с «☐ »/«☑ » —
    /// пункт чек-листа, любая другая непустая строка — тезис без своего маркера. Пустые строки
    /// пропадают: разделителем в новом блокноте служит сам блок.
    public static func migrate(plainText: String) -> [NoteBlock] {
        let blocks: [NoteBlock] = plainText.split(whereSeparator: \.isNewline).compactMap { raw in
            let line = String(raw).trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { return nil }
            let done = line.hasPrefix(NotepadMarkup.checkDone)
            let body = String(line.dropFirst(NotepadMarkup.markerLength(ofLine: line)))
                .trimmingCharacters(in: .whitespaces)
            guard !body.isEmpty else { return nil }
            if NotepadMarkup.kind(ofLine: line) == .check { return .check(body, done: done) }
            return .thesis(body)
        }
        return normalized(blocks)
    }

    /// Заголовок задачи из строки таблицы: непустые ячейки через « — ». nil — строка пустая.
    public static func taskTitle(row: [String], limit: Int = 200) -> String? {
        let cells = row.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return NotepadMarkup.taskTitle(from: cells.joined(separator: " — "), limit: limit)
    }
}
