import Foundation

/// Раскладка доски «Сегодня» по тому, чего больше (решение владельца 23.10.2026): длинный
/// столбец получает то, что длиннее, остальное встаёт справа друг под другом.
public enum BoardArrangement: Equatable {
    /// Задачи | встречи сверху, блокнот снизу во всю ширину.
    case stacked
    /// Задачи столбцом слева; справа встречи, под ними блокнот.
    case tasksColumn
    /// Блокнот столбцом слева; справа задачи, под ними встречи.
    case notesColumn
}

public enum BoardLayout {
    /// На сколько одного должно быть больше другого, чтобы раскладка сменилась. Меньший перевес —
    /// обычная раскладка: столбец ради одной лишней строки только скачет туда-обратно.
    public static let dominance = 3

    public static func arrangement(tasks: Int, meetings: Int, showMeetings: Bool) -> BoardArrangement {
        let meetings = showMeetings ? meetings : 0
        if tasks >= meetings + dominance { return .tasksColumn }
        if showMeetings, meetings >= tasks + dominance { return .notesColumn }
        return .stacked
    }
}
