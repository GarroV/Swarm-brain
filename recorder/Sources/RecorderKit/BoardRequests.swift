import Foundation

// Построение запросов доски к swarm-api — чистые функции, чтобы адрес, порядок полей и тело
// multipart проверялись тестом, а не живым прогоном. Сетевой клиент (SwarmRecorder/BoardClient)
// только отправляет то, что собрано здесь.
public enum BoardRequests {
    /// `{ingestBase}/swarm-api/<path>?<query>`; nil — базовый адрес не разобрать.
    public static func apiURL(ingestBase: String, path: String, query: [(String, String)] = []) -> URL? {
        let base = ingestBase.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard var c = URLComponents(string: "\(base)/swarm-api/\(path)") else { return nil }
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) } }
        return c.url
    }

    /// Обмен токена рекордера на web-JWT: `{ingestBase}/meeting-webtoken` (соседняя функция, не маршрут swarm-api).
    public static func webTokenURL(ingestBase: String) -> URL? {
        let base = ingestBase.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: "\(base)/meeting-webtoken")
    }

    public static func todayURL(ingestBase: String, date: String, tzOffset: Int) -> URL? {
        apiURL(ingestBase: ingestBase, path: "board/today",
               query: [("date", date), ("tz_offset", String(tzOffset))])
    }

    /// multipart/form-data: сначала текстовые поля, потом файл `audio`.
    public static func multipart(boundary: String, audio: Data, filename: String, mime: String,
                                 fields: [(String, String)]) -> Data {
        var body = Data()
        func add(_ s: String) { body.append(Data(s.utf8)) }
        for (name, value) in fields {
            add("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n")
        add("Content-Type: \(mime)\r\n\r\n")
        body.append(audio)
        add("\r\n--\(boundary)--\r\n")
        return body
    }

    /// Тело `POST /tasks` для ручной задачи: сразу на себя, подтверждённая.
    public static func taskCreateBody(title: String, description: String, country: String?,
                                      dueDate: String, assigneeTelegramId: Int) -> Data? {
        var obj: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "due_date": dueDate,
            "assignee_telegram_id": assigneeTelegramId,
            "confirmed": true,
        ]
        let desc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !desc.isEmpty { obj["description"] = desc }
        if let country, !country.isEmpty { obj["country"] = country }
        return try? JSONSerialization.data(withJSONObject: obj)
    }

    /// `GET /me` → telegram_id.
    public static func parseMeID(_ data: Data) -> Int? {
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["telegram_id"] as? Int
    }

    /// `GET /config` → ISO-коды разрешённых рынков.
    public static func parseMarkets(_ data: Data) -> [String]? {
        ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["allowed_markets"] as? [String]
    }
}

/// Короткий словарь имён стран для выпадающего списка формы (сервер отдаёт только ISO-коды).
public enum BoardCountries {
    private static let names: [String: (ru: String, en: String)] = [
        "RS": ("Сербия", "Serbia"), "HR": ("Хорватия", "Croatia"), "SI": ("Словения", "Slovenia"),
        "ME": ("Черногория", "Montenegro"), "BG": ("Болгария", "Bulgaria"), "ES": ("Испания", "Spain"),
        "RO": ("Румыния", "Romania"), "PL": ("Польша", "Poland"), "EE": ("Эстония", "Estonia"),
        "LT": ("Литва", "Lithuania"), "CY": ("Кипр", "Cyprus"), "HU": ("Венгрия", "Hungary"),
        "MD": ("Молдова", "Moldova"), "BY": ("Беларусь", "Belarus"), "TR": ("Турция", "Turkey"),
        "AZ": ("Азербайджан", "Azerbaijan"), "AM": ("Армения", "Armenia"), "GE": ("Грузия", "Georgia"),
        "TJ": ("Таджикистан", "Tajikistan"), "KG": ("Кыргызстан", "Kyrgyzstan"), "MN": ("Монголия", "Mongolia"),
        "NG": ("Нигерия", "Nigeria"), "MX": ("Мексика", "Mexico"), "ID": ("Бали/Индонезия", "Bali/Indonesia"),
        "RU": ("Россия", "Russia"), "UA": ("Украина", "Ukraine"), "KZ": ("Казахстан", "Kazakhstan"),
        "UZ": ("Узбекистан", "Uzbekistan"), "AE": ("ОАЭ", "UAE"), "IN": ("Индия", "India"),
        "CH": ("Швейцария", "Switzerland"),
    ]

    /// Имя страны на языке интерфейса; неизвестный код — сам код (лучше код, чем пустота).
    public static func name(_ code: String, lang: String) -> String {
        guard let n = names[code.uppercased()] else { return code }
        return lang == "ru" ? n.ru : n.en
    }
}
