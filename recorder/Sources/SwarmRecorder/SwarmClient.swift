import Foundation

enum SwarmError: Error, CustomStringConvertible {
    // http(код, тело, Retry-After в секундах если сервер прислал заголовок).
    // retryAfter нужен ретраю (429/503) — спим ровно столько, сколько просит сервер.
    case http(Int, String, retryAfter: TimeInterval?)
    case transport(String)

    // Удобный конструктор для кода, которому не важен Retry-After.
    static func http(_ code: Int, _ body: String) -> SwarmError {
        .http(code, body, retryAfter: nil)
    }

    var httpStatus: Int? {
        if case .http(let code, _, _) = self { return code }
        return nil
    }

    var isAuthExpired: Bool { httpStatus == 401 }

    var description: String {
        switch self {
        case .http(let code, let body, _): return "HTTP \(code): \(body)"
        case .transport(let m): return "transport: \(m)"
        }
    }
}

// Разобрать Retry-After: либо число секунд, либо HTTP-date. nil → заголовка нет/не распарсился.
private func parseRetryAfter(_ resp: URLResponse?) -> TimeInterval? {
    guard let http = resp as? HTTPURLResponse,
          let raw = http.value(forHTTPHeaderField: "Retry-After")?.trimmingCharacters(in: .whitespaces),
          !raw.isEmpty else { return nil }
    if let secs = TimeInterval(raw), secs >= 0 { return secs }
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US_POSIX")
    fmt.timeZone = TimeZone(identifier: "GMT")
    fmt.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    if let date = fmt.date(from: raw) {
        return max(0, date.timeIntervalSinceNow)
    }
    return nil
}

// Статус встречи глазами рекордера: транскрибация (`summary`) и публикация (`published`).
// Локальный бэкап аудио держим до `published` (опубликовано в базу) или до 3-суточного потолка.
struct MeetingStatus {
    let summary: String   // "" | "processing" | "done" | "failed"
    let published: Bool   // meetings.status == "in_base"
}

// Клиент к Swarm Brain: claim (до загрузки) + upload аудио.
// Контракт проверен e2e на проде 2026-06-12.
struct SwarmClient {
    let config: SwarmConfig

