import Foundation
import AVFoundation
import CoreMedia

// Часть дорожки для загрузки: файл + смещение начала (сек) в общей таймлинии встречи.
// Сервер прибавит offset к таймстампам Whisper (тот нумерует каждую часть с нуля).
struct AudioPart {
    let url: URL
    let offset: Double
}

// Нарезка длинных записей на части ≤ лимита Whisper (25 МБ). Режем уже сжатый m4a БЕЗ
// перекодирования (passthrough) по ровным интервалам времени — длительность пропорциональна
// размеру (битрейт CBR). Короткая запись возвращается одной частью с offset 0 (файл не трогаем),
// поэтому путь для обычных встреч остаётся прежним.
enum Segmenter {
    // Если файл ≤ этого — грузим целиком (одна часть). Под 25 МБ-лимитом OpenAI с запасом.
    static let singlePartMaxBytes = 24 * 1024 * 1024
    // Целевой размер части при нарезке — ниже порога, чтобы поглотить разброс VBR
    // (AAC при заданном битрейте не строго CBR) и не упереться в 25 МБ на плотном участке.
    static let splitTargetBytes = 20 * 1024 * 1024
    // Макс. длительность части. При 24 kbps 25 МБ ≈ 2.2 ЧАСА — один whisper-вызов на такую часть
    // не влезает в wall-clock воркера (~400s). Поэтому режем и по времени: каждая часть ≤15 мин →
    // короткий whisper-вызов → сервер (durable meeting-process) добивает встречу по куску за тик.
    static let maxPartSeconds = 900.0
    // Оценка байт/сек для фолбэка, когда длительность не читается (24 kbps ≈ 3000 байт/с).
    static let bytesPerSecondEstimate = 3000.0

    static func fileSize(_ url: URL) -> Int {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int else { return 0 }
        return size
    }

    // Нарезать НЕСКОЛЬКО сегментов одной дорожки (напр. system после пересборок тапа) в общий
    // список частей. К offset каждой нарезанной части прибавляем базовый offset её сегмента
    // (старт сегмента в таймлинии сессии), чтобы сервер свёл всё в единую шкалу.
    static func segmentTrack(_ segments: [(url: URL, offset: Double)]) async throws -> [AudioPart] {
        var out: [AudioPart] = []
        for seg in segments {
            // Сегмент мог не записаться (пересборка упала) — пропускаем отсутствующий/пустой файл.
            guard fileSize(seg.url) > 1024 else { continue }
            let parts = try await segment(seg.url)
            for p in parts {
                out.append(AudioPart(url: p.url, offset: p.offset + seg.offset))
            }
        }
        return out
    }

    // Обрезка тишины перед нарезкой. allowEmpty=true (mic): дорожка-тишина → пусто (не грузим её
    // вовсе). allowEmpty=false (sys): пусто/сбой анализа → весь файл как есть (не рискуем потерять
    // речь собеседников). Порядок реплик держит offset каждого блока — сервер прибавит его к
    // таймстампам Whisper, серверную склейку не трогаем. См. SilenceTrimmer.
    static func segment(_ url: URL, allowEmpty: Bool = false) async throws -> [AudioPart] {
        guard fileSize(url) > 1024 else { return [] }
        let asset = AVURLAsset(url: url)
        let fullDuration = (try? await asset.load(.duration).seconds) ?? 0

        guard let blocks = await SilenceTrimmer.speechBlocks(url) else {
            // Анализ не удался — старое поведение (весь файл), аудио не теряем.
            return try await segmentBySize(url, asset: asset)
        }
        if blocks.isEmpty {
            return allowEmpty ? [] : try await segmentBySize(url, asset: asset)
        }
        // Речь покрывает почти весь файл (плотная дорожка, sys) — не ре-экспортируем зря.
        let speechDur = blocks.reduce(0.0) { $0 + ($1.end - $1.start) }
        if fullDuration > 0, speechDur >= fullDuration * 0.95 {
            return try await segmentBySize(url, asset: asset)
        }
        // Каждый речевой блок — отдельная часть (offset = реальный старт), длинный блок до-режем по
        // времени (лимит wall-clock одного whisper-вызова).
        let base = url.deletingPathExtension().lastPathComponent
        let dir = url.deletingLastPathComponent()
        var out: [AudioPart] = []
        var idx = 0
        for b in blocks {
            let blockDur = b.end - b.start
            if blockDur < 0.2 { continue }
            let subCount = max(1, Int((blockDur / maxPartSeconds).rounded(.up)))
            let subLen = blockDur / Double(subCount)
            for j in 0 ..< subCount {
                let s = b.start + Double(j) * subLen
                let e = min(b.start + Double(j + 1) * subLen, b.end)
                if e - s < 0.1 { continue }
                let outURL = dir.appendingPathComponent("\(base).vad\(idx).m4a")
                idx += 1
                try await export(asset, start: s, end: e, out: outURL)
                out.append(AudioPart(url: outURL, offset: s))
            }
        }
        return out.isEmpty ? try await segmentBySize(url, asset: asset) : out
    }

