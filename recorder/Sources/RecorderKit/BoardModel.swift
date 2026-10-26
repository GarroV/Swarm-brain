import Foundation

// Модель доски «Сегодня» (Bumblebee): разбор ответа `GET swarm-api/board/today` и обрезка списка.
// Канон: docs/decisions/2026-10-22-bumblebee-hub.md. Серверная сторона — supabase/functions/swarm-api/board.ts.
//
// Разбор терпимый: мусор в поле не должен ронять доску у человека, поэтому неверное поле → дефолт
// ЭТОГО поля, битый элемент списка → пропуск этого элемента, остальное живёт. Размеры доски
// приходят с сервера (правка без новой сборки), а значит могут быть любыми: пределы те же, что в
// `_shared/board-config.ts`.

/// Размеры доски. Дефолты и пределы — зеркало `_shared/board-config.ts`.
public struct BoardConfig: Equatable {
    public var taskRows: Int
    public var panelWidth: Int
    public var meetingsWidth: Int
    public var notesHeight: Int
    public var refreshSeconds: Int

    public static let defaults = BoardConfig(
        taskRows: 10, panelWidth: 720, meetingsWidth: 240, notesHeight: 260, refreshSeconds: 60)

    public init(taskRows: Int, panelWidth: Int, meetingsWidth: Int, notesHeight: Int, refreshSeconds: Int) {
        self.taskRows = taskRows
        self.panelWidth = panelWidth
        self.meetingsWidth = meetingsWidth
        self.notesHeight = notesHeight
        self.refreshSeconds = refreshSeconds
    }

    private enum Keys: String, CodingKey {
        case taskRows = "task_rows", panelWidth = "panel_width", meetingsWidth = "meetings_width"
        case notesHeight = "notes_height", refreshSeconds = "refresh_seconds"
    }

    private static func field(_ c: KeyedDecodingContainer<Keys>, _ key: Keys, _ range: ClosedRange<Int>, _ fallback: Int) -> Int {
        guard let v = try? c.decodeIfPresent(Int.self, forKey: key), range.contains(v) else { return fallback }
        return v
    }

    /// Любой JSON-значение → конфиг; не объект или не то поле — дефолт.
    static func decode(_ decoder: Decoder) -> BoardConfig {
        let d = BoardConfig.defaults
        guard let c = try? decoder.container(keyedBy: Keys.self) else { return d }
        return BoardConfig(
            taskRows: field(c, .taskRows, 1...50, d.taskRows),
            panelWidth: field(c, .panelWidth, 320...2000, d.panelWidth),
            meetingsWidth: field(c, .meetingsWidth, 120...800, d.meetingsWidth),
            notesHeight: field(c, .notesHeight, 80...1200, d.notesHeight),
            refreshSeconds: field(c, .refreshSeconds, 10...3600, d.refreshSeconds))
    }
}

public struct BoardTask: Equatable {
    public let id: String
    public let title: String
    public let dueDate: String?
    public let status: String

    public init(id: String, title: String, dueDate: String? = nil, status: String = "open") {
        self.id = id; self.title = title; self.dueDate = dueDate; self.status = status
    }
}

public struct BoardMeeting: Equatable {
    public let id: String
    public let title: String?
    public let startsAt: String
    public let endsAt: String
    public let joinURL: String?
    public let isNow: Bool
    public let isPast: Bool

    public init(id: String, title: String?, startsAt: String, endsAt: String,
                joinURL: String? = nil, isNow: Bool = false, isPast: Bool = false) {
        self.id = id; self.title = title; self.startsAt = startsAt; self.endsAt = endsAt
        self.joinURL = joinURL; self.isNow = isNow; self.isPast = isPast
    }

    public var start: Date? { BoardTime.parse(startsAt) }
    public var end: Date? { BoardTime.parse(endsAt) }
}

public struct BoardSnapshot: Equatable {
    public var config: BoardConfig
    public var tasks: [BoardTask]
    public var tasksTotal: Int
    public var meetings: [BoardMeeting]
    /// Почему встреч нет (календарь не подключён и т.п.); nil — календарь ответил.
    public var meetingsReason: String?

    public init(config: BoardConfig = .defaults, tasks: [BoardTask] = [], tasksTotal: Int? = nil,
                meetings: [BoardMeeting] = [], meetingsReason: String? = nil) {
        self.config = config
        self.tasks = tasks
        self.tasksTotal = max(tasksTotal ?? tasks.count, tasks.count)
        self.meetings = meetings
        self.meetingsReason = meetingsReason
    }

