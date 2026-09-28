import Foundation

/// Брать ли календарную встречу как идентичность записи, начатой вручную (issue #379).
///
/// Раньше календарь попадал в запись, только если в капсуле висело календарное предложение:
/// «Записать» из меню и ответ на подсказку о звонке брали лишь ссылку комнаты, и живая встреча
/// писалась как `room`/`manual` — мимо склейки с записями коллег. Решение владельца 18.09.2026:
/// «календарь надо брать всегда». Оговорка владельца там же — запись могут включить на ОФЛАЙН
/// встрече, поэтому у человека остаётся пункт меню «это другая встреча», который отвязывает
/// запись от события.
///
/// Здесь только вопрос «годится ли то, что мы знаем о календаре, прямо сейчас»:
/// ответ сервера должен быть свежим (рекордер опрашивает раз в ~25 с; протухший ответ описывает
/// уже другую встречу), слот — идущим или начинающимся в пределах упреждения.
public enum StartIdentity {
    /// Старше этого ответ `meeting-current` не берём: ~3 пропущенных опроса подряд.
    public static let freshnessSeconds: TimeInterval = 90
    /// За сколько до начала слота встреча уже считается «этой» (сервер шлёт предстоящую за 5 мин).
    public static let leadSeconds: TimeInterval = 5 * 60

    public static func useCalendar(fetchedAt: Date?, start: Date?, end: Date?, now: Date) -> Bool {
        guard let fetchedAt, now.timeIntervalSince(fetchedAt) <= freshnessSeconds,
              now >= fetchedAt.addingTimeInterval(-freshnessSeconds) else { return false }
        if let start, now < start.addingTimeInterval(-leadSeconds) { return false }
        if let end, now > end { return false }
        return true
    }
}
