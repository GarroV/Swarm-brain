import Foundation
import RecorderKit

// Клиент доски «Сегодня» к swarm-api. Свой, маленький: LiveNotesPanel ходит туда же своим кодом,
// и его не трогаем (путь записи встреч не меняем). Авторизация — web-JWT, который выдаёт обмен
// токена рекордера (`meeting-webtoken`); живёт 12 ч без продления, поэтому кэшируем и на 401
// выпускаем заново ОДИН раз.

enum BoardError: Error {
    case noConfig
    case offline                      // транспорт не прошёл — сети нет
    case auth                         // токен рекордера не принят (webtoken 401/403) или JWT не помог
    case http(status: Int, body: Data)
    case badResponse
}

final class BoardClient: @unchecked Sendable {
    /// JWT живёт 12 ч; берём с запасом, чтобы не нарваться на протухший посреди запроса.
    private static let jwtLifetime: TimeInterval = 11 * 3600

    private let lock = NSLock()
    private var jwt: (token: String, forRecorderToken: String, issued: Date)?
    private var cachedMeID: Int?
    private var cachedMarkets: [String]?

    // MARK: доска

    func today(config: SwarmConfig, now: Date = Date()) async throws -> BoardSnapshot {
        guard let url = BoardRequests.todayURL(ingestBase: config.ingestBaseURL, date: BoardDay.today(now: now),
                                               tzOffset: BoardDay.tzOffsetMinutes(now: now)) else { throw BoardError.noConfig }
        let (_, data) = try await send(config: config, method: "GET", url: url)
        guard let snap = BoardSnapshot.parse(data) else { throw BoardError.badResponse }
        return snap
    }

    func setStatus(config: SwarmConfig, taskId: String, done: Bool) async throws {
        guard let url = BoardRequests.apiURL(ingestBase: config.ingestBaseURL, path: "tasks/\(taskId)") else { throw BoardError.noConfig }
        let body = try JSONSerialization.data(withJSONObject: ["status": done ? "done" : "open"])
        _ = try await send(config: config, method: "PATCH", url: url, body: body, contentType: "application/json")
    }

    func deleteTask(config: SwarmConfig, taskId: String) async throws {
        guard let url = BoardRequests.apiURL(ingestBase: config.ingestBaseURL, path: "tasks/\(taskId)") else { throw BoardError.noConfig }
        _ = try await send(config: config, method: "DELETE", url: url)
    }

    // MARK: страна созвона

    /// Страна серии, подсказка и задачи этой страны (`GET /board/call`).
    func fetchCall(config: SwarmConfig, key: String, title: String?) async throws -> CallCountryInfo {
        guard let url = BoardRequests.callURL(ingestBase: config.ingestBaseURL, key: key, title: title) else { throw BoardError.noConfig }
        let (_, data) = try await send(config: config, method: "GET", url: url)
        guard let info = CallCountryInfo.parse(data) else { throw BoardError.badResponse }
        return info
    }

    /// Ставит (`country`) или снимает (nil) метку серии; ответ — как у GET, уже с задачами (`PUT /board/call`).
    func setCallCountry(config: SwarmConfig, key: String, country: String?) async throws -> CallCountryInfo {
        guard let url = BoardRequests.apiURL(ingestBase: config.ingestBaseURL, path: "board/call"),
              let body = BoardRequests.callCountryBody(key: key, country: country) else { throw BoardError.noConfig }
        let (_, data) = try await send(config: config, method: "PUT", url: url, body: body, contentType: "application/json")
        guard let info = CallCountryInfo.parse(data) else { throw BoardError.badResponse }
        return info
    }

    // MARK: создание задач

    func createVoiceTask(config: SwarmConfig, audio: Data, now: Date = Date()) async throws -> CreatedTask {
        guard let url = BoardRequests.apiURL(ingestBase: config.ingestBaseURL, path: "tasks/voice") else { throw BoardError.noConfig }
        let boundary = "bumblebee-\(UUID().uuidString)"
        let body = BoardRequests.multipart(
            boundary: boundary, audio: audio, filename: "voice.m4a", mime: "audio/mp4",
            fields: [("date", BoardDay.today(now: now)), ("tz_offset", String(BoardDay.tzOffsetMinutes(now: now)))])
        let (_, data) = try await send(config: config, method: "POST", url: url, body: body,
                                       contentType: "multipart/form-data; boundary=\(boundary)")
        guard let task = CreatedTask.parseVoice(data) else { throw BoardError.badResponse }
        return task
    }

