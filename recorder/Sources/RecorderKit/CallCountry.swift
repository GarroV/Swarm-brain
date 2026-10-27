import Foundation

// Экран страны во время созвона (решение владельца 27.10.2026, issue #1072). У серии события
// календаря есть признак страны; пока человек на созвоне, шмель показывает ВСЕ его открытые задачи
// этой страны. Сервер — GET/PUT swarm-api/board/call; здесь чистая логика: разбор ответа, что
// показать, когда звать сервер.

/// Ответ `GET/PUT /board/call`.
public struct CallCountryInfo: Equatable {
    public let seriesKey: String
    /// Метка серии; nil — не размечена.
    public let country: String?
    /// Страна, найденная сервером в названии созвона (только когда метки нет).
    public let suggested: String?
    /// ISO-коды, из которых можно выбрать (allowed_markets пространства).
    public let markets: [String]
    public let tasks: [BoardTask]

    public init(seriesKey: String, country: String? = nil, suggested: String? = nil,
                markets: [String] = [], tasks: [BoardTask] = []) {
        self.seriesKey = seriesKey; self.country = country; self.suggested = suggested
        self.markets = markets; self.tasks = tasks
    }

    /// Терпимый разбор: битая задача пропускается, пустая строка страны — «нет». nil — тело не объект
    /// или нет `series_key`.
    public static func parse(_ data: Data) -> CallCountryInfo? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let key = obj["series_key"] as? String, !key.isEmpty else { return nil }
        func code(_ v: Any?) -> String? {
            guard let s = (v as? String)?.trimmingCharacters(in: .whitespaces).uppercased(), !s.isEmpty else { return nil }
            return s
        }
        let tasks: [BoardTask] = ((obj["tasks"] as? [Any]) ?? []).compactMap { raw in
            guard let t = raw as? [String: Any], let id = t["id"] as? String, !id.isEmpty,
                  let title = t["title"] as? String,
                  !title.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return BoardTask(id: id, title: title, dueDate: t["due_date"] as? String,
                             status: (t["status"] as? String) ?? "open")
        }
        let country = code(obj["country"])
        return CallCountryInfo(seriesKey: key, country: country,
                               suggested: country == nil ? code(obj["suggested"]) : nil,
                               markets: ((obj["markets"] as? [String]) ?? []).compactMap { code($0) },
                               tasks: country == nil ? [] : tasks)
    }
}

/// Что панель показывает про созвон.
public enum CallCountryView: Equatable {
    case none
    /// Страна размечена: заголовок «Созвон · флаг страна» и задачи этой страны.
    case country(code: String, tasks: [BoardTask])
    /// Метки нет, название подсказало страну: «Это созвон по <стране>?».
    case ask(suggested: String)
    /// Выбор страны руками («Другая…», «Сменить страну», пункт меню).
    case pick(markets: [String], selected: String?)
}

public enum CallCountry {
    /// Ключ серии: identity_key без хвоста `:YYYY-MM-DD`. Ключ без даты — как есть.
    public static func seriesKey(of identityKey: String) -> String {
        guard let r = identityKey.range(of: #":\d{4}-\d{2}-\d{2}$"#, options: .regularExpression),
              r.lowerBound != identityKey.startIndex else { return identityKey }
        return String(identityKey[..<r.lowerBound])
    }

    /// Что показать по ответу сервера. «Нет» человека (`declined` — серия в локальном списке) гасит
    /// только вопрос: размеченная страна показывается всегда.
    public static func decide(_ info: CallCountryInfo?, declined: Bool) -> CallCountryView {
        guard let info else { return .none }
        if let c = info.country { return .country(code: c, tasks: info.tasks) }
        if let s = info.suggested, !declined, info.markets.isEmpty || info.markets.contains(s) { return .ask(suggested: s) }
        return .none
    }

    /// Созвон, где человек сидит: единственный со ссылкой, а при нескольких — тот, чья вкладка открыта.
    /// Несколько и ни одна не открыта — неизвестно (nil): страну чужого созвона не показываем.
    public static func currentCall<T>(_ meetings: [T], hasLink: (T) -> Bool, isOpen: (T) -> Bool) -> T? {
        let calls = meetings.filter(hasLink)
        return calls.count > 1 ? calls.first(where: isOpen) : calls.first
    }

    /// Флаг по ISO-коду из двух латинских букв (региональные индикаторы); иначе пусто.
    public static func flag(_ code: String) -> String {
        let up = code.uppercased()
        guard up.count == 2, up.unicodeScalars.allSatisfy({ $0.value >= 65 && $0.value <= 90 }) else { return "" }
        return String(String.UnicodeScalarView(up.unicodeScalars.compactMap { Unicode.Scalar(0x1F1E6 + $0.value - 65) }))
    }

    /// «🇷🇸 Сербия»; без флага (не ISO) — одно название.
    public static func label(_ code: String, lang: String) -> String {
        let f = flag(code)
        let name = BoardCountries.name(code, lang: lang)
        return f.isEmpty ? name : "\(f) \(name)"
    }

    /// Не копим «Нет» бесконечно: хранится не больше стольких серий, старые вытесняются.
    public static let declinedLimit = 200

    public static func remember(_ seriesKey: String, in list: [String]) -> [String] {
        let out = list.filter { $0 != seriesKey } + [seriesKey]
        return Array(out.suffix(declinedLimit))
    }
}

/// Когда звать сервер: один раз на ключ встречи за звонок; конец звонка сбрасывает.
public struct CallCountryTracker: Equatable {
    public enum Action: Equatable {
        case none
        case fetch(key: String)
        /// Звонок закончился после того, как мы его отслеживали: снять режим страны.
        case ended
    }

    private var fetchedKey: String?

    public init() {}

    /// Раз в тик. `micOn` — идёт реальный звонок; `key` — созвон из календаря, где человек сидит (nil —
    /// неизвестен: провал календаря посреди звонка режим не снимает).
    public mutating func tick(micOn: Bool, key: String?) -> Action {
        guard micOn else {
            defer { fetchedKey = nil }
            return fetchedKey == nil ? .none : .ended
        }
        guard let key, key != fetchedKey else { return .none }
        fetchedKey = key
        return .fetch(key: key)
    }

    /// Запрос не прошёл — следующий тик попробует снова.
    public mutating func failed(key: String) {
        if fetchedKey == key { fetchedKey = nil }
    }
}
