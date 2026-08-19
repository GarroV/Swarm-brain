import Foundation

// Сигналы жизненного цикла загрузки для UI (виджет/уведомления). Постятся из актора,
// слушаются на .main (AppDelegate) — без протаскивания не-Sendable замыканий в актор.
extension Notification.Name {
    // Аудио встречи принято сервером (ingest 202) → встреча реально пошла в обработку.
    static let swarmMeetingUploaded = Notification.Name("SwarmMeetingUploaded")
    // summary_status='done' → стенограмма/тезисы в БД (обработка завершена).
    static let swarmMeetingDone = Notification.Name("SwarmMeetingDone")
}

// Очередь дозагрузки + ЛОКАЛЬНЫЙ БЭКАП записей на диске. Решает потерю данных:
// файлы после claim переносятся в ~/Library/Application Support/SwarmRecorder/pending/<meetingId>/
// с JSON-сайдкаром. Жизненный цикл бэкапа:
//   1. uploaded=false → грузим (ретраи с бэкоффом; постоянный сбой/лимит → dead-letter failed/).
//   2. после успешного 202 — НЕ удаляем (202 ≠ «обработано»): ставим uploaded=true, файлы остаются
//      бэкапом на случай сбоя серверной обработки.
//   3. опрос статуса (meeting-status): когда встреча ОПУБЛИКОВАНА в базу (status='in_base') —
//      запись уже у команды/в личном, аудио больше не нужно → удаляем папку. (summary_status='done'
//      бэкап НЕ удаляет — лишь гасит капсулу «в обработке»: пока вычитка не опубликована, держим
//      аудио как страховку, чтобы можно было перетранскрибировать/переобработать.)
//   4. 3-суточный потолок: всё (и pending/, и failed/) старше 3 суток сметается (sweepExpired) —
//      диск не растёт, а неопубликованная/застрявшая запись живёт достаточно, чтобы её заметить.
// Дрейн — на старте, после каждой записи и периодически. meetingId переиспользуется (НЕ перезаклейм).
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
    var uploaded: Bool?             // true после успешного 202; бэкап ждёт публикации в базу (in_base) или 3 суток
    // true — сервер отдал транскрибацию другому участнику (decision=defer). Такая запись лежит
    // в failed/ как бэкап (те же 3 суток) и НЕ грузится сама: аудио сохраняем, но не навязываем.
    // Пользователь может дослать её вручную — тогда флаг снимается и папка едет обратно в pending/.
    var deferred: Bool?
    // Чем повторно заявиться на встречу при «дослать». Без этого дозагрузка идёт сразу в ingest
    // (meetingId переиспользуется, claim не повторяется), а он отбивает 403 «not the transcription
    // owner» — право-то у другого участника. Поэтому для отклонённых записей храним заявку и
    // ПЕРЕЗАЯВЛЯЕМСЯ: арбитраж по длительности отдаст нам право, если наша запись действительно полнее.
    var claimRetry: ClaimRetry?

    struct ClaimRetry: Codable {
        let identityKind: String        // calendar | room | manual
        let identityKey: String
        let title: String?
        let startedAt: String?
        let endedAt: String?
        let recordedSeconds: Double?
    }

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
    // Бэкап исходного аудио держим до публикации в базу (in_base) или этого потолка — 3 суток.
    private static let backupTTLSec: TimeInterval = 3 * 24 * 60 * 60

    private let fm = FileManager.default
    private var draining = false
    // id встреч, по которым уже слали swarmMeetingDone (готов транскрипт) — чтобы не дёргать UI повторно
    // на каждом дрейне, пока встреча не опубликована и бэкап ещё лежит.
    private var doneNotified = Set<String>()

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

    // Сколько встреч ждёт ЗАГРУЗКИ — для строки «N в очереди». Залитые бэкапы (ждут done/24ч) не в счёт.
    func pendingCount() -> Int { loadAll().filter { !($0.uploaded ?? false) }.count }

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
        try stage(into: meetingDir(meetingId), meetingId: meetingId, systemSegments: systemSegments,
                  micURL: micURL, micStartOffset: micStartOffset,
                  startISO: startISO, endISO: endISO, deferred: false)
    }

    // ── Карантин отклонённой записи ───────────────────────────────────────────
    // Сервер отдал транскрибацию другому (decision=defer). Раньше клиент тут же УДАЛЯЛ файлы —
    // и трёхсуточный бэкап, который покрывает pending/ и failed/, до них не доходил вовсе:
    // они лежали в durable-папке recording/, минуя очередь. Так 17.08.2026 испарилась запись на
    // 2ч26м (инцидент #24). Теперь аудио переезжает в failed/<meetingId>/ с обычным сайдкаром:
    // тот же sweepExpired даёт 3 суток, дрейн такие папки не трогает (deferred=true),
    // а пользователь может дослать запись вручную (resendDeferred).
    func quarantineDeferred(
        meetingId: String,
        systemSegments: [(url: URL, offset: Double)],
        micURL: URL?,
        micStartOffset: Double?,
        startISO: String,
        endISO: String,
        claimRetry: PendingUpload.ClaimRetry?
    ) throws {
        try fm.createDirectory(at: deadLetterDir, withIntermediateDirectories: true)
        try stage(into: deadLetterDir.appendingPathComponent(meetingId, isDirectory: true),
                  meetingId: meetingId, systemSegments: systemSegments,
                  micURL: micURL, micStartOffset: micStartOffset,
                  startISO: startISO, endISO: endISO, deferred: true, claimRetry: claimRetry)
    }

    // Перенос файлов записи в папку очереди + сайдкар. Общая часть enqueue/quarantineDeferred:
    // отличаются только целевой папкой и флагом deferred.
    private func stage(
        into dir: URL,
        meetingId: String,
        systemSegments: [(url: URL, offset: Double)],
        micURL: URL?,
        micStartOffset: Double?,
        startISO: String,
        endISO: String,
        deferred: Bool,
        claimRetry: PendingUpload.ClaimRetry? = nil
    ) throws {
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
        guard !segs.isEmpty else { throw SwarmError.transport("stage: no system segments") }

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
            attempts: 0,
            uploaded: false,
            deferred: deferred ? true : nil,
            claimRetry: claimRetry
        )
        try writeMetaAt(dir: dir, pending)
    }

    // Сколько отклонённых записей лежит в карантине и ещё не истекло — для пункта меню
    // «Дослать мою запись». Считаем по сайдкару, а не по имени папки: в failed/ попадают и
    // записи, исчерпавшие ретраи (у них deferred не выставлен).
    func deferredIds() -> [String] {
        guard let entries = try? fm.contentsOfDirectory(at: deadLetterDir, includingPropertiesForKeys: nil) else { return [] }
        return entries.compactMap { entry in
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: entry.path, isDirectory: &isDir), isDir.boolValue,
                  let data = try? Data(contentsOf: entry.appendingPathComponent("meta.json")),
                  let p = try? JSONDecoder().decode(PendingUpload.self, from: data),
                  p.deferred == true
            else { return nil }
            return p.meetingId
        }
    }

    // Итог попытки дослать отклонённую запись — чтобы UI сказал правду, а не промолчал.
    enum ResendOutcome {
        case sent                       // право получено, запись ушла в дрейн
        case stillDeferred(String?)     // сервер снова отказал (в скобках — кто держит право)
        case failed(String)             // не дошли до решения (сеть/диск)
    }

    // «Дослать всё равно». ВАЖНО: сначала ПЕРЕЗАЯВКА (claim) с длительностью нашей записи, и лишь
    // потом заливка. Обычный дрейн claim не повторяет (meetingId переиспользуется), поэтому без
    // перезаявки ingest отбил бы 403 «not the transcription owner» — право у другого участника.
    // Арбитраж в meeting-claim отдаст право, только если наша запись заметно полнее; при отказе
    // папка остаётся в карантине (аудио не теряем и в pending/ не мусорим).
    func resendDeferred(_ meetingId: String, config: SwarmConfig) async -> ResendOutcome {
        let src = deadLetterDir.appendingPathComponent(meetingId, isDirectory: true)
        guard let data = try? Data(contentsOf: src.appendingPathComponent("meta.json")),
              var pending = try? JSONDecoder().decode(PendingUpload.self, from: data) else {
            return .failed("сайдкар записи не читается")
        }

        var targetId = meetingId
        if let retry = pending.claimRetry {
            let req = ClaimRequest(
                identityKind: IdentityKind(rawValue: retry.identityKind) ?? .manual,
                identityKey: retry.identityKey,
                title: retry.title,
                startedAt: retry.startedAt,
                endedAt: retry.endedAt,
                agentVersion: "0.1.0",
                micStartOffset: pending.micStartOffset,
                recordedSeconds: retry.recordedSeconds
            )
            do {
                let claim = try await SwarmClient(config: config).claim(req)
                guard claim.shouldTranscribe else { return .stillDeferred(claim.heldByName) }
                targetId = claim.meetingId
            } catch {
                return .failed("\(error)")
            }
        }

        let dst = meetingDir(targetId)
        try? fm.createDirectory(at: rootDir, withIntermediateDirectories: true)
        try? fm.removeItem(at: dst)
        do { try fm.moveItem(at: src, to: dst) }
        catch { return .failed("возврат из карантина не удался: \(error)") }
        // Сервер мог вернуть другой meetingId (напр. строку пересоздали) — идём с актуальным,
        // иначе ingest ушёл бы по мёртвому id.
        pending = PendingUpload(
            meetingId: targetId, systemSegments: pending.systemSegments, micPath: pending.micPath,
            micStartOffset: pending.micStartOffset, startISO: pending.startISO, endISO: pending.endISO,
            attempts: 0, uploaded: false, deferred: nil, claimRetry: nil)
        try? writeMeta(pending)
        await drain(config: config)
        return .sent
    }

    // ── Дрейн ───────────────────────────────────────────────────────────────
    // Пытается залить все pending по очереди. Реентерабельность защищена флагом draining.
    // Между неуспешными попытками — пауза с бэкоффом (по числу attempts данной записи).
    func drain(config: SwarmConfig) async {
        if draining { return }
        draining = true
        defer { draining = false }

        // (1) Потолок бэкапа: всё старше `backupTTLSec` (= 3 суток) в pending/ и failed/ сметаем.
        sweepExpired()

        // (2) Грузим ещё не залитые; залитые собираем для опроса статуса.
        var uploadedIds: [String] = []
        for var pending in loadAll() {
            if pending.uploaded ?? false {
                uploadedIds.append(pending.meetingId)
                continue
            }
            // attempts уже исчерпаны → dead-letter (на случай, если запись осталась с прошлого раза).
            if pending.attempts >= Self.maxAttempts {
                moveToDeadLetter(pending.meetingId)
                continue
            }
            do {
                try await upload(pending, config: config)
                // Успех (202) ≠ «обработано»: НЕ удаляем — оставляем бэкап до подтверждения done или 24ч.
                pending.uploaded = true
                try? writeMeta(pending)
                uploadedIds.append(pending.meetingId)
                // UI: запись принята сервером → «встреча пошла в обработку» (только на переходе false→true).
                NotificationCenter.default.post(name: .swarmMeetingUploaded, object: nil, userInfo: ["id": pending.meetingId])
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

        // (3) Опрос статуса залитых. Два независимых события:
        //   • summary='done' → транскрипт готов: гасим капсулу «в обработке» (один раз), бэкап НЕ трогаем.
        //   • published (status='in_base') → опубликовано в базу: аудио не нужно → удаляем бэкап.
        // Сетевой/4xx сбой опроса — НЕ удаляем (бэкап доживёт до следующего дрейна или до 3-суточного потолка).
        guard !uploadedIds.isEmpty else { return }
        if let statuses = try? await SwarmClient(config: config).fetchMeetingStatuses(uploadedIds) {
            for (id, st) in statuses {
                if st.summary == "done", doneNotified.insert(id).inserted {
                    NotificationCenter.default.post(name: .swarmMeetingDone, object: nil, userInfo: ["id": id])
                }
                if st.published {
                    try? fm.removeItem(at: meetingDir(id))
                    doneNotified.remove(id)
                    NSLog("SwarmRecorder: встреча \(id) опубликована в базу → локальный бэкап удалён")
                }
            }
        }
    }

    // 3-суточный потолок: удаляем папки бэкапа (pending/ и failed/) старше backupTTLSec — диск не растёт.
    private func sweepExpired() {
        let now = Date()
        for dir in [rootDir, deadLetterDir] {
            guard let entries = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { continue }
            for entry in entries {
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: entry.path, isDirectory: &isDir), isDir.boolValue else { continue }
                if folderAgeSeconds(entry, now: now) > Self.backupTTLSec {
                    NSLog("SwarmRecorder: бэкап \(entry.lastPathComponent) старше 3 суток → удаляю")
                    try? fm.removeItem(at: entry)
                }
            }
        }
    }

    // Возраст папки бэкапа: по endISO из meta (надёжно), иначе по mtime папки.
    private func folderAgeSeconds(_ dir: URL, now: Date) -> TimeInterval {
        let meta = dir.appendingPathComponent("meta.json")
        if let data = try? Data(contentsOf: meta),
           let p = try? JSONDecoder().decode(PendingUpload.self, from: data),
           let end = ISO8601DateFormatter().date(from: p.endISO) {
            return now.timeIntervalSince(end)
        }
        if let attrs = try? fm.attributesOfItem(atPath: dir.path), let m = attrs[.modificationDate] as? Date {
            return now.timeIntervalSince(m)
        }
        return 0
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
            micParts = try await Segmenter.segment(micURL, allowEmpty: true)
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
        try writeMetaAt(dir: meetingDir(pending.meetingId), pending)
    }

    // То же, но в произвольную папку очереди (pending/ или карантин failed/).
    private func writeMetaAt(dir: URL, _ pending: PendingUpload) throws {
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let dst = dir.appendingPathComponent("meta.json")
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