    func createManualTask(config: SwarmConfig, title: String, description: String, country: String?,
                          dueDate: String) async throws -> CreatedTask {
        let me = try await meID(config: config)
        guard let url = BoardRequests.apiURL(ingestBase: config.ingestBaseURL, path: "tasks"),
              let body = BoardRequests.taskCreateBody(title: title, description: description, country: country,
                                                      dueDate: dueDate, assigneeTelegramId: me) else { throw BoardError.noConfig }
        let (_, data) = try await send(config: config, method: "POST", url: url, body: body, contentType: "application/json")
        guard let task = CreatedTask.parseTask(data) else { throw BoardError.badResponse }
        return task
    }

    /// ISO-коды рынков для выпадающего списка формы; один запрос за сессию.
    func markets(config: SwarmConfig) async throws -> [String] {
        if let cached = locked({ cachedMarkets }) { return cached }
        guard let url = BoardRequests.apiURL(ingestBase: config.ingestBaseURL, path: "config") else { throw BoardError.noConfig }
        let (_, data) = try await send(config: config, method: "GET", url: url)
        guard let list = BoardRequests.parseMarkets(data) else { throw BoardError.badResponse }
        locked { cachedMarkets = list }
        return list
    }

    private func meID(config: SwarmConfig) async throws -> Int {
        if let cached = locked({ cachedMeID }) { return cached }
        guard let url = BoardRequests.apiURL(ingestBase: config.ingestBaseURL, path: "me") else { throw BoardError.noConfig }
        let (_, data) = try await send(config: config, method: "GET", url: url)
        guard let id = BoardRequests.parseMeID(data) else { throw BoardError.badResponse }
        locked { cachedMeID = id }
        return id
    }

    // MARK: транспорт

    private func locked<T>(_ body: () -> T) -> T { lock.lock(); defer { lock.unlock() }; return body() }

    /// Запрос с web-JWT. 401 → один раз выпускаем JWT заново и повторяем. Любой не-2xx → `.http`.
    private func send(config: SwarmConfig, method: String, url: URL, body: Data? = nil,
                      contentType: String? = nil) async throws -> (Int, Data) {
        var token = try await webToken(config: config, forceRefresh: false)
        for attempt in 0..<2 {
            let (status, data) = try await perform(method: method, url: url, body: body, contentType: contentType, bearer: token)
            if status == 401, attempt == 0 {
                token = try await webToken(config: config, forceRefresh: true)
                continue
            }
            if status == 401 { throw BoardError.auth }
            guard (200..<300).contains(status) else { throw BoardError.http(status: status, body: data) }
            return (status, data)
        }
        throw BoardError.auth
    }

    private func perform(method: String, url: URL, body: Data?, contentType: String?, bearer: String) async throws -> (Int, Data) {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = body == nil ? 15 : 60
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        do {
            let (data, resp): (Data, URLResponse)
            if let body {
                // Content-Length обязателен для голоса (411 без него); upload(from:) выставляет его сам.
                (data, resp) = try await URLSession.shared.upload(for: req, from: body)
            } else {
                (data, resp) = try await URLSession.shared.data(for: req)
            }
            guard let http = resp as? HTTPURLResponse else { throw BoardError.badResponse }
            return (http.statusCode, data)
        } catch let e as BoardError {
            throw e
        } catch {
            throw BoardError.offline
        }
    }

    private func webToken(config: SwarmConfig, forceRefresh: Bool) async throws -> String {
        if !forceRefresh, let hit = locked({ jwt }),
           hit.forRecorderToken == config.token, Date().timeIntervalSince(hit.issued) < Self.jwtLifetime {
            return hit.token
        }
        guard let url = BoardRequests.webTokenURL(ingestBase: config.ingestBaseURL) else {
            throw BoardError.noConfig
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        let data: Data, status: Int
        do {
            let (d, resp) = try await URLSession.shared.data(for: req)
            data = d; status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            throw BoardError.offline
        }
        if status == 401 || status == 403 { throw BoardError.auth }
        guard status == 200, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = obj["jwt"] as? String else { throw BoardError.http(status: status, body: data) }
        locked { jwt = (token, config.token, Date()) }
        return token
    }
}
