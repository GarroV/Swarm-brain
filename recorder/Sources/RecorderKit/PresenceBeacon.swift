import Foundation

// Когда рекордер обязан сказать серверу, где сидит человек (issue #218, решение владельца
// 04.09.2026 — docs/decisions/2026-09-04-on-air-v-panele-vstrech.md).
//
// Панель «Встречи сегодня» зажигает `ON AIR` по этим данным и гасит его через пять минут
// тишины. Отсюда две границы:
//   • смену состояния отправляем СРАЗУ — иначе панель зовёт «Подключиться» туда, где человек
//     уже сидит, а после созвона ещё пять минут держит `ON AIR`;
//   • пока звонок идёт, повторяем не чаще keepAlive — детект тикает каждые 25 секунд, и без
//     троттла это 144 запроса в час на пустом месте.
// В простое молчим совсем: «рекордер жив» и так уходит обычным heartbeat раз в 15 минут.
public enum PresenceBeacon {
    /// Как часто напоминать о себе, пока звонок идёт. Панель считает присутствие живым 5 минут.
    public static let keepAlive: TimeInterval = 120

    public struct State: Equatable {
        /// Вход микрофона держит другое приложение — идёт реальный созвон.
        public let onCall: Bool
        /// Ключ встречи, которую рекордер при этом видит: «<uid>:<дата>».
        public let meetingKey: String?

        public init(onCall: Bool, meetingKey: String?) {
            self.onCall = onCall
            self.meetingKey = meetingKey
        }
    }

    public static func shouldSend(
        previous: State?,
        current: State,
        lastSentAt: Date?,
        now: Date
    ) -> Bool {
        guard let previous else { return true }        // первое известное состояние
        if current != previous { return true }          // начало/конец звонка, переход в другую встречу
        guard current.onCall else { return false }      // в простое повторяться незачем
        guard let lastSentAt else { return true }
        return now.timeIntervalSince(lastSentAt) >= keepAlive
    }
}
