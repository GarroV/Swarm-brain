import Foundation
import AVFoundation

// Обрезка тишины перед отправкой в Whisper. Мотив: mic-дорожка на реальных встречах на ~85%
// состоит из тишины (владелец слушает, а не говорит) — Whisper тарифицируется по длительности
// АУДИО, поэтому мы платим за молчание. Замер на реальных записях: вырезание пауз даёт −60%
// Whisper-минут БЕЗ потери речи (проверено прогоном Whisper: вырезанная дорожка содержит всю
// связную речь и меньше галлюцинаций-«титров», которые Whisper штампует на тишине).
//
// Как сохраняется порядок реплик: дорожку режем на речевые БЛОКИ по длинным паузам; каждый блок
// несёт offset = его реальное время старта. Сервер уже прибавляет offset к таймстампам Whisper
// (см. meeting-processor: s.start + p.offset), поэтому склейка sys/mic по времени не ломается —
// серверную часть трогать не нужно.
enum SilenceTrimmer {
    // Порог речи (dBFS). Ниже — тишина. −30 dB подтверждён на реальном аудио: sys стабильна на
    // всех порогах −25…−40, на mic разница −30 vs −40 = единицы «слов», и те — галлюцинации.
    // Override через env SWARM_VAD_DB (для тюнинга без пересборки).
    static let thresholdDb: Float = envFloat("SWARM_VAD_DB") ?? -30
    // Минимальная длина паузы (сек), по которой РЕЖЕМ на границе блоков. Короткие паузы внутри
    // речи не трогаем (остаются в блоке) — чтобы не плодить сотни частей (каждый блок = отдельный
    // whisper-вызов) и не резать на вдохах. Override через env SWARM_VAD_CUT.
    static let cutSilence: Double = envDouble("SWARM_VAD_CUT") ?? 20.0

    private static func envDouble(_ k: String) -> Double? { ProcessInfo.processInfo.environment[k].flatMap(Double.init) }
    private static func envFloat(_ k: String) -> Float? { ProcessInfo.processInfo.environment[k].flatMap(Float.init) }
    // Паддинг вокруг блока (сек) — не срезать начало/конец слова на границе речь↔тишина.
    static let padding: Double = 0.35
    // Окно анализа энергии (сек).
    static let window: Double = 0.05

    struct Block { let start: Double; let end: Double }

    // Речевые блоки файла. nil → анализ не удался (вызывающий берёт весь файл как есть).
    static func speechBlocks(_ url: URL) async -> [Block]? {
        let asset = AVURLAsset(url: url)
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first else { return nil }
        guard let desc = try? await track.load(.formatDescriptions).first,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc) else { return nil }
        let sampleRate = asbd.pointee.mSampleRate
        guard sampleRate > 0 else { return nil }
        guard let reader = try? AVAssetReader(asset: asset) else { return nil }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsNonInterleaved: false,
            AVNumberOfChannelsKey: 1
        ]
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { return nil }
        reader.add(output)

        let windowSamples = max(1, Int(window * sampleRate))
        // Порог по МОЩНОСТИ (сравниваем RMS² с amp², без log в горячем цикле).
        let ampThreshold = powf(10, thresholdDb / 20)
        let powThreshold = ampThreshold * ampThreshold

        guard reader.startReading() else { return nil }

        // Признак речи по каждому окну (true = речь). Идём потоково, не держим всё аудио в памяти.
        var isSpeech: [Bool] = []
        var acc: Float = 0     // сумма квадратов в текущем окне
        var accN = 0
        func flushWindow() {
            if accN > 0 { isSpeech.append(acc / Float(accN) >= powThreshold) }
            acc = 0; accN = 0
        }

        while reader.status == .reading, let sbuf = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sbuf) else { CMSampleBufferInvalidate(sbuf); continue }
            var lengthAtOffset = 0, totalLength = 0
            var dataPointer: UnsafeMutablePointer<Int8>? = nil
            guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: &lengthAtOffset,
                    totalLengthOut: &totalLength, dataPointerOut: &dataPointer) == kCMBlockBufferNoErr,
                  let raw = dataPointer else { CMSampleBufferInvalidate(sbuf); continue }
            let count = totalLength / MemoryLayout<Float>.size
            raw.withMemoryRebound(to: Float.self, capacity: count) { fp in
                for i in 0 ..< count {
                    let s = fp[i]
                    acc += s * s
                    accN += 1
                    if accN >= windowSamples { flushWindow() }
                }
            }
            CMSampleBufferInvalidate(sbuf)
        }
        flushWindow()
        guard reader.status == .completed else { return nil }
        if isSpeech.isEmpty { return [] }

        return blocksFromWindows(isSpeech, sampleRate: sampleRate, windowSamples: windowSamples)
    }

    // Свести признаки окон в блоки: блок рвётся, когда подряд тишины ≥ cutSilence.
    private static func blocksFromWindows(_ isSpeech: [Bool], sampleRate: Double, windowSamples: Int) -> [Block] {
        let winDur = Double(windowSamples) / sampleRate
        let cutWindows = Int((cutSilence / winDur).rounded(.up))
        var blocks: [Block] = []
        var blockStartWin: Int? = nil
        var lastSpeechWin = -1
        var silenceRun = 0

        for (i, sp) in isSpeech.enumerated() {
            if sp {
                if blockStartWin == nil { blockStartWin = i }
                lastSpeechWin = i
                silenceRun = 0
            } else {
                silenceRun += 1
                if let bs = blockStartWin, silenceRun >= cutWindows {
                    blocks.append(Block(start: Double(bs) * winDur, end: Double(lastSpeechWin + 1) * winDur))
                    blockStartWin = nil
                }
            }
        }
        if let bs = blockStartWin {
            blocks.append(Block(start: Double(bs) * winDur, end: Double(lastSpeechWin + 1) * winDur))
        }
        // Паддинг + слияние перекрывшихся после паддинга.
        let total = Double(isSpeech.count) * winDur
        var padded: [Block] = []
        for b in blocks {
            let s = max(0, b.start - padding)
            let e = min(total, b.end + padding)
            if let last = padded.last, s <= last.end {
                padded[padded.count - 1] = Block(start: last.start, end: max(last.end, e))
            } else {
                padded.append(Block(start: s, end: e))
            }
        }
        return padded
    }
}