    // Прежняя нарезка по размеру/времени БЕЗ обрезки тишины (fallback + плотные дорожки).
    static func segmentBySize(_ url: URL, asset: AVURLAsset) async throws -> [AudioPart] {
        let size = fileSize(url)
        var duration = (try? await asset.load(.duration).seconds) ?? 0
        if !duration.isFinite || duration <= 0 {
            // Длительность не прочиталась (битый moov?) — оцениваем по размеру и битрейту,
            // чтобы всё равно нарезать на части ≤ лимита, а не слать гарантированно отбиваемый файл.
            duration = Double(size) / bytesPerSecondEstimate
        }
        // Целая часть — только если в пределах И по размеру, И по длительности.
        if size <= singlePartMaxBytes && duration <= maxPartSeconds {
            return [AudioPart(url: url, offset: 0)]
        }
        // Частей хватит, чтобы каждая была ≤ порога и по размеру (Whisper 25 МБ), и по времени (wall-clock).
        let byBytes = Int((Double(size) / Double(splitTargetBytes)).rounded(.up))
        let byDuration = Int((duration / maxPartSeconds).rounded(.up))
        let count = max(2, byBytes, byDuration)
        let segLen = duration / Double(count)

        let base = url.deletingPathExtension().lastPathComponent
        let dir = url.deletingLastPathComponent()
        var parts: [AudioPart] = []
        for i in 0 ..< count {
            let start = Double(i) * segLen
            let end = min(Double(i + 1) * segLen, duration)
            if end - start < 0.1 { continue }
            let outURL = dir.appendingPathComponent("\(base).part\(i).m4a")
            try await export(asset, start: start, end: end, out: outURL)
            parts.append(AudioPart(url: outURL, offset: start))
        }
        // Подстраховка: если по какой-то причине ничего не нарезали — отдадим исходник целиком.
        return parts.isEmpty ? [AudioPart(url: url, offset: 0)] : parts
    }

    // Trim [start, end] исходного ассета в отдельный m4a без перекодирования.
    private static func export(_ asset: AVAsset, start: Double, end: Double, out: URL) async throws {
        try? FileManager.default.removeItem(at: out)
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            throw SwarmError.transport("export session init")
        }
        session.outputURL = out
        session.outputFileType = .m4a
        let ts: CMTimeScale = 600
        session.timeRange = CMTimeRange(
            start: CMTime(seconds: start, preferredTimescale: ts),
            end: CMTime(seconds: end, preferredTimescale: ts))
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            session.exportAsynchronously {
                if session.status == .completed {
                    cont.resume()
                } else {
                    cont.resume(throwing: session.error
                        ?? SwarmError.transport("export status \(session.status.rawValue)"))
                }
            }
        }
    }
}