    /// Ответ сервера → снимок. nil — тело вообще не JSON-объект (тогда доска оставляет прежний снимок).
    public static func parse(_ data: Data) -> BoardSnapshot? {
        guard let wire = try? JSONDecoder().decode(Wire.self, from: data) else { return nil }
        return BoardSnapshot(
            config: wire.config.value,
            tasks: wire.tasks.items.compactMap { $0.model },
            tasksTotal: wire.tasksTotal,
            meetings: wire.meetings.items.compactMap { $0.model },
            meetingsReason: wire.meetingsReason)
    }

    // MARK: провода

    private struct Lossy<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }
    private struct LossyArray<T: Decodable>: Decodable {
        let items: [T]
        init(items: [T]) { self.items = items }
        init(from decoder: Decoder) throws {
            guard var c = try? decoder.unkeyedContainer() else { items = []; return }
            var out: [T] = []
            while !c.isAtEnd {
                if let v = try? c.decode(Lossy<T>.self).value { out.append(v) }
            }
            items = out
        }
    }
    private struct ConfigBox: Decodable {
        let value: BoardConfig
        init(value: BoardConfig) { self.value = value }
        init(from decoder: Decoder) throws { value = BoardConfig.decode(decoder) }
    }
    private struct TaskWire: Decodable {
        let id: String
        let title: String
        let due_date: String?
        let status: String?
        var model: BoardTask? {
            guard !id.isEmpty, !title.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return BoardTask(id: id, title: title, dueDate: due_date, status: status ?? "open")
        }
    }
    private struct MeetingWire: Decodable {
        let id: String
        let title: String?
        let starts_at: String
        let ends_at: String
        let join_url: String?
        let is_now: Bool?
        let is_past: Bool?
        var model: BoardMeeting? {
            guard !id.isEmpty else { return nil }
            return BoardMeeting(id: id, title: title, startsAt: starts_at, endsAt: ends_at, joinURL: join_url,
                                isNow: is_now ?? false, isPast: is_past ?? false)
        }
    }
    private struct Wire: Decodable {
        let config: ConfigBox
        let tasks: LossyArray<TaskWire>
        let tasksTotal: Int?
        let meetings: LossyArray<MeetingWire>
        let meetingsReason: String?
        private enum K: String, CodingKey { case config, tasks, tasks_total, meetings, meetings_reason }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            config = (try? c.decode(ConfigBox.self, forKey: .config)) ?? ConfigBox(value: .defaults)
            tasks = (try? c.decode(LossyArray<TaskWire>.self, forKey: .tasks)) ?? LossyArray(items: [])
            tasksTotal = try? c.decodeIfPresent(Int.self, forKey: .tasks_total)
            meetings = (try? c.decode(LossyArray<MeetingWire>.self, forKey: .meetings)) ?? LossyArray(items: [])
            meetingsReason = try? c.decodeIfPresent(String.self, forKey: .meetings_reason)
        }
    }
}

/// Обрезка списка задач до N строк и хвост «ещё N».
public enum BoardList {
    public static func trim(_ tasks: [BoardTask], rows: Int, total: Int) -> (visible: [BoardTask], more: Int) {
        let visible = Array(tasks.prefix(max(rows, 0)))
        return (visible, max(max(total, tasks.count) - visible.count, 0))
    }

    /// Какая встреча выделяется янтарём: идущая сейчас, иначе ближайшая из будущих. nil — все прошли.
    /// Решается по часам клиента, а не по флагам сервера: между обновлениями доски проходит до минуты.
    public static func highlightedMeetingID(_ meetings: [BoardMeeting], now: Date) -> String? {
        if let live = meetings.first(where: { m in
            if let s = m.start, let e = m.end { return s <= now && now < e }
            return m.isNow
        }) { return live.id }
        let upcoming = meetings.filter { m in
            if let s = m.start { return s > now }
            return !m.isPast && !m.isNow
        }
        return upcoming.min(by: { ($0.start ?? .distantFuture) < ($1.start ?? .distantFuture) })?.id
    }

    /// Встреча уже закончилась — рисуется бледнее.
    public static func isPast(_ m: BoardMeeting, now: Date) -> Bool {
        if let e = m.end { return e <= now }
        return m.isPast
    }
}

public enum BoardTime {
    /// ISO-8601 с долями секунды и без.
    public static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }
}
