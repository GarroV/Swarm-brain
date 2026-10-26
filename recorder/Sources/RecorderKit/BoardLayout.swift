import Foundation

/// Раскладка доски «Сегодня» (решение владельца 26.10.2026, заменило «длинный столбец» от 23.10):
/// задачи всегда слева, встречи всегда справа, блокнот встаёт под тот столбец, который короче.
/// Владелец: «Слева задачи, справа у нас встречи. И заметки у нас перемещаются либо лево, либо
/// право, в зависимости от высоты столбика».
public enum BoardArrangement: Equatable {
    /// Встречи скрыты в настройках: задачи, под ними блокнот во всю ширину.
    case tasksOnly
    /// Задачи | встречи; блокнот под задачами.
    case notesUnderTasks
    /// Задачи | встречи; блокнот под встречами.
    case notesUnderMeetings
}

public enum BoardLayout {
    /// Высоту столбца считаем по числу строк: задач больше, чем встреч, — блокнот уходит под
    /// встречи, иначе остаётся под задачами (поровну — под задачами, привычное место).
    public static func arrangement(tasks: Int, meetings: Int, showMeetings: Bool) -> BoardArrangement {
        guard showMeetings else { return .tasksOnly }
        return tasks > meetings ? .notesUnderMeetings : .notesUnderTasks
    }
}
