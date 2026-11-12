import Foundation

/// Выбор встречи на старте записи: не угадывать, а спросить (issue #1278, решение владельца
/// 11.11.2026, docs/decisions/2026-11-11-recorder-pick-not-guess.md).
///
/// Что случилось: при пересечении событий календаря или при встрече, которую пишет бот, рекордер сам
/// выбирал событие и привязывал запись к чужой встрече — запись признавали дублем (`superseded`) или
/// откладывали (`defer`), у владельца она пропадала. Теперь: больше одного кандидата (несколько
/// событий на это время ИЛИ событие, которое пишет/писал бот) — рекордер пишет сразу, но привязку
/// выбирает человек в карточке. Нет ответа к концу записи — запись становится СВОЕЙ ручной встречей
/// (`manual:<UUID>`), к календарному событию не привязывается.
///
/// Ядро: ошибка здесь молчалива — запись уедет в чужую встречу и просто не будет видна автору.
public enum StartPick {
    /// Событие календаря, идущее сейчас.
    public struct Event: Equatable, Sendable {
        public let key: String
        public let title: String?
        public init(key: String, title: String?) { self.key = key; self.title = title }
    }

    public enum Kind: Equatable, Sendable {
        case calendar        // событие календаря на это время
        case continuation    // встреча, которую писал/пишет бот: «Продолжение: <название>»
        case other           // «Другой звонок (не из календаря)»
    }

    public struct Option: Equatable, Sendable {
        public let kind: Kind
        public let key: String?     // ключ события; у `.other` его нет
        public let title: String?   // название события; у `.other` его нет
        public init(kind: Kind, key: String?, title: String?) { self.kind = kind; self.key = key; self.title = title }
    }

    /// К чему привязать запись по итогам выбора.
    public enum Resolution: Equatable, Sendable {
        case calendar(key: String)
        case manual
    }

    /// Нужно ли спрашивать. `botIn` — ключи, которые бот пишет прямо сейчас; `botLeft` — те, что он
    /// писал и уже вышел; `botTouched` — ключи, на которые бот приходил, пишет он или нет (`bot_touched`
    /// сервера: стоит у двери, закрытая комната, ушёл ни с чем; 12.11.2026 — иначе звонок человека
    /// молча липнет к встрече, куда бот не вошёл). Нет идущих событий — спрашивать не о чем (запись по
    /// комнате/manual). Одно событие и бот его не трогал — без вопроса, как раньше.
    public static func needsPick(live: [Event], botIn: Set<String>, botLeft: Set<String>,
                                 botTouched: Set<String> = []) -> Bool {
        guard !live.isEmpty else { return false }
        if live.count > 1 { return true }
        let botKeys = botIn.union(botLeft).union(botTouched)
        return live.contains { botKeys.contains($0.key) }
    }

    /// Пункты карточки по порядку; первый — подсказка. Бот уже вышел → «Продолжение» первым;
    /// бот ещё во встрече → «Другой звонок» первым (вы, скорее всего, пишете другой разговор);
    /// сигнала про бота нет → события календаря, «Другой звонок» в конце. Бот приходил, но не писал
    /// (`botTouched` без `botIn`/`botLeft`: у двери, закрытая комната) — «Другой звонок» первым, а
    /// встреча бота ниже как «Продолжение»: безопаснее не привязывать звонок к встрече, куда бот не вошёл.
    /// Если сигнала не хватает, чтобы выбрать «Продолжение», первым всегда «Другой звонок».
    public static func options(live: [Event], botIn: Set<String>, botLeft: Set<String>,
                               botTouched: Set<String> = []) -> [Option] {
        var seen = Set<String>()
        let unique = live.filter { seen.insert($0.key).inserted }
        let isBot: (Event) -> Bool = { botIn.contains($0.key) || botLeft.contains($0.key) || botTouched.contains($0.key) }
        let calendar = unique.filter { !isBot($0) }.map { Option(kind: .calendar, key: $0.key, title: $0.title) }
        let continuation = unique.filter(isBot).map { Option(kind: .continuation, key: $0.key, title: $0.title) }
        let other = Option(kind: .other, key: nil, title: nil)

        if continuation.isEmpty { return calendar + [other] }
        let botStillIn = unique.contains { botIn.contains($0.key) }
        let botAtDoor = unique.contains { botTouched.contains($0.key) && !botIn.contains($0.key) && !botLeft.contains($0.key) }
        return botStillIn || botAtDoor ? [other] + calendar + continuation : continuation + calendar + [other]
    }

    /// Итог. Нет ответа (`nil`) или «Другой звонок» — своя ручная встреча.
    public static func resolution(for answer: Option?) -> Resolution {
        guard let answer, answer.kind != .other, let key = answer.key else { return .manual }
        return .calendar(key: key)
    }

    /// Переименование в рекордере = своя встреча с этим названием, а не правка названия при старой
    /// привязке (11.11.2026 «Весела Болгария» уехала в чужое событие). Касается привязки к
    /// событию календаря; у комнаты и manual название и так не определяет встречу.
    public static func detachesOnRename(kind: String?, identityTitle: String?, override: String?) -> Bool {
        guard kind == "calendar", let new = normalized(override), !new.isEmpty else { return false }
        return new != normalized(identityTitle)
    }

    /// Ключ своей ручной встречи. Один на запись: повтор заявки не плодит встреч.
    public static func manualKey(_ id: UUID = UUID()) -> String { "manual:\(id.uuidString)" }

    private static func normalized(_ s: String?) -> String? {
        s?.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
