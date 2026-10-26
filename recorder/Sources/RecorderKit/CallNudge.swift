import Foundation

// Напоминание «Звонок идёт, но не записывается» (решение владельца 26.10.2026). Повод: коллега
// закрыла крестиком предложение записать в первую минуту созвона и была уверена, что запись идёт;
// рекордер промолчал все 33 минуты, встреча потерялась.
//
// Владелец: «через 3 минуты после начала звонка… Если звонок идет, но при этом запись не включена,
// и скриба у нас тоже не записывает, должен появиться сообщение, записать или нет… обязательно
// должна быть связка со скрибой».
//
// Связка со Скрибой — `recorded_now` из meeting-current: встречи человека, которые прямо сейчас пишет
// бот (как в BotPrompt и #821). Один раз за звонок: «нет» не переспрашивается.
public enum CallNudge {
    /// Через сколько после начала звонка напоминать.
    public static let delaySeconds: TimeInterval = 3 * 60

    /// Пора ли напомнить: звонок идёт не меньше трёх минут, записи нет, за этот звонок ещё не напоминали.
    public static func isDue(callStartedAt: Date?, now: Date, isRecording: Bool, alreadyNudged: Bool) -> Bool {
        guard let callStartedAt, !isRecording, !alreadyNudged else { return false }
        return now.timeIntervalSince(callStartedAt) >= delaySeconds
    }

    /// Пишет ли Скриба созвон, в котором человек сидит.
    /// - Parameters:
    ///   - liveKeys: идущие созвоны из календаря.
    ///   - currentKey: созвон, где человек сидит (вкладка открыта, или созвон единственный); nil — неизвестно.
    ///   - recordedNow: ключи встреч, которые сейчас пишет бот.
    /// Созвон известен — смотрим только его: бот может писать соседнюю встречу (так было 26.10).
    /// Неизвестен — считаем записанным, только если бот пишет все идущие. Звонок без календаря
    /// сверить не по чему: записан, если бот что-то пишет (как #821 гасит предложение записать).
    public static func isCoveredByBot(liveKeys: [String], currentKey: String?, recordedNow: [String]) -> Bool {
        if let currentKey { return recordedNow.contains(currentKey) }
        if liveKeys.isEmpty { return !recordedNow.isEmpty }
        return liveKeys.allSatisfy { recordedNow.contains($0) }
    }
}
