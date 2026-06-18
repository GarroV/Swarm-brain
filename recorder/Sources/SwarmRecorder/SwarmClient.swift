import Foundation

enum SwarmError: Error, CustomStringConvertible {
    case http(Int, String)
    case transport(String)

    var description: String {
        switch self {
        case .http(let code, let body): return "HTTP \(code): \(body)"
        case .transport(let m): return "transport: \(m)"
        }
    }
}

// Клиент к Swarm Brain: claim (до загрузки) + upload аудио.
// Контракт проверен e2e на проде 2026-06-12.
struct SwarmClient {
    let config: SwarmConfig

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

        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            throw SwarmError.http(code, String(data: data, encoding: .utf8) ?? "")
        }
        return try decoder.decode(ClaimResponse.self, from: data)
    }

    // GET /meeting-current — идущая/ближайшая встреча из Google Calendar (на сервере).
    // nil, если Google не подключён / событий нет / сетевой сбой.
    func currentMeeting() async throws -> MeetingIdentity.Info? {
        var req = URLRequest(url: url("/meeting-current"))
        authed(&req)
        let (data, resp) = try await URLSession.shared.data(for: req)
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

    // POST /meeting-ingest — загрузить аудио (multipart). Только если decision=transcribe.
    // Контракт: sys_parts/mic_parts — JSON-манифест [{name,offset}] + файлы по этим name
    // (sys_0, sys_1, …; mic_0, …). Короткая встреча = одна часть с offset 0; длинная нарезана
    // Segmenter'ом на части ≤25 МБ. Сервер транскрибирует все части и сводит по таймстампам.
    func uploadAudio(meetingID: String, system: [AudioPart], mic: [AudioPart] = []) async throws -> IngestResponse {
        let boundary = "swarm-\(UUID().uuidString)"
        var req = URLRequest(url: url("/meeting-ingest"))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        authed(&req)

        var body = Data()
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }
        func textField(_ name: String, _ value: String) {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            append("\(value)\r\n")
        }
        func filePart(name: String, fileURL: URL) throws {
            let fileData = try Data(contentsOf: fileURL)
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(name).m4a\"\r\n")
            append("Content-Type: audio/mp4\r\n\r\n")
            body.append(fileData)
            append("\r\n")
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

        textField("meeting_id", meetingID)
        textField("sys_parts", try appendTrack(prefix: "sys", parts: system))
        if !mic.isEmpty {
            textField("mic_parts", try appendTrack(prefix: "mic", parts: mic))
        }
        append("--\(boundary)--\r\n")

        let (data, resp) = try await URLSession.shared.upload(for: req, from: body)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(code) else {
            throw SwarmError.http(code, String(data: data, encoding: .utf8) ?? "")
        }
        return try decoder.decode(IngestResponse.self, from: data)
    }
}

// Простой ретрай с бэкоффом для сетевых сбоев/5xx (очередь на диск — следующая итерация).
func withRetry<T>(_ attempts: Int = 4, _ op: @escaping () async throws -> T) async throws -> T {
    var lastError: Error = SwarmError.transport("no attempts")
    for i in 0..<attempts {
        do { return try await op() }
        catch let SwarmError.http(code, body) where !(500...599).contains(code) && code != 429 {
            // 4xx (кроме 429) — не ретраим, это не временный сбой
            throw SwarmError.http(code, body)
        }
        catch {
            lastError = error
            let delaySec = pow(2.0, Double(i))   // 1, 2, 4, 8с
            try? await Task.sleep(nanoseconds: UInt64(delaySec * 1_000_000_000))
        }
    }
    throw lastError
}
