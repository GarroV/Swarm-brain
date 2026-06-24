import Foundation

// Очередь дозагрузки записей на диске. Решает потерю данных: раньше при ЛЮБОЙ ошибке загрузки
// .m4a сиротели в temporaryDirectory без ретрая. Теперь после успешного claim файлы
// ПЕРЕНОСятся в ~/Library/Application Support/SwarmRecorder/pending/<meetingId>/ с JSON-сайдкаром,
// и удаляются ТОЛЬКО после подтверждённого ingest. Дрейн — на старте приложения и после каждой
// записи; ретраи с бэкоффом; dead-letter после лимита попыток (meetingId переиспользуется, НЕ
// перезаклеймливается).
//
// Сайдкар (meta.json) описывает один pending-аплоад. systemSegments вместо одиночного path:
// системная дорожка может быть из нескольких файлов после пересборок тапа (см. SystemAudioCapturer),
// каждый со своим offset в таймлинии сессии.
struct PendingUpload: Codable {
    let meetingId: String
    var systemSegments: [Segment]   // ≥1; offset 0 у первого
    var micPath: String?            // относительный путь внутри папки meetingId, если есть
    var micStartOffset: Double?
    let startISO: String
    let endISO: String
    var attempts: Int

    struct Segment: Codable {
        let path: String            // относительный путь файла внутри папки meetingId
        let offset: Double
    }
}

