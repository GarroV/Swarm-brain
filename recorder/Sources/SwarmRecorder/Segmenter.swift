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
    // Оценка байт/сек для фолбэка, когда длительность не читается (24 kbps ≈ 3000 байт/с).
    static let bytesPerSecondEstimate = 3000.0

    static func fileSize(_ url: URL) -> Int {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int else { return 0 }
        return size
    }

    static func segment(_ url: URL) async throws -> [AudioPart] {
        let size = fileSize(url)
        if size <= singlePartMaxBytes { return [AudioPart(url: url, offset: 0)] }

        let asset = AVURLAsset(url: url)
        var duration = (try? await asset.load(.duration).seconds) ?? 0
        if !duration.isFinite || duration <= 0 {
            // Длительность не прочиталась (битый moov?) — оцениваем по размеру и битрейту,
            // чтобы всё равно нарезать на части ≤ лимита, а не слать гарантированно отбиваемый файл.
            duration = Double(size) / bytesPerSecondEstimate
        }
        let count = max(2, Int((Double(size) / Double(splitTargetBytes)).rounded(.up)))
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
