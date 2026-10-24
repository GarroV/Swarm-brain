import Foundation

// Утренняя уборка блокнота доски (решение владельца 24.10.2026: «давай в 9 утра нового дня
// очищать зачеркнутые заметки»): в первый раз после 9:00 каждого дня отмеченные тезисы и
// пункты чек-листа уходят. Мак в 9:00 спал или шмель не работал — уборка при первом случае
// позже. Здесь только правило, без AppKit и таймеров — под тестом.
public enum NoteSweep {
    public static let hour = 9

    /// Последняя граница уборки к моменту `now`: сегодня 9:00, если оно уже наступило, иначе вчера 9:00.
    public static func lastBoundary(before now: Date, calendar: Calendar = .current) -> Date {
        let today = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: now) ?? now
        return today <= now ? today : (calendar.date(byAdding: .day, value: -1, to: today) ?? today)
    }

    /// Пора ли убирать. Уборки ещё не было ни разу (`lastSweep == nil`) — нет: первую уборку
    /// считаем от момента, когда правило появилось, а не стираем отмеченное сразу.
    public static func isDue(lastSweep: Date?, now: Date, calendar: Calendar = .current) -> Bool {
        guard let last = lastSweep else { return false }
        return last < lastBoundary(before: now, calendar: calendar)
    }

    /// Блокнот без отмеченного: уходят сделанные тезисы и пункты; название чек-листа уходит,
    /// если у него были пункты и все они сделаны. Таблицы не трогаем.
    public static func removingDone(_ blocks: [NoteBlock]) -> [NoteBlock] {
        var kept: [NoteBlock] = []
        var i = 0
        while i < blocks.count {
            let block = blocks[i]
            guard block.isTitle else {
                if !block.isDone { kept.append(block) }
                i += 1
                continue
            }
            var end = i
            while end + 1 < blocks.count, case .check = blocks[end + 1] { end += 1 }
            let items = blocks[(i + 1)..<(end + 1)]
            let left = items.filter { !$0.isDone }
            if items.isEmpty || !left.isEmpty { kept.append(block) }
            kept.append(contentsOf: left)
            i = end + 1
        }
        return NoteBlocks.normalized(kept)
    }
}