// Файловое хранилище очереди: одна папка на meetingId, внутри — meta.json + файлы дорожек.
// Атомарная запись meta.json (во временный файл → replaceItem), чтобы не оставить полусайдкар.
actor UploadQueue {
    static let shared = UploadQueue()

    // Сколько раз пытаемся залить, прежде чем отправить в dead-letter (папку failed/).
    private static let maxAttempts = 12

    private let fm = FileManager.default
    private var draining = false

    private var rootDir: URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SwarmRecorder", isDirectory: true)
        return base.appendingPathComponent("pending", isDirectory: true)
    }
    private var deadLetterDir: URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SwarmRecorder", isDirectory: true)
        return base.appendingPathComponent("failed", isDirectory: true)
    }
    private func meetingDir(_ meetingId: String) -> URL {
        rootDir.appendingPathComponent(meetingId, isDirectory: true)
    }
    private func metaURL(_ meetingId: String) -> URL {
        meetingDir(meetingId).appendingPathComponent("meta.json")
    }

    // Сколько встреч ждёт загрузки — для строки «N в очереди» в меню.
    func pendingCount() -> Int { loadAll().count }

    // ── Постановка в очередь ──────────────────────────────────────────────────
    // Переносит файлы записи в pending/<meetingId>/ и пишет сайдкар. Вызывать ПОСЛЕ успешного
    // claim (meetingId известен), ДО первой попытки upload. Возвращает meetingId (для дрейна).
    // systemSegments/micURL — исходные файлы во временной папке; они ПЕРЕМЕЩАЮТСЯ (move).
    func enqueue(
        meetingId: String,
        systemSegments: [(url: URL, offset: Double)],
        micURL: URL?,
        micStartOffset: Double?,
        startISO: String,
        endISO: String
    ) throws {
        let dir = meetingDir(meetingId)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)

        var segs: [PendingUpload.Segment] = []
        for (i, s) in systemSegments.enumerated() {
            guard fm.fileExists(atPath: s.url.path) else { continue }
            let name = "sys\(i).m4a"
            let dst = dir.appendingPathComponent(name)
            try? fm.removeItem(at: dst)
            try fm.moveItem(at: s.url, to: dst)
            segs.append(PendingUpload.Segment(path: name, offset: s.offset))
        }
        guard !segs.isEmpty else { throw SwarmError.transport("enqueue: no system segments") }

        var micName: String?
        if let micURL, fm.fileExists(atPath: micURL.path) {
            let name = "mic.m4a"
            let dst = dir.appendingPathComponent(name)
            try? fm.removeItem(at: dst)
            try fm.moveItem(at: micURL, to: dst)
            micName = name
        }

        let pending = PendingUpload(
            meetingId: meetingId,
            systemSegments: segs,
            micPath: micName,
            micStartOffset: micStartOffset,
            startISO: startISO,
            endISO: endISO,
            attempts: 0
        )
        try writeMeta(pending)
    }

    // ── Дрейн ───────────────────────────────────────────────────────────────
    // Пытается залить все pending по очереди. Реентерабельность защищена флагом draining.
    // Между неуспешными попытками — пауза с бэкоффом (по числу attempts данной записи).
    func drain(config: SwarmConfig) async {
        if draining { return }
        draining = true
        defer { draining = false }

        for var pending in loadAll() {
            // attempts уже исчерпаны → dead-letter (на случай, если запись осталась с прошлого раза).
            if pending.attempts >= Self.maxAttempts {
                moveToDeadLetter(pending.meetingId)
                continue
            }
            do {
                try await upload(pending, config: config)
                // Успех — удаляем папку целиком (файлы + сайдкар).
                try? fm.removeItem(at: meetingDir(pending.meetingId))
            } catch let SwarmError.http(code, _, _) where !(500...599).contains(code) && code != 429 {
                // Постоянный сбой (401/403/413/404 и т.п.) — повторять бессмысленно → dead-letter.
                NSLog("SwarmRecorder: upload \(pending.meetingId) постоянный сбой HTTP \(code) → dead-letter")
                moveToDeadLetter(pending.meetingId)
            } catch {
                // Транзиентный сбой — увеличиваем счётчик, оставляем в очереди до следующего дрейна.
                pending.attempts += 1
                try? writeMeta(pending)
                NSLog("SwarmRecorder: upload \(pending.meetingId) попытка \(pending.attempts) не удалась: \(error)")
                if pending.attempts >= Self.maxAttempts {
                    moveToDeadLetter(pending.meetingId)
                }
            }
        }
    }

    // Один аплоад: сегментируем дорожки из pending-файлов и шлём ingest с переиспользованием
    // meetingId (claim НЕ повторяем). withRetry внутри SwarmClient покрывает короткие всплески.
    private func upload(_ pending: PendingUpload, config: SwarmConfig) async throws {
        let dir = meetingDir(pending.meetingId)
        let systemSegs: [(url: URL, offset: Double)] = pending.systemSegments.map {
            (url: dir.appendingPathComponent($0.path), offset: $0.offset)
        }
        let sysParts = try await Segmenter.segmentTrack(systemSegs)

        var micParts: [AudioPart] = []
        if let micPath = pending.micPath {
            let micURL = dir.appendingPathComponent(micPath)
            // Per-part offset — только внутри mic-дорожки (нарезка Segmenter'ом). Глобальный
            // сдвиг mic↔system (micStartOffset) применяет СЕРВЕР при сведении (он пришёл в claim),
            // здесь его НЕ прибавляем — иначе сдвиг учтётся дважды.
            micParts = try await Segmenter.segment(micURL)
        }

        let client = SwarmClient(config: config)
        _ = try await withRetry { try await client.uploadAudio(meetingID: pending.meetingId, system: sysParts, mic: micParts) }

        // Промежуточные файлы нарезки (если Segmenter их создал) — чистим, оригиналы удалит drain.
        for p in sysParts where !systemSegs.contains(where: { $0.url == p.url }) {
            try? fm.removeItem(at: p.url)
        }
        for p in micParts {
            let micURL = pending.micPath.map { dir.appendingPathComponent($0) }
            if p.url != micURL { try? fm.removeItem(at: p.url) }
        }
    }

    // ── Хранилище ─────────────────────────────────────────────────────────────
    private func loadAll() -> [PendingUpload] {
        guard let entries = try? fm.contentsOfDirectory(at: rootDir, includingPropertiesForKeys: nil) else { return [] }
        return entries.compactMap { entry in
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: entry.path, isDirectory: &isDir), isDir.boolValue else { return nil }
            let meta = entry.appendingPathComponent("meta.json")
            guard let data = try? Data(contentsOf: meta) else { return nil }
            return try? JSONDecoder().decode(PendingUpload.self, from: data)
        }
    }

    // Атомарная запись сайдкара: tmp → replaceItem (не оставляем полу-JSON при сбое).
    private func writeMeta(_ pending: PendingUpload) throws {
        let dir = meetingDir(pending.meetingId)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let dst = metaURL(pending.meetingId)
        let tmp = dir.appendingPathComponent("meta.json.tmp")
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted]
        let data = try enc.encode(pending)
        try data.write(to: tmp, options: .atomic)
        if fm.fileExists(atPath: dst.path) {
            _ = try fm.replaceItemAt(dst, withItemAt: tmp)
        } else {
            try fm.moveItem(at: tmp, to: dst)
        }
    }

    private func moveToDeadLetter(_ meetingId: String) {
        let src = meetingDir(meetingId)
        guard fm.fileExists(atPath: src.path) else { return }
        try? fm.createDirectory(at: deadLetterDir, withIntermediateDirectories: true)
        let dst = deadLetterDir.appendingPathComponent(meetingId, isDirectory: true)
        try? fm.removeItem(at: dst)
        do { try fm.moveItem(at: src, to: dst) }
        catch { NSLog("SwarmRecorder: dead-letter \(meetingId) не удался: \(error)") }
    }
}