    // Своя сессия с явными таймаутами: дефолтный URLSession.shared имеет
    // timeoutIntervalForResource = 7 ДНЕЙ → зависший claim/upload висит почти вечно.
    // request = пауза между порциями данных (60с хватает и мгновенному claim, и медленному
    // upload — сбрасывается на каждый чанк); resource = жёсткий потолок на весь запрос (30 мин).
    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 60
        c.timeoutIntervalForResource = 30 * 60
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    private var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }
    private var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    private func url(_ path: String) -> URL {
        URL(string: config.ingestBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)!
    }

    private func authed(_ request: inout URLRequest) {
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
    }

    // POST /meeting-claim — застолбить транскрибацию. Возвращает meeting_id + decision.
    func claim(_ body: ClaimRequest) async throws -> ClaimResponse {
        var req = URLRequest(url: url("/meeting-claim"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authed(&req)
        req.httpBody = try encoder.encode(body)

        let (data, resp) = try await Self.session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            throw SwarmError.http(code, String(data: data, encoding: .utf8) ?? "", retryAfter: parseRetryAfter(resp))
        }
        return try decoder.decode(ClaimResponse.self, from: data)
    }

    // POST /meeting-heartbeat — «рекордер жив» + статус записи + версия сборки. Для серверного
    // watchdog (оборванная запись / истечение токена). Best-effort: ошибки глотаем — heartbeat
    // не критичен и не должен мешать записи/отправке.
    func heartbeat(recording: Bool, version: Int) async {
        var req = URLRequest(url: url("/meeting-heartbeat"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authed(&req)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["recording": recording, "version": version])
        _ = try? await Self.session.data(for: req)
    }

    // GET /meeting-current — идущая/ближайшая встреча из Google Calendar (на сервере).
    // nil, если Google не подключён / событий нет / сетевой сбой.
    func currentMeeting() async throws -> MeetingIdentity.Info? {
        var req = URLRequest(url: url("/meeting-current"))
        authed(&req)
        let (data, resp) = try await Self.session.data(for: req)
        guard (200...299).contains((resp as? HTTPURLResponse)?.statusCode ?? 0) else { return nil }
        struct M: Decodable {
            let identityKey: String
            let title: String?
            let attendees: [Attendee]?
            let startedAt: String?
            let endedAt: String?
        }
        struct Resp: Decodable { let meeting: M? }
        guard let m = try decoder.decode(Resp.self, from: data).meeting else { return nil }
        return MeetingIdentity.Info(kind: .calendar, key: m.identityKey, title: m.title,
                                    attendees: m.attendees ?? [], startISO: m.startedAt, endISO: m.endedAt)
    }

    // GET /meeting-status?ids=a,b,c → [meetingId: summary_status]. Нужно UploadQueue: локальный
    // Статус встречи для рекордера: `summary` (транскрибация: ""/processing/done/failed) гасит капсулу
    // «в обработке»; `published` (status=='in_base') — сигнал удалить локальный бэкап аудио. Возвращает
    // статусы только встреч вызывающего (claim_owner). Сетевой/4xx сбой бросаем наверх (бэкап не трогаем).
    func fetchMeetingStatuses(_ ids: [String]) async throws -> [String: MeetingStatus] {
        guard !ids.isEmpty else { return [:] }
        var comps = URLComponents(url: url("/meeting-status"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "ids", value: ids.joined(separator: ","))]
        var req = URLRequest(url: comps.url!)
        authed(&req)
        let (data, resp) = try await Self.session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            throw SwarmError.http(code, String(data: data, encoding: .utf8) ?? "", retryAfter: parseRetryAfter(resp))
        }
        struct Item: Decodable { let id: String; let summaryStatus: String?; let status: String? }
        struct Resp: Decodable { let statuses: [Item] }
        let decoded = try decoder.decode(Resp.self, from: data)
        var out: [String: MeetingStatus] = [:]
        for it in decoded.statuses {
            out[it.id] = MeetingStatus(summary: it.summaryStatus ?? "", published: it.status == "in_base")
        }
        return out
    }

    // POST /meeting-ingest — загрузить аудио (multipart). Только если decision=transcribe.
    // Контракт: sys_parts/mic_parts — JSON-манифест [{name,offset}] + файлы по этим name
    // (sys_0, sys_1, …; mic_0, …). Короткая встреча = одна часть с offset 0; длинная нарезана
    // Segmenter'ом на части ≤25 МБ. Сервер транскрибирует все части и сводит по таймстампам.
    // Размер чанка при потоковой записи файловых частей в конверт (1 MiB).
    // Файлы аудио могут быть до 25 МБ × N частей — держать их все в памяти Data() —
    // десятки-сотни МБ резидентно. Пишем конверт на диск чанками и грузим upload(fromFile:).
    private static let copyChunkBytes = 1 << 20

    func uploadAudio(meetingID: String, system: [AudioPart], mic: [AudioPart] = []) async throws -> IngestResponse {
        let boundary = "swarm-\(UUID().uuidString)"
        var req = URLRequest(url: url("/meeting-ingest"))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        authed(&req)

        // Конверт собираем в temp-файл (а не в память) → URLSession.upload(fromFile:).
        let envelopeURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("swarm-upload-\(UUID().uuidString).multipart")
        FileManager.default.createFile(atPath: envelopeURL.path, contents: nil)
        guard let handle = try? FileHandle(forWritingTo: envelopeURL) else {
            throw SwarmError.transport("cannot open upload envelope")
        }
        // Конверт — временный; чистим всегда, успех это или ошибка.
        defer {
            try? handle.close()
            try? FileManager.default.removeItem(at: envelopeURL)
        }

        func write(_ s: String) throws {
            guard let d = s.data(using: .utf8) else { throw SwarmError.transport("utf8 encode") }
            try handle.write(contentsOf: d)
        }
        func textField(_ name: String, _ value: String) throws {
            try write("--\(boundary)\r\n")
            try write("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            try write("\(value)\r\n")
        }
        // Файловую часть пишем потоково: заголовок строкой, тело — чанками по 1 MiB из
        // FileHandle источника (никогда не держим весь файл в памяти разом).
        func filePart(name: String, fileURL: URL) throws {
            try write("--\(boundary)\r\n")
            try write("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(name).m4a\"\r\n")
            try write("Content-Type: audio/mp4\r\n\r\n")
            guard let src = try? FileHandle(forReadingFrom: fileURL) else {
                throw SwarmError.transport("cannot read part \(name)")
            }
            defer { try? src.close() }
            while true {
                let chunk = try src.read(upToCount: Self.copyChunkBytes) ?? Data()
                if chunk.isEmpty { break }
                try handle.write(contentsOf: chunk)
            }
            try write("\r\n")
        }
        // Приложить файлы части по порядку и вернуть JSON-манифест [{name,offset}].
        func appendTrack(prefix: String, parts: [AudioPart]) throws -> String {
            var entries: [String] = []
            for (i, p) in parts.enumerated() {
                let fieldName = "\(prefix)_\(i)"
                try filePart(name: fieldName, fileURL: p.url)
                entries.append("{\"name\":\"\(fieldName)\",\"offset\":\(p.offset)}")
            }
            return "[" + entries.joined(separator: ",") + "]"
        }

        try textField("meeting_id", meetingID)
        // Манифест собираем ПОСЛЕ записи соответствующих файловых частей: порядок частей в
        // конверте не важен (сервер ищет файлы по name), а текстовые поля можно дописать в конец.
        let sysManifest = try appendTrack(prefix: "sys", parts: system)
        var micManifest: String?
        if !mic.isEmpty { micManifest = try appendTrack(prefix: "mic", parts: mic) }
        try textField("sys_parts", sysManifest)
        if let micManifest { try textField("mic_parts", micManifest) }
        try write("--\(boundary)--\r\n")

        try handle.synchronize()
        try? handle.close()

        let (data, resp) = try await Self.session.upload(for: req, fromFile: envelopeURL)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            throw SwarmError.http(code, String(data: data, encoding: .utf8) ?? "", retryAfter: parseRetryAfter(resp))
        }
        return try decoder.decode(IngestResponse.self, from: data)
    }
}

