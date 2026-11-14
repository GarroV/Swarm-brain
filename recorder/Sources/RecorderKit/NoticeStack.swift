import Foundation

// Собственные уведомления рекордера (решение владельца 09.11.2026,
// docs/decisions/2026-11-09-reminder-instead-of-autostart.md): вместо системных баннеров macOS и
// модальных NSAlert — карточки в стиле Swarm у капсулы. Здесь только чистая модель стопки:
// что показано, что заменено тем же id, что истекло. Окно и кнопки — SwarmRecorder/RecorderNotices.
public struct RecorderNotice: Equatable, Sendable {
    public struct Action: Equatable, Sendable {
        public let id: String
        public let title: String
        /// Главное действие заливается акцентом, остальные — приглушённая подложка.
        public let isPrimary: Bool

        public init(id: String, title: String, isPrimary: Bool = false) {
            self.id = id
            self.title = title
            self.isPrimary = isPrimary
        }
    }

    public let id: String
    public let title: String
    public let body: String
    public let actions: [Action]
    /// Через сколько секунд карточка уходит сама; nil — висит, пока человек её не закроет.
    public let lifetime: TimeInterval?

    public init(id: String, title: String, body: String = "", actions: [Action] = [],
                lifetime: TimeInterval? = NoticeStack.defaultLifetime) {
        self.id = id
        self.title = title
        self.body = body
        self.actions = actions
        self.lifetime = lifetime
    }
}

public struct NoticeStack: Equatable, Sendable {
    /// Столько живёт информационная карточка без действий.
    public static let defaultLifetime: TimeInterval = 20
    /// Больше карточек на экране не держим: старейшая уступает место новой.
    public static let maxVisible = 3

    private struct Entry: Equatable, Sendable {
        let notice: RecorderNotice
        let expiresAt: Date?
    }
    private var entries: [Entry] = []

    public init() {}

    /// Показанные карточки, новая первой.
    public var visible: [RecorderNotice] { entries.map(\.notice) }

    /// Карточка с тем же id заменяется на месте и получает свежий срок: повтор сообщения не
    /// плодит копий. Новая — наверх; сверх лимита уходит старейшая.
    public mutating func post(_ notice: RecorderNotice, now: Date) {
        let entry = Entry(notice: notice, expiresAt: notice.lifetime.map { now.addingTimeInterval($0) })
        if let i = entries.firstIndex(where: { $0.notice.id == notice.id }) {
            entries[i] = entry
        } else {
            entries.insert(entry, at: 0)
            if entries.count > Self.maxVisible { entries.removeLast(entries.count - Self.maxVisible) }
        }
    }

    public mutating func dismiss(id: String) {
        entries.removeAll { $0.notice.id == id }
    }

    /// Убирает истёкшие; true — состав изменился и окно надо перерисовать.
    @discardableResult
    public mutating func expire(now: Date) -> Bool {
        let before = entries.count
        entries.removeAll { ($0.expiresAt ?? .distantFuture) <= now }
        return entries.count != before
    }
}
