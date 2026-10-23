import Foundation

// Блокнот доски — набор блоков, а не сплошной текст (решение владельца 23.10.2026): тезис,
// пункт чек-листа или таблица. У каждого тезиса, пункта и строки таблицы при наведении —
// стрелка «→ В задачу». Здесь только данные, без AppKit: формат файла, перенос старого
// текстового блокнота и заголовок задачи из блока — под тестом.
public enum NoteBlock: Equatable, Codable {
    /// Тезис; клик по кружку отмечает его сделанным (зачёркнут), как пункт чек-листа.
    case thesis(String, done: Bool = false)
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
        case .thesis(let t, _), .check(let t, _): return t
        case .table: return nil
        }
    }

    /// Отмечен ли тезис или пункт сделанным.
    public var isDone: Bool {
        switch self {
        case .thesis(_, let d), .check(_, let d): return d
        case .table: return false
        }
    }

    /// Тот же блок с другой отметкой «сделано». Таблица не меняется.
    public func withDone(_ d: Bool) -> NoteBlock {
        switch self {
        case .thesis(let t, _): return .thesis(t, done: d)
        case .check(let t, _): return .check(t, done: d)
        case .table: return self
        }
    }

    // Формат файла: {"kind":"thesis"|"check"|"table","text":…,"done":…,"rows":…}. Первые файлы
    // (23.10.2026, несколько часов) писались синтезированным Codable — `{"thesis":{"_0":…}}`;
    // их тоже читаем, чтобы заметки не пропали.
    private enum Key: String, CodingKey { case kind, text, done, rows, thesis, check, table, _0 }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        if let kind = try c.decodeIfPresent(String.self, forKey: .kind) {
            let text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
            let done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
            switch kind {
            case "thesis": self = .thesis(text, done: done)
            case "check": self = .check(text, done: done)
            case "table": self = .table(try c.decode([[String]].self, forKey: .rows))
            default: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "блок \(kind)")
            }
            return
        }
        if c.contains(.thesis) {
            let n = try c.nestedContainer(keyedBy: Key.self, forKey: .thesis)
            self = .thesis(try n.decode(String.self, forKey: ._0), done: try n.decodeIfPresent(Bool.self, forKey: .done) ?? false)
        } else if c.contains(.check) {
            let n = try c.nestedContainer(keyedBy: Key.self, forKey: .check)
            self = .check(try n.decode(String.self, forKey: ._0), done: try n.decode(Bool.self, forKey: .done))
        } else {
            let n = try c.nestedContainer(keyedBy: Key.self, forKey: .table)
            self = .table(try n.decode([[String]].self, forKey: ._0))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        switch self {
        case .thesis(let t, let d):
            try c.encode("thesis", forKey: .kind); try c.encode(t, forKey: .text); try c.encode(d, forKey: .done)
        case .check(let t, let d):
            try c.encode("check", forKey: .kind); try c.encode(t, forKey: .text); try c.encode(d, forKey: .done)
        case .table(let rows):
            try c.encode("table", forKey: .kind); try c.encode(rows, forKey: .rows)
        }
    }

    /// Тот же текст в блоке другого вида (тезис ↔ пункт чек-листа). Таблица не меняется.
    public func withText(_ t: String) -> NoteBlock {
        switch self {
        case .thesis(_, let done): return .thesis(t, done: done)
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
