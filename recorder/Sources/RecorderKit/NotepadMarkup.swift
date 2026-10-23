import Foundation

// Разметка блокнота доски — чистые функции над текстом строки, без AppKit.
//
// Списки в блокноте — обычные символы в начале строки («• », «☐ », «1. »), а не NSTextList:
// так текст одинаково переживает RTF, копирование в другое приложение и правку руками, а
// продолжение списка по Enter и «Список → строка» проверяются тестом, а не глазами.
public enum NotepadMarkup {
    public static let bullet = "• "
    public static let check = "☐ "
    public static let checkDone = "☑ "

    public enum Kind: Equatable {
        case bullet
        case check
        case numbered(Int)

        /// Маркер, которым строка начинается.
        public var marker: String {
            switch self {
            case .bullet: return NotepadMarkup.bullet
            case .check: return NotepadMarkup.check
            case .numbered(let n): return "\(n). "
            }
        }
    }

    /// Человек только что напечатал пробел: `linePrefix` — всё, что в строке до курсора, ВКЛЮЧАЯ этот
    /// пробел. «- », «* », «1. », «[] », «[ ] » в самом начале строки превращаются в маркер списка.
    /// Возвращает вид списка и сколько символов набранного заменить маркером.
    public static func autoList(linePrefix: String) -> (kind: Kind, replacing: Int)? {
        guard linePrefix.hasSuffix(" ") else { return nil }
        let typed = String(linePrefix.dropLast())
        switch typed {
        case "-", "*": return (.bullet, linePrefix.count)
        case "[]", "[ ]": return (.check, linePrefix.count)
        default: break
        }
        if typed.hasSuffix("."), let n = Int(typed.dropLast()), n >= 0, typed.dropLast().allSatisfy({ $0.isASCII && $0.isNumber }) {
            return (.numbered(n), linePrefix.count)
        }
        return nil
    }

    /// Вид списка, которым начинается строка целиком (маркер уже стоит).
    public static func kind(ofLine line: String) -> Kind? {
        if line.hasPrefix(bullet) { return .bullet }
        if line.hasPrefix(check) || line.hasPrefix(checkDone) { return .check }
        let digits = line.prefix(while: { $0.isASCII && $0.isNumber })
        if !digits.isEmpty, line.dropFirst(digits.count).hasPrefix(". "), let n = Int(digits) { return .numbered(n) }
        return nil
    }

    /// Длина маркера в начале строки (0 — маркера нет). Считается по самой строке, а не по `Kind.marker`:
    /// «007. » короче/длиннее, чем «7. ».
    public static func markerLength(ofLine line: String) -> Int {
        guard let k = kind(ofLine: line) else { return 0 }
        if case .numbered = k { return line.prefix(while: { $0.isASCII && $0.isNumber }).count + 2 }
        return 2
    }

    public enum Continuation: Equatable {
        /// Строка не из списка — Enter работает как обычно.
        case none
        /// Вставить маркер следующего пункта после перевода строки.
        case insert(String)
        /// Пункт пуст — Enter снимает маркер и выходит из списка.
        case endList(markerLength: Int)
    }

    /// Что делает Enter на строке `line` (без символа перевода строки).
    public static func continuation(forLine line: String) -> Continuation {
        guard let kind = kind(ofLine: line) else { return .none }
        let markerLen = markerLength(ofLine: line)
        let rest = String(line.dropFirst(markerLen))
        if rest.trimmingCharacters(in: .whitespaces).isEmpty { return .endList(markerLength: markerLen) }
        switch kind {
        case .bullet: return .insert(bullet)
        case .check: return .insert(check)
        case .numbered(let n): return .insert("\(n + 1). ")
        }
    }

    /// Заголовок для «→ В задачу»: строка или выделение без маркера списка, без лишних пробелов
    /// и в пределах `limit` символов. nil — задачи из этого не сделать (пусто).
    public static func taskTitle(from text: String, limit: Int = 200) -> String? {
        let firstLine = text.split(whereSeparator: \.isNewline)
            .map { String($0).drop(while: { $0 == " " || $0 == "\t" }) }
            .map(String.init)
            .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) ?? ""
        var line = firstLine
        line = String(line.dropFirst(markerLength(ofLine: line)))
        line = line.trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty else { return nil }
        return String(line.prefix(limit))
    }
}
