import Foundation

// Пропуски бота: встреча, на которую scriba не пошёл или не дошёл (T162, решение D022).
//
// Сигнал идёт через bumblebee, а не через Telegram: рекордер «относительно всегда под рукой», и
// одним действием отсюда зовут бота. Сервер — `GET /meeting-missed` (токен рекордера) отдаёт
// открытые пропуски с готовым текстом на двух языках, `POST /meeting-missed {miss_id}` зовёт бота.
// Здесь — чистая логика без AppKit: разбор ответа, выбор языка, что показать и что погасить.
// Показывает и зовёт — SwarmRecorder/MissedMeetingsWatcher.swift.

/// Язык интерфейса рекордера. Пока рекордер целиком русский, а i18n-слоя нет (#205), язык один на
/// всё приложение и задан здесь; когда слой появится, значение поедет оттуда, а тексты ниже уже
/// заведены на обоих языках.
public enum RecorderLanguage: String, Sendable {
    case en, ru
    public static let current: RecorderLanguage = .ru
}

/// Текст на двух языках. Пустая строка на нужном языке — не повод показать пустоту: берём второй.
public struct LocalizedText: Decodable, Equatable, Sendable {
    public let en: String
    public let ru: String

    public init(en: String, ru: String) {
        self.en = en
        self.ru = ru
    }

