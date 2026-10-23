import Foundation

// Словарь НОВЫХ строк доски «Сегодня»: ключ → язык → текст. У рекордера общего i18n нет (старые
// строки остались как были); эта поверхность заведена словарём, а не парами «ru/en», чтобы третий
// язык добавлялся одной записью в `dictionaries`, без правок вызывающих мест
// (решение владельца 19.10.2026: словари с первого коммита, не пары; план i18n — issue #1025).
// Язык — `Locale.preferredLanguages`: ru* → ru, остальное → en. Нет строки на языке — берём en,
// нет и там — показываем ключ (виден сразу, а не пустота).
public enum BoardL10n {
    public static let fallbackLanguage = "en"

    public static func language(preferred: [String] = Locale.preferredLanguages) -> String {
        guard let first = preferred.first?.lowercased() else { return fallbackLanguage }
        let code = first.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? first
        return dictionaries[code] != nil ? code : fallbackLanguage
    }

    public static func text(_ key: String, lang: String) -> String {
        dictionaries[lang]?[key] ?? dictionaries[fallbackLanguage]?[key] ?? key
    }

    public static func format(_ key: String, lang: String, _ args: CVarArg...) -> String {
        String(format: text(key, lang: lang), locale: Locale(identifier: lang), arguments: args)
    }

    /// Язык → (ключ → текст). Третий язык — ещё одна запись здесь.
    public static let dictionaries: [String: [String: String]] = ["ru": ru, "en": en]

    static let ru: [String: String] = [
        "board.title": "Сегодня",
        "board.menu": "Доска «Сегодня»",
        "app.quit": "Выйти из bumblebee",
        "board.pill.tip": "Доска «Сегодня»",
        "board.close": "Закрыть",
        "board.noToken": "Нужен токен — вставьте его через меню",
        "board.offline": "нет связи",
        "voice.button": "Продиктовать",
        "manual.button": "Вручную",
        "settings.meetings": "Показывать встречи",
        "tasks.header": "Задачи на сегодня",
        "tasks.add": "Добавить задачу",
        "tasks.more": "ещё %d → открыть в Swarm",
        "tasks.empty": "На сегодня всё",
        "tasks.checkFailed": "Не удалось отметить — попробуйте ещё раз",
        "meetings.header": "Встречи",
        "meetings.empty": "Встреч на сегодня нет",
        "meetings.join": "Подключиться",
        "meetings.untitled": "Встреча без названия",
        "meetings.reason.not_connected": "Календарь не подключён — подключите Google-календарь в Swarm",
        "meetings.reason.token_expired": "Доступ к календарю истёк — подключите его заново в Swarm",
        "meetings.reason.calendar_error": "Календарь сейчас не отвечает",
        "notes.placeholder": "Заметки дня",
        "notes.thesis": "Тезис",
        "notes.checklist.title": "Чек-лист",
        "notes.table.remove": "Убрать таблицу",
        "notes.check": "Чек-лист",
        "notes.table": "Таблица",
        "notes.clear": "Очистить",
        "notes.clear.ask": "Очистить блокнот целиком?",
        "notes.clear.yes": "Очистить",
        "notes.clear.no": "Отмена",
        "notes.toTask.tip": "Сделать задачей — срок и страна",
        "notes.footer": "Хранится только на этом Mac и не уходит в Swarm",
        "voice.recording": "Идёт запись…",
        "voice.hint": "нажмите ещё раз — отправить · Esc — отмена",
        "voice.sending": "Отправляю…",
        "voice.cancel": "Отмена",
        "voice.err.offline": "Нет связи — задача не создана",
        "voice.err.auth": "Токен не принят — обновите его через меню",
        "voice.err.nothing_heard": "Ничего не расслышал — попробуйте ещё раз",
        "voice.err.unavailable": "Расшифровка сейчас недоступна — попробуйте позже",
        "voice.err.too_long": "Запись слишком длинная",
        "voice.err.demo": "В демо голосовые задачи недоступны",
        "voice.err.generic": "Не удалось создать задачу",
        "voice.err.mic": "Нет доступа к микрофону — разрешите его в настройках macOS",
        "voice.err.start": "Не удалось начать запись",
        "card.created": "✓ Задача создана",
        "card.heard": "Услышал: %@",
        "card.undo": "Отменить · %d",
        "card.undone": "Задача отменена",
        "card.undoFailed": "Не удалось отменить — удалите задачу в Swarm",
        "due.today": "сегодня",
        "due.tomorrow": "завтра",
        "form.title": "Название",
        "form.description": "Описание",
        "form.country": "Страна",
        "form.country.none": "Без страны",
        "form.due": "Срок",
        "form.create": "Создать",
        "form.cancel": "Отмена",
        "form.err.title": "Введите название",
        "form.err.create": "Не удалось создать задачу",
    ]

