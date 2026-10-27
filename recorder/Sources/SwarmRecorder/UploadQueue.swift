import Foundation
import RecorderKit

// Сигналы жизненного цикла загрузки для UI (виджет/уведомления). Постятся из актора,
// слушаются на .main (AppDelegate) — без протаскивания не-Sendable замыканий в актор.
extension Notification.Name {
    // Аудио встречи принято сервером (ingest 202) → встреча реально пошла в обработку.
    static let swarmMeetingUploaded = Notification.Name("SwarmMeetingUploaded")
    // summary_status='done' → стенограмма/тезисы в БД (обработка завершена).
    static let swarmMeetingDone = Notification.Name("SwarmMeetingDone")
}

// Очередь дозагрузки + ЛОКАЛЬНЫЙ БЭКАП записей на диске. Принцип (решение владельца 27.10.2026,
// issue #1070): всё, что рекордер записал, не теряется — между потерей записи и лишними токенами
// выбираем токены. Файлы после claim переносятся в
// ~/Library/Application Support/SwarmRecorder/pending/<meetingId>/ с JSON-сайдкаром.
// Жизненный цикл записи:
//   1. uploaded=false → грузим (ретраи с бэкоффом).
//   2. Успех (202) — НЕ удаляем (202 ≠ «обработано»): uploaded=true, файлы остаются бэкапом.
//      Опрос статуса (meeting-status): встреча ОПУБЛИКОВАНА (status='in_base') → удаляем папку.
//      (summary_status='done' лишь гасит капсулу «в обработке».)
//   3. КАРАНТИН failed/<meetingId>/ (deferred=true + quarantineReason) — сюда ведут три пути:
//      сервер отдал транскрибацию другому (deferred), постоянный сбой заливки 4xx (rejected),
//      исчерпаны 12 попыток (exhausted). Раньше два последних уходили в тихий dead-letter без
//      возможности дослать. Из карантина запись видна в «Дослать мою запись» и вручную, и:
//      • БЭКАП НА СЕРВЕР — один раз на запись: тот же meeting-ingest с backup_only=1 (сервер не
//        распознаёт и строку встречи не трогает, хранит 3 суток). Успех → backupUploaded=true;
//        временный сбой — повтор на следующих дрейнах до BackupPolicy.maxBackupAttempts;
//        постоянный 4xx — backupGaveUp, больше не пробуем. Локальная копия не удаляется.
//      • АВТОДОСЫЛКА — не чаще раза в 20 минут повторная заявка (claim) по claimRetry. Право
//        получено → папка возвращается в pending/ и заливается как обычно; отказ «published» или
//        постоянный 4xx — больше не пробуем; иначе повтор через интервал.
//   4. 3-суточный потолок: всё (и pending/, и failed/) старше 3 суток (от конца встречи) сметается
//      (sweepExpired) — диск не растёт. Сервер держит свою копию бэкапа столько же.
// Решения («слать ли бэкап», «пора ли перезаявляться», «постоянный ли сбой») — чистая логика в
// RecorderKit/BackupPolicy. Дрейн — на старте, после каждой записи и периодически.
// meetingId переиспользуется (НЕ перезаклейм), кроме автодосылки/«Дослать» — там заявка повторяется.
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
    // Почему запись в карантине (QuarantineReason.rawValue) — уходит на сервер полем `reason` бэкапа.
    var quarantineReason: String?
    // Бэкап на сервер (#1070): залит один раз; временные сбои считаем, постоянный — закрывает попытки.
    var backupUploaded: Bool?
    var backupId: String?
    var backupAttempts: Int?
    var backupGaveUp: Bool?
    // Автодосылка: когда в последний раз подавали claim (epoch, сек) и «больше не пробовать».
    var lastReclaimAt: Double?
    var reclaimStopped: Bool?

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
        endISO: String,
        claimRetry: PendingUpload.ClaimRetry? = nil
    ) throws {
        // claimRetry нужен на случай, если заливка сорвётся и запись уйдёт в карантин: без него
        // автодосылка и «Дослать» не знают, с чем перезаявиться (#1070).
        try stage(into: meetingDir(meetingId), meetingId: meetingId, systemSegments: systemSegments,
                  micURL: micURL, micStartOffset: micStartOffset,
                  startISO: startISO, endISO: endISO, deferred: false, claimRetry: claimRetry)
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
                  startISO: startISO, endISO: endISO, deferred: true, claimRetry: claimRetry,
                  quarantineReason: .deferred)
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
        claimRetry: PendingUpload.ClaimRetry? = nil,
        quarantineReason: QuarantineReason? = nil
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
            claimRetry: claimRetry,
            quarantineReason: quarantineReason?.rawValue,
            // Заявку только что подавали (она и привела сюда) — следующая не раньше интервала.
            lastReclaimAt: quarantineReason == nil ? nil : Date().timeIntervalSince1970
        )
        try writeMetaAt(dir: dir, pending)
    }

    // Сколько отклонённых записей лежит в карантине и ещё не истекло — для пункта меню
    // «Дослать мою запись». Считаем по сайдкару, а не по имени папки: в failed/ попадают и
    // записи с постоянным сбоем заливки и исчерпавшие ретраи — они тоже получают deferred=true
    // (moveToQuarantine), так что досылаются так же, как отклонённые (#1070).
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
              let pending = try? JSONDecoder().decode(PendingUpload.self, from: data) else {
            return .failed("сайдкар записи не читается")
        }

        var targetId = meetingId
        if let retry = pending.claimRetry {
            do {
                let claim = try await SwarmClient(config: config).claim(Self.claimRequest(retry, pending))
                guard claim.shouldTranscribe else { return .stillDeferred(claim.heldByName) }
                targetId = claim.meetingId
            } catch {
                return .failed("\(error)")
            }
        }

        do { try returnToPending(from: src, pending: pending, targetId: targetId) }
        catch { return .failed("возврат из карантина не удался: \(error)") }
        await drain(config: config)
        return .sent
    }

    private static func claimRequest(_ retry: PendingUpload.ClaimRetry, _ pending: PendingUpload) -> ClaimRequest {
        ClaimRequest(
            identityKind: IdentityKind(rawValue: retry.identityKind) ?? .manual,
            identityKey: retry.identityKey,
            title: retry.title,
            startedAt: retry.startedAt,
            endedAt: retry.endedAt,
            agentVersion: "0.1.0",
            micStartOffset: pending.micStartOffset,
            recordedSeconds: retry.recordedSeconds
        )
    }

    // Карантин → pending/ после полученного права. Сервер мог вернуть другой meetingId (напр. строку
    // пересоздали) — идём с актуальным, иначе ingest ушёл бы по мёртвому id. Флаги бэкапа
    // переносим: залитый бэкап не повторяем, если запись снова окажется в карантине.
    private func returnToPending(from src: URL, pending: PendingUpload, targetId: String) throws {
        let dst = meetingDir(targetId)
        try? fm.createDirectory(at: rootDir, withIntermediateDirectories: true)
        try? fm.removeItem(at: dst)
        try fm.moveItem(at: src, to: dst)
        var next = PendingUpload(
            meetingId: targetId, systemSegments: pending.systemSegments, micPath: pending.micPath,
            micStartOffset: pending.micStartOffset, startISO: pending.startISO, endISO: pending.endISO,
            attempts: 0, uploaded: false, deferred: nil, claimRetry: pending.claimRetry)
        next.backupUploaded = pending.backupUploaded
        next.backupId = pending.backupId
        try? writeMeta(next)
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

        // (1б) Автодосылка отклонённых: повторная заявка раз в 20 минут. Выигранные записи
        // вернутся в pending/ и уйдут в заливку ниже, в этом же дрейне.
        await reclaimQuarantined(config: config)

        // (2) Грузим ещё не залитые; залитые собираем для опроса статуса.
        var uploadedIds: [String] = []
        for var pending in loadAll() {
            if pending.uploaded ?? false {
                uploadedIds.append(pending.meetingId)
                continue
            }
            // attempts уже исчерпаны → dead-letter (на случай, если запись осталась с прошлого раза).
            if pending.attempts >= Self.maxAttempts {
                moveToQuarantine(pending.meetingId, reason: .exhausted)
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
            } catch let SwarmError.http(code, _, _) where BackupPolicy.isPermanentUploadFailure(httpStatus: code) {
                // Постоянный сбой (401/403/413/404 и т.п.) — повторять заливку бессмысленно → карантин:
                // запись видна в «Дослать», уедет бэкапом на сервер и будет перезаявляться.
                NSLog("SwarmRecorder: upload \(pending.meetingId) постоянный сбой HTTP \(code) → карантин")
                moveToQuarantine(pending.meetingId, reason: .rejected)
            } catch {
                // Транзиентный сбой — увеличиваем счётчик, оставляем в очереди до следующего дрейна.
                pending.attempts += 1
                try? writeMeta(pending)
                NSLog("SwarmRecorder: upload \(pending.meetingId) попытка \(pending.attempts) не удалась: \(error)")
                if pending.attempts >= Self.maxAttempts {
                    moveToQuarantine(pending.meetingId, reason: .exhausted)
                }
            }
        }

        // (2б) Бэкап на сервер всего, что в карантине (один раз на запись).
        await backupQuarantined(config: config)

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

    // Нарезка дорожек записи из папки очереди на части для multipart и подчистка временных файлов
    // нарезки после отправки (оригиналы остаются — их судьбу решает drain). Общая часть основной
    // заливки и бэкапа.
    private func withParts<T>(
        _ pending: PendingUpload, dir: URL,
        send: (_ system: [AudioPart], _ mic: [AudioPart]) async throws -> T
    ) async throws -> T {
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
        // Промежуточные файлы нарезки (если Segmenter их создал) — чистим при любом исходе.
        defer {
            for p in sysParts where !systemSegs.contains(where: { $0.url == p.url }) {
                try? fm.removeItem(at: p.url)
            }
            for p in micParts {
                let micURL = pending.micPath.map { dir.appendingPathComponent($0) }
                if p.url != micURL { try? fm.removeItem(at: p.url) }
            }
        }
        return try await send(sysParts, micParts)
    }

    // Один аплоад: шлём ingest с переиспользованием meetingId (claim НЕ повторяем).
    // withRetry внутри покрывает короткие всплески.
    private func upload(_ pending: PendingUpload, config: SwarmConfig) async throws {
        let client = SwarmClient(config: config)
        _ = try await withParts(pending, dir: meetingDir(pending.meetingId)) { sys, mic in
            try await withRetry { try await client.uploadAudio(meetingID: pending.meetingId, system: sys, mic: mic) }
        }
    }

    // ── Карантин: автодосылка и бэкап на сервер (#1070) ──────────────────────
    private func quarantineDir(_ meetingId: String) -> URL {
        deadLetterDir.appendingPathComponent(meetingId, isDirectory: true)
    }

    // Записи карантина с читаемым сайдкаром.
    private func loadQuarantined() -> [PendingUpload] {
        guard let entries = try? fm.contentsOfDirectory(at: deadLetterDir, includingPropertiesForKeys: nil) else { return [] }
        return entries.compactMap { entry in
            guard let data = try? Data(contentsOf: entry.appendingPathComponent("meta.json")) else { return nil }
            return try? JSONDecoder().decode(PendingUpload.self, from: data)
        }
    }

    // Возраст записи от конца встречи (как в sweepExpired) — для потолка 3 суток.
    private func ageSeconds(_ p: PendingUpload) -> TimeInterval {
        guard let end = ISO8601DateFormatter().date(from: p.endISO) else { return 0 }
        return Date().timeIntervalSince(end)
    }

    // Запись сайдкара карантина, только если папка ещё там: во время сетевого await её могли
    // забрать («Дослать») или смести — иначе writeMetaAt воскресил бы папку с одним meta.json.
    private func updateQuarantineMeta(_ p: PendingUpload) {
        let dir = quarantineDir(p.meetingId)
        guard fm.fileExists(atPath: dir.path) else { return }
        try? writeMetaAt(dir: dir, p)
    }

    // Повторная заявка для отклонённых записей: сервер мог освободить право (владелец прервал
    // запись, лиз истёк, наша запись оказалась полнее). Отказ токенов не стоит.
    private func reclaimQuarantined(config: SwarmConfig) async {
        for var p in loadQuarantined() {
            let now = Date()
            guard let retry = p.claimRetry,
                  BackupPolicy.shouldReclaim(
                    hasClaimRetry: true, stopped: p.reclaimStopped ?? false,
                    lastAttemptAt: p.lastReclaimAt.map { Date(timeIntervalSince1970: $0) },
                    ageSeconds: ageSeconds(p), now: now)
            else { continue }
            // Время попытки пишем ДО запроса: оборванный запрос не должен превращаться в долбёжку.
            p.lastReclaimAt = now.timeIntervalSince1970
            updateQuarantineMeta(p)

            let verdict: BackupPolicy.ReclaimVerdict
            do {
                let claim = try await SwarmClient(config: config).claim(Self.claimRequest(retry, p))
                verdict = BackupPolicy.afterReclaim(shouldTranscribe: claim.shouldTranscribe, deferReason: claim.deferReason)
                if verdict == .takeOver {
                    do {
                        try returnToPending(from: quarantineDir(p.meetingId), pending: p, targetId: claim.meetingId)
                        NSLog("SwarmRecorder: автодосылка \(p.meetingId) — право получено, запись вернулась в очередь")
                    } catch {
                        NSLog("SwarmRecorder: автодосылка \(p.meetingId) — возврат из карантина не удался: \(error)")
                    }
                    continue
                }
                NSLog("SwarmRecorder: автодосылка \(p.meetingId) — отказ (\(claim.deferReason ?? "?")), \(verdict == .stop ? "больше не пробуем" : "повтор через 20 мин")")
            } catch {
                verdict = BackupPolicy.afterReclaimError(BackupPolicy.classify(httpStatus: (error as? SwarmError)?.httpStatus))
                NSLog("SwarmRecorder: автодосылка \(p.meetingId) — заявка не прошла (\(error))")
            }
            if verdict == .stop {
                p.reclaimStopped = true
                updateQuarantineMeta(p)
            }
        }
    }

    // Бэкап исходников на сервер: каждая запись карантина уезжает один раз (backup_only=1).
    // Локальная копия остаётся — она живёт свои 3 суток.
    private func backupQuarantined(config: SwarmConfig) async {
        for var p in loadQuarantined() {
            guard BackupPolicy.shouldUploadBackup(
                backupUploaded: p.backupUploaded ?? false, gaveUp: p.backupGaveUp ?? false,
                attempts: p.backupAttempts ?? 0, ageSeconds: ageSeconds(p))
            else { continue }
            let reason = p.quarantineReason.flatMap(QuarantineReason.init(rawValue:)) ?? .other
            let client = SwarmClient(config: config)
            do {
                let resp = try await withParts(p, dir: quarantineDir(p.meetingId)) { sys, mic in
                    try await client.uploadBackup(
                        meetingID: p.meetingId, system: sys, mic: mic, reason: reason,
                        micStartOffset: p.micStartOffset, recordedSeconds: p.claimRetry?.recordedSeconds)
                }
                p.backupUploaded = true
                p.backupId = resp.backupId
                updateQuarantineMeta(p)
                NSLog("SwarmRecorder: бэкап \(p.meetingId) (\(reason.rawValue)) принят сервером, id \(resp.backupId ?? "?")")
            } catch {
                let failure = BackupPolicy.classify(httpStatus: (error as? SwarmError)?.httpStatus)
                let next = BackupPolicy.afterBackupFailure(failure, attempts: p.backupAttempts ?? 0)
                p.backupAttempts = next.attempts
                p.backupGaveUp = next.gaveUp
                updateQuarantineMeta(p)
                NSLog("SwarmRecorder: бэкап \(p.meetingId) не принят (\(error)) — попытка \(next.attempts), \(next.gaveUp ? "больше не пробуем" : "повтор на следующем дрейне")")
            }
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

    // Из pending/ в карантин failed/ с причиной: запись остаётся видна в «Дослать», уезжает бэкапом
    // на сервер и перезаявляется (раньше — тихий dead-letter без флага и без возврата).
    private func moveToQuarantine(_ meetingId: String, reason: QuarantineReason) {
        let src = meetingDir(meetingId)
        guard fm.fileExists(atPath: src.path) else { return }
        if var p = (try? Data(contentsOf: metaURL(meetingId))).flatMap({ try? JSONDecoder().decode(PendingUpload.self, from: $0) }) {
            p.deferred = true
            p.quarantineReason = reason.rawValue
            p.lastReclaimAt = Date().timeIntervalSince1970
            try? writeMeta(p)
        }
        try? fm.createDirectory(at: deadLetterDir, withIntermediateDirectories: true)
        let dst = quarantineDir(meetingId)
        try? fm.removeItem(at: dst)
        do { try fm.moveItem(at: src, to: dst) }
        catch { NSLog("SwarmRecorder: карантин \(meetingId) не удался: \(error)") }
    }
}