// Ретрай с full-jitter бэкоффом для сетевых сбоев/5xx/429.
//   • База 1с, экспонента 2^i, full jitter: задержка = random(base*exp/2 ... base*exp), кап 30с.
//     Jitter разводит одновременные ретраи нескольких рекордеров (thundering herd).
//   • Если сервер прислал Retry-After на 429/503 — уважаем его (спим ровно столько), кап 60с.
//   • 8 попыток вместо 4: прежние 4 (1+2+4≈7с) бросали транзиентный 429/5xx уже за ~15с.
//     8 даёт суммарно до ~неск. минут с джиттером — переживаем короткие всплески 429/5xx.
//   • 4xx кроме 429 — не ретраим (постоянный сбой: 401 токен, 403 не владелец, 413 размер).
func withRetry<T>(_ attempts: Int = 8, _ op: @escaping () async throws -> T) async throws -> T {
    let baseSec = 1.0
    let maxBackoffSec = 30.0
    let maxRetryAfterSec = 60.0

    // Full-jitter backoff: random(base*exp/2 ... base*exp), кап maxBackoffSec.
    func jitterBackoff(_ i: Int) -> Double {
        let exp = min(baseSec * pow(2.0, Double(i)), maxBackoffSec)
        return Double.random(in: (exp / 2)...exp)
    }
    // Сколько спать перед попыткой i+1: Retry-After если сервер прислал, иначе jitter-backoff.
    func sleepSec(_ i: Int, retryAfter: TimeInterval?) -> Double {
        if let ra = retryAfter, ra > 0 { return min(ra, maxRetryAfterSec) }
        return jitterBackoff(i)
    }

    var lastError: Error = SwarmError.transport("no attempts")
    for i in 0..<attempts {
        do { return try await op() }
        catch let SwarmError.http(code, body, retryAfter) {
            let transient = (500...599).contains(code) || code == 429
            if !transient {
                throw SwarmError.http(code, body, retryAfter: retryAfter)   // постоянный сбой
            }
            lastError = SwarmError.http(code, body, retryAfter: retryAfter)
            if i == attempts - 1 { break }
            try? await Task.sleep(nanoseconds: UInt64(sleepSec(i, retryAfter: retryAfter) * 1_000_000_000))
        }
        catch {
            lastError = error
            if i == attempts - 1 { break }
            try? await Task.sleep(nanoseconds: UInt64(jitterBackoff(i) * 1_000_000_000))
        }
    }
    throw lastError
}
