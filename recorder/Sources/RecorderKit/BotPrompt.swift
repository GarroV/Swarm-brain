import Foundation

// Вопрос «Встречу записывает Скриба — продолжить запись рекордером?» (решение владельца 07.10.2026,
// docs/decisions/2026-10-07-bot-priority-recorder-prompt.md): бот в приоритете, а человек, чей
// рекордер пишет ту же встречу, выбирает сам — писать дальше или остановиться.
//
// Когда спрашивать. Сервер отдаёт в `recorded_now` (meeting-current, #821) встречи человека, которые
// прямо сейчас пишет бот:
//   • запись идёт по встрече из календаря — спрашиваем, только если в списке ЕЁ ключ: бот может
//     писать другую встречу человека, пересекающуюся по времени (D027);
//   • запись без календаря (звонок по микрофону или вручную) — ключа, по которому сверить, нет:
//     спрашиваем при непустом списке, как #821 гасит по нему предложение записать.
// Один раз за запись: ответ человека не переспрашивается каждые полминуты тика.
public enum BotPrompt {
    public static let title = "Встречу записывает Скриба"
    public static let question = "Продолжить запись рекордером?"
    public static let keep = "Продолжить"
    public static let stop = "Остановить"

    /// - Parameters:
    ///   - recordingKey: ключ встречи текущей записи (nil — записи нет).
    ///   - isCalendar: запись идёт по встрече из календаря.
    ///   - recordedNow: ключи встреч, которые сейчас пишет бот.
    ///   - alreadyAsked: в этой записи уже спрашивали.
    public static func shouldAsk(
        recordingKey: String?,
        isCalendar: Bool,
        recordedNow: [String],
        alreadyAsked: Bool
    ) -> Bool {
        guard let recordingKey, !alreadyAsked, !recordedNow.isEmpty else { return false }
        return isCalendar ? recordedNow.contains(recordingKey) : true
    }
}
