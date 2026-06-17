import Foundation
import AVFoundation

// Захват ДВУХ дорожек одной сессии:
//   • системный звук (собеседники) — через SystemAudioCapturer:
//       macOS 14.4+ → Core Audio process-tap; ниже → ScreenCaptureKit. Оба → AAC .m4a.
//   • микрофон (локальный юзер)     — AVAudioRecorder → AAC .m4a
// Сведение НЕ на клиенте: оба файла уходят на сервер, он транскрибирует каждый и сводит
// сегменты по таймстампам с метками «собеседник»/«я».
@available(macOS 13.0, *)
final class AudioRecorder: NSObject {
    struct Result { let system: URL; let mic: URL? }

    private var systemCapturer: SystemAudioCapturer?
    private var micRecorder: AVAudioRecorder?
    private var systemURL: URL?
    private var micURL: URL?
    private var micActive = false

    // Старт обеих дорожек. Микрофон — best-effort: если нет доступа/ошибка, продолжаем
    // только с системным звуком (mic = nil в результате).
    func start(systemURL: URL, micURL: URL) async throws {
        self.systemURL = systemURL
        self.micURL = micURL
        try? FileManager.default.removeItem(at: systemURL)
        try? FileManager.default.removeItem(at: micURL)

        try startMicBestEffort(to: micURL)
        let cap = makeSystemCapturer()
        try await cap.start(systemURL: systemURL)
        self.systemCapturer = cap
    }

    func stop() async throws -> Result {
        guard let sysURL = systemURL else {
            throw SwarmError.transport("recorder not started")
        }
        // Системная дорожка — финализируется внутри capturer (best-effort, не бросает).
        await systemCapturer?.stop()
        systemCapturer = nil

        // микрофон
        var resultMic: URL? = nil
        if micActive, let rec = micRecorder, let mURL = micURL {
            rec.stop()
            micRecorder = nil
            micActive = false
            if let attrs = try? FileManager.default.attributesOfItem(atPath: mURL.path),
               let size = attrs[.size] as? Int, size > 1024 {
                resultMic = mURL
            }
        }
        systemURL = nil
        micURL = nil
        return Result(system: sysURL, mic: resultMic)
    }

    // ── Микрофон через AVAudioRecorder (простой надёжный путь) ───────────────────
    private func startMicBestEffort(to url: URL) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 24_000,
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            if rec.record() {
                micRecorder = rec
                micActive = true
            } else {
                NSLog("SwarmRecorder: mic record() вернул false (нет доступа?) — пишем только систему")
            }
        } catch {
            NSLog("SwarmRecorder: микрофон недоступен (\(error)) — пишем только систему")
        }
    }
}
