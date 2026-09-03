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

// Участник встречи → meetings.attendees (шлём в claim) и приходит из meeting-current (Google).
struct Attendee: Codable, Sendable {
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
    // Сдвиг старта микрофонной дорожки относительно системной (сек, может быть < 0):
    //   micStartOffset = (момент первого сэмпла mic) − (момент первого сэмпла system).
    // Дорожки стартуют не строго одновременно (HAL-тап и AVAudioRecorder инициализируются
    // по-разному); без сдвига сервер сводит реплики «я» и «собеседник» с рассинхроном.
    // Кодируется как mic_start_offset (snake_case). nil → дорожки считаем синхронными.
    var micStartOffset: Double? = nil
    // Длительность НАШЕЙ записи (сек) — основа арбитража на сервере: право транскрибации
    // достаётся заметно более полной записи, а не тому, кто раньше нажал стоп. Без этого поля
    // побеждала самая короткая запись (инцидент 17.08.2026 — 3 минуты вместо 2ч26м).
    var recordedSeconds: Double? = nil
    // user_notes опускаем в MVP (окно пометок — следующая итерация)
}

struct ClaimResponse: Decodable {
    let meetingId: String
    let decision: String        // "transcribe" | "defer"
    let leaseTtlSec: Int?
    // Кто держит право транскрибации, когда нам отказали (для честного сообщения пользователю).
    let heldBy: Int?
    let heldByName: String?

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

// ── Контекст созвона «что было в прошлый раз» (issue #226) ───────────────────
// Отдаёт функция meeting-context ДВЕ НЕЗАВИСИМЫЕ вещи: тезисы последней встречи с этой
// стороной (страной) и задачи самой стороны. Они не связаны между собой — «задачи и тезисы
// никак и не должны соприкасаться, это разные вещи» (владелец). Считает сервер — панель
// только рисует: превью в узкие 312 pt нарезать на клиенте нечем, а полные тезисы
// на проде доходят до 24 КБ.
struct MeetingContext: Codable {
    struct Previous: Codable {
        let entry_id: String
        let title: String?
        let date: String
        /// Заголовки разделов тезисов — оглавление прошлой встречи.
        let sections: [String]
        /// Первые пункты (уже обрезанные сервером по длине).
        let bullets: [String]
        let total_bullets: Int
        /// Полный текст для раскрытия.
        let full_text: String
        /// Полный текст обрезан потолком — панель обязана это сказать (issue #112).
        let truncated: Bool
    }
    struct Task: Codable {
        let id: String
        let title: String
        let due_date: String?
        let assignees: [String]
        let status: String
    }
    let country: String?
    let meeting: Previous?
    let tasks: [Task]
    /// "no_country" — страну созвона определить не удалось; "no_previous_meeting" — первая встреча.
    let reason: String?
}
