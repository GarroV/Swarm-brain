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

    // POST /meeting-ingest — загрузить аудио (multipart). Только если decision=transcribe.
    func uploadAudio(meetingID: String, fileURL: URL) async throws -> IngestResponse {
        let boundary = "swarm-\(UUID().uuidString)"
        var req = URLRequest(url: url("/meeting-ingest"))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        authed(&req)

        let audioData = try Data(contentsOf: fileURL)
        let filename = fileURL.lastPathComponent
        var body = Data()
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"meeting_id\"\r\n\r\n")
        append("\(meetingID)\r\n")

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n")
        append("Content-Type: audio/mp4\r\n\r\n")
        body.append(audioData)
        append("\r\n--\(boundary)--\r\n")

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