    static let en: [String: String] = [
        "board.title": "Today",
        "board.menu": "Today board",
        "app.quit": "Quit bumblebee",
        "board.pill.tip": "Today board",
        "board.close": "Close",
        "board.noToken": "A token is required — paste it via the menu",
        "board.offline": "offline",
        "voice.button": "Dictate",
        "manual.button": "Add manually",
        "settings.meetings": "Show meetings",
        "tasks.header": "Tasks for today",
        "tasks.add": "Add a task",
        "tasks.more": "%d more → open in Swarm",
        "tasks.empty": "All clear for today",
        "tasks.checkFailed": "Could not mark as done — try again",
        "meetings.header": "Meetings",
        "meetings.empty": "No meetings today",
        "meetings.join": "Join",
        "meetings.untitled": "Untitled meeting",
        "meetings.reason.not_connected": "Calendar is not connected — connect Google Calendar in Swarm",
        "meetings.reason.token_expired": "Calendar access expired — reconnect it in Swarm",
        "meetings.reason.calendar_error": "Calendar is not responding right now",
        "notes.placeholder": "Notes for the day",
        "notes.thesis": "Note",
        "notes.checklist.title": "Checklist",
        "notes.table.remove": "Remove table",
        "notes.check": "Checklist",
        "notes.table": "Table",
        "notes.clear": "Clear",
        "notes.clear.ask": "Clear the whole notepad?",
        "notes.clear.yes": "Clear",
        "notes.clear.no": "Cancel",
        "notes.toTask.tip": "Make it a task — pick date and country",
        "notes.footer": "Stored on this Mac only, never sent to Swarm",
        "voice.recording": "Recording…",
        "voice.hint": "press again to send · Esc to cancel",
        "voice.sending": "Sending…",
        "voice.cancel": "Cancel",
        "voice.err.offline": "No connection — the task was not created",
        "voice.err.auth": "Token rejected — update it via the menu",
        "voice.err.nothing_heard": "Could not hear anything — try again",
        "voice.err.unavailable": "Transcription is unavailable right now — try later",
        "voice.err.too_long": "The recording is too long",
        "voice.err.demo": "Voice tasks are not available in the demo",
        "voice.err.generic": "Could not create the task",
        "voice.err.mic": "No microphone access — allow it in macOS settings",
        "voice.err.start": "Could not start recording",
        "card.created": "✓ Task created",
        "card.heard": "Heard: %@",
        "card.undo": "Undo · %d",
        "card.undone": "Task cancelled",
        "card.undoFailed": "Could not undo — delete the task in Swarm",
        "due.today": "today",
        "due.tomorrow": "tomorrow",
        "form.title": "Title",
        "form.description": "Description",
        "form.country": "Country",
        "form.country.none": "No country",
        "form.due": "Due",
        "form.create": "Create",
        "form.cancel": "Cancel",
        "form.err.title": "Enter a title",
        "form.err.create": "Could not create the task",
    ]
}
