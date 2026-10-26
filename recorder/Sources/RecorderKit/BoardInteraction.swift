import Foundation

// Состояние «галочка / отмена до ухода» строки задачи на доске.
//
// Клик по галочке зачёркивает строку; через ~1.8 с она уходит и уходит PATCH done. Повторный клик
// ДО ухода — отмена без запроса. Пока PATCH в пути, строка скрыта; упал — возвращается; прошёл —
// сервер сам перестанет её отдавать. Таймер, сработавший после отмены, ничего не делает: это и
// есть то, что легко сломать молча (закрытая задача, которую человек «передумал»).
public struct CheckTracker: Equatable {
    public enum Toggle: Equatable { case struck, cancelled }

    public static let delay: TimeInterval = 1.8

    private(set) var struck: Set<String> = []
    private(set) var inFlight: Set<String> = []

    public init() {}

    public func isStruck(_ id: String) -> Bool { struck.contains(id) }
    /// Сколько строк сейчас ждут ответа PATCH (скрыты, но на сервере ещё живы).
    public var inFlightCount: Int { inFlight.count }
    public var struckIDs: Set<String> { struck }

    /// Клик по галочке. `.struck` — запланировать уход, `.cancelled` — отменено до ухода.
    public mutating func toggle(_ id: String) -> Toggle {
        if inFlight.contains(id) { return .struck }   // запрос уже летит — клик ничего не меняет
        if struck.remove(id) != nil { return .cancelled }
        struck.insert(id)
        return .struck
    }

    /// Сработал таймер ухода: true — строка ещё зачёркнута, надо слать PATCH; false — её отменили.
    public mutating func commit(_ id: String) -> Bool {
        guard struck.remove(id) != nil else { return false }
        inFlight.insert(id)
        return true
    }

    /// PATCH не прошёл — строка возвращается в список.
    public mutating func failed(_ id: String) { inFlight.remove(id) }
    /// PATCH прошёл — строки больше нет.
    public mutating func finished(_ id: String) { inFlight.remove(id) }

    /// Что показывать: без строк, у которых PATCH в пути.
    public func visible(_ tasks: [BoardTask]) -> [BoardTask] {
        tasks.filter { !inFlight.contains($0.id) }
    }
}

/// Голосовой клип: слишком короткий выбрасывается, потолок записи — минута.
public enum VoiceClip {
    public static let minSeconds: TimeInterval = 0.5
    public static let maxSeconds: TimeInterval = 60

    public enum Verdict: Equatable { case discard, send }

    public static func verdict(duration: TimeInterval) -> Verdict {
        duration < minSeconds ? .discard : .send
    }
}

/// Ответ на ошибку голоса → ключ сообщения (`BoardL10n`). Код из тела сервера важнее статуса.
public enum VoiceFailure {
    public static func messageKey(status: Int?, body: Data?) -> String {
        guard let status else { return "voice.err.offline" }
        if status == 401 { return "voice.err.auth" }
        let code = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            .flatMap { $0["code"] as? String }
        switch code {
        case "nothing_heard": return "voice.err.nothing_heard"
        case "transcription_unavailable": return "voice.err.unavailable"
        case "audio_too_large": return "voice.err.too_long"
        case "demo_not_allowed": return "voice.err.demo"
        default: break
        }
        switch status {
        case 413: return "voice.err.too_long"
        case 403: return "voice.err.demo"
        case 422: return "voice.err.nothing_heard"
        case 502, 503, 504: return "voice.err.unavailable"
        default: return "voice.err.generic"
        }
    }
}

/// Созданная задача — для карточки «✓ Задача создана».
public struct CreatedTask: Equatable {
    public let id: String
    public let title: String
    public let description: String?
    public let country: String?
    public let dueDate: String?
    /// Что услышал сервер (только у голосовой).
    public let heard: String?

    public init(id: String, title: String, description: String? = nil, country: String? = nil,
                dueDate: String? = nil, heard: String? = nil) {
        self.id = id; self.title = title; self.description = description; self.country = country
        self.dueDate = dueDate; self.heard = heard
    }

    private struct TaskWire: Decodable {
        let id: String
        let title: String
        let description: String?
        let country: String?
        let due_date: String?
    }
    private struct VoiceWire: Decodable { let task: TaskWire; let heard: String? }

    /// `POST /tasks/voice` → `{task, heard}`.
    public static func parseVoice(_ data: Data) -> CreatedTask? {
        guard let w = try? JSONDecoder().decode(VoiceWire.self, from: data) else { return nil }
        return CreatedTask(id: w.task.id, title: w.task.title, description: w.task.description,
                           country: w.task.country, dueDate: w.task.due_date, heard: w.heard)
    }

    /// `POST /tasks` → сама задача.
    public static func parseTask(_ data: Data) -> CreatedTask? {
        guard let t = try? JSONDecoder().decode(TaskWire.self, from: data) else { return nil }
        return CreatedTask(id: t.id, title: t.title, description: t.description, country: t.country,
                           dueDate: t.due_date)
    }
}
