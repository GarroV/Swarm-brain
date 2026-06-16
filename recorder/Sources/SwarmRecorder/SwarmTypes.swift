import Foundation

// Конфиг рекордера: персональный токen + базовые URL.
// Читается из ~/Library/Application Support/SwarmRecorder/config.json (см. README).
struct SwarmConfig: Codable {
    var token: String
    var ingestBaseURL: String   // напр. https://<ref>.supabase.co/functions/v1
    var webBaseURL: String

    static func configURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("SwarmRecorder", isDirectory: true)
            .appendingPathComponent("config.json")
    }

    static func load() throws -> SwarmConfig {
        let url = configURL()
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(SwarmConfig.self, from: data)
    }

    // Онбординг: сохранить персональный токен с зашитыми URL прод-окружения
    // (пользователю не нужно знать ingest/web URL — только вставить токен из бота).
    static func saveToken(_ token: String) throws {
        let cfg = SwarmConfig(
            token: token,
            ingestBaseURL: "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1",
            webBaseURL: "https://swarm-brain.pages.dev"
        )
        let url = configURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(cfg).write(to: url)
    }
}

// Тип идентичности встречи (см. 10-REVISED-DESIGN §3).
enum IdentityKind: String, Codable {
    case calendar
    case room
    case manual
}

// Участник встречи (из календаря) → meetings.attendees.
struct Attendee: Encodable, Sendable {
    let name: String?
    let email: String?
}

// ── Контракт meeting-claim (§7.1) ───────────────────────────────────────────────
struct ClaimRequest: Encodable {
    let identityKind: IdentityKind
    let identityKey: String
    var title: String?
    var startedAt: String?      // ISO 8601
    var endedAt: String?
    var attendees: [Attendee]? = nil
    var agentVersion: String?
    // user_notes опускаем в MVP (окно пометок — следующая итерация)
}

struct ClaimResponse: Decodable {
    let meetingId: String
    let decision: String        // "transcribe" | "defer"
    let leaseTtlSec: Int?

    var shouldTranscribe: Bool { decision == "transcribe" }
}

// ── Контракт meeting-ingest (§7.2): multipart audio ─────────────────────────────
struct IngestResponse: Decodable {
    let ok: Bool?
    let meetingId: String?
    let webUrl: String?
    let summaryStatus: String?  // "processing" | "skipped_human_edit"
    let error: String?
}