    public func text(_ lang: RecorderLanguage) -> String {
        let primary = (lang == .ru ? ru : en).trimmingCharacters(in: .whitespacesAndNewlines)
        if !primary.isEmpty { return primary }
        return (lang == .ru ? en : ru).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Один пропуск — строка `misses[]` из `GET /meeting-missed`.
public struct MissedMeeting: Decodable, Equatable, Sendable {
    public let id: String
    public let reason: String
    public let title: String?
    public let startsAt: String?
    public let endsAt: String?
    public let canInvite: Bool
    public let message: LocalizedText

    public init(id: String, reason: String, title: String?, startsAt: String?, endsAt: String?,
                canInvite: Bool, message: LocalizedText) {
        self.id = id
        self.reason = reason
        self.title = title
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.canInvite = canInvite
        self.message = message
    }

    enum CodingKeys: String, CodingKey {
        case id, reason, title, message
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case canInvite = "can_invite"
    }
}

/// Ответ `GET /meeting-missed`.
public struct MissedList: Decodable, Equatable, Sendable {
    /// Автозапуск scriba у человека включён. Выключен — пропусков нет по определению (D021).
    public let autojoin: Bool
    /// Календарь человека сегодня снят. false — показано записанное раньше, свежей сверки не было.
    public let checked: Bool
    public let misses: [MissedMeeting]

    public init(autojoin: Bool, checked: Bool, misses: [MissedMeeting]) {
        self.autojoin = autojoin
        self.checked = checked
        self.misses = misses
    }

    public static func decode(_ data: Data) throws -> MissedList {
        try JSONDecoder().decode(MissedList.self, from: data)
    }
}

/// Что показать и что погасить после очередного опроса. Чистое значение: трекер не мутируется,
/// каждое событие возвращает новый трекер и список действий.
public struct MissedTracker: Equatable, Sendable {
    /// Пропуски, о которых человеку уже сказали баннером.
    public let announced: Set<String>
    /// Пропуски, по которым отсюда уже позвали бота: больше не показываются, даже если сервер
    /// ещё вернёт их в окне между приглашением и своей сверкой.
    public let invited: Set<String>
    /// Что сейчас открыто и видно человеку (меню).
    public let open: [MissedMeeting]

    public init(announced: Set<String> = [], invited: Set<String> = [], open: [MissedMeeting] = []) {
        self.announced = announced
        self.invited = invited
        self.open = open
    }

    public struct Update: Equatable, Sendable {
        /// Новые пропуски — показать баннер.
        public let announce: [MissedMeeting]
        /// Баннеры, которые пора снять: пропуск закрылся на сервере или по нему позвали бота.
        public let withdraw: [String]
    }

    /// Свежий список с сервера.
    public func applying(_ misses: [MissedMeeting]) -> (MissedTracker, Update) {
        let visible = misses.filter { !invited.contains($0.id) }
        let visibleIds = Set(visible.map(\.id))
        let fresh = visible.filter { !announced.contains($0.id) }
        let gone = announced.subtracting(visibleIds).sorted()
        let next = MissedTracker(announced: announced.intersection(visibleIds).union(fresh.map(\.id)),
                                 invited: invited.intersection(Set(misses.map(\.id))),
                                 open: visible)
        return (next, Update(announce: fresh, withdraw: gone))
    }

    /// Бота по пропуску позвали успешно — пропуск гаснет сразу, не дожидаясь следующего опроса.
    public func invitedBot(_ id: String) -> (MissedTracker, Update) {
        let next = MissedTracker(announced: announced.subtracting([id]),
                                 invited: invited.union([id]),
                                 open: open.filter { $0.id != id })
        return (next, Update(announce: [], withdraw: [id]))
    }

    /// Автозапуск выключен или токена нет — всё показанное снимается.
    public func cleared() -> (MissedTracker, Update) {
        (MissedTracker(), Update(announce: [], withdraw: announced.sorted()))
    }
}

/// Тексты рекордера про пропуски. Текст самого пропуска приходит с сервера (`message`).
public enum MissedTexts {
    public static let invitableTitle = LocalizedText(en: "The bot isn't in your meeting",
                                                     ru: "Бота нет на встрече")
    public static let notInvitableTitle = LocalizedText(en: "The bot won't come on its own",
                                                        ru: "Бот сам не придёт")
    public static let inviteAction = LocalizedText(en: "Invite the bot", ru: "Позвать бота")
    public static let invitedTitle = LocalizedText(en: "The bot is on its way", ru: "Бот позван")
    public static let invitedBodyFormat = LocalizedText(en: "Invite sent — the bot will join \u{201C}%@\u{201D}.",
                                                        ru: "Приглашение отправлено — бот зайдёт на «%@».")
    public static let untitled = LocalizedText(en: "untitled meeting", ru: "встреча без названия")
    public static let failedTitle = LocalizedText(en: "Couldn't invite the bot", ru: "Не удалось позвать бота")
    public static let menuItemFormat = LocalizedText(en: "Invite the bot to \u{201C}%@\u{201D}",
                                                     ru: "Позвать бота на «%@»")
    public static let notChecked = LocalizedText(en: "The calendar wasn't checked today — some missed meetings may not show",
                                                 ru: "Календарь сегодня не сверен — пропуски бота видны не все")
    public static let pollFailedFormat = LocalizedText(en: "Couldn't check missed meetings: %@",
                                                       ru: "Не удалось проверить пропуски бота: %@")
    public static let offline = LocalizedText(en: "no connection to the server — try again",
                                              ru: "нет связи с сервером — попробуйте ещё раз")
    public static let tokenInvalid = LocalizedText(en: "the recorder token is invalid — update it from the menu",
                                                   ru: "токен рекордера недействителен — обновите его в меню")
    public static let httpFormat = LocalizedText(en: "the server answered HTTP %d", ru: "сервер ответил HTTP %d")

    public static func meetingName(_ title: String?, _ lang: RecorderLanguage) -> String {
        let t = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? untitled.text(lang) : t
    }

    public static func invitedBody(_ title: String?, _ lang: RecorderLanguage) -> String {
        String(format: invitedBodyFormat.text(lang), meetingName(title, lang))
    }

    public static func menuItem(_ title: String?, _ lang: RecorderLanguage) -> String {
        String(format: menuItemFormat.text(lang), meetingName(title, lang))
    }
}

/// Почему не вышло — по-человечески, на языке интерфейса. Сервер отдаёт `{error, error_ru, code}`
/// (правила приглашений, `meeting-missed`); его текст главный. Нет текста — говорим по статусу,
/// но не молчим и не показываем сырое тело.
public enum MissedFailure {
    /// `status == nil` — до HTTP-ответа не дошли (сеть, таймаут).
    public static func text(status: Int?, body: Data?, lang: RecorderLanguage) -> String {
        guard let status else { return MissedTexts.offline.text(lang) }
        let parsed = body.flatMap { try? JSONDecoder().decode(ServerError.self, from: $0) }
        let own = (lang == .ru ? parsed?.errorRu : parsed?.error)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let own, !own.isEmpty { return own }
        if status == 401 { return MissedTexts.tokenInvalid.text(lang) }
        // Отказ по правилам (4xx) на чужом языке понятнее «HTTP 409»; сбой сервера (5xx) — нет.
        let other = (lang == .ru ? parsed?.error : parsed?.errorRu)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if status < 500, let other, !other.isEmpty { return other }
        return String(format: MissedTexts.httpFormat.text(lang), status)
    }

    private struct ServerError: Decodable {
        let error: String?
        let errorRu: String?
        enum CodingKeys: String, CodingKey {
            case error
            case errorRu = "error_ru"
        }
    }
}
