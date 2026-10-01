import Foundation

/// Очередь неотправленных live-пометок (issue #613).
///
/// Раньше пометки сливались один раз — на стопе записи. Не ушла хоть одна (сеть, 5xx, протухший
/// web-JWT) — она оставалась в буфере, но повтора не было, а старт следующей записи стирал файл:
/// пометки человека пропадали молча. Теперь неотправленное ложится в очередь вместе с id встречи
/// и досылается при следующем старте записи. Здесь — чистые правила без сети и AppKit.
public struct PendingNote: Codable, Equatable, Sendable {
    public let meetingId: String
    public let offset: Int
    public let text: String

    public init(meetingId: String, offset: Int, text: String) {
        self.meetingId = meetingId
        self.offset = offset
        self.text = text
    }
}

/// Что делать с пометкой после попытки отправить.
public enum NoteDelivery: Equatable, Sendable {
    /// Сервер принял.
    case sent
    /// Не дошло или сервер временно не смог — оставить в очереди.
    case retry
    /// Сервер ответил «так нельзя» (встречи нет, нет прав, кривые данные) — повтор не поможет.
    case drop
}

public enum LiveNotesOutbox {
    /// Ответ сервера → судьба пометки. `nil` — запрос не дошёл (сеть).
    /// 401 — протухший токен, 408/429 — подождать: это повтор, а не отказ.
    public static func delivery(forStatus code: Int?) -> NoteDelivery {
        guard let code else { return .retry }
        if code == 200 || code == 201 { return .sent }
        if code == 401 || code == 408 || code == 429 || code >= 500 { return .retry }
        if (400..<500).contains(code) { return .drop }
        return .retry
    }

    /// Добавить к очереди новое, не задваивая одну и ту же пометку.
    public static func merge(_ queued: [PendingNote], _ incoming: [PendingNote]) -> [PendingNote] {
        var out = queued
        for note in incoming where !out.contains(note) {
            out.append(note)
        }
        return out
    }

    public static func encode(_ notes: [PendingNote]) -> Data? {
        try? JSONEncoder().encode(notes)
    }

    /// Битый файл — пустая очередь, а не падение: разбирать его будет человек по журналу.
    public static func decode(_ data: Data) -> [PendingNote] {
        (try? JSONDecoder().decode([PendingNote].self, from: data)) ?? []
    }
}
