import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

// Захват ДВУХ дорожек одной сессии:
//   • системный звук (собеседники) — ScreenCaptureKit → AAC .m4a
//   • микрофон (локальный юзер)     — AVAudioRecorder → AAC .m4a
// Сведение НЕ на клиенте: оба файла уходят на сервер, он транскрибирует каждый и сводит
// сегменты по таймстампам (общий старт сессии) с метками «собеседник»/«я». Так надёжнее,
// чем real-time микшировать два потока в коде.
//
// ⚠️ AudioRecorder.start требует разрешения: запись экрана (системный звук) и микрофон.
@available(macOS 13.0, *)
final class AudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    struct Result { let system: URL; let mic: URL? }

    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var audioInput: AVAssetWriterInput?
    private var sessionStarted = false
    private let queue = DispatchQueue(label: "swarm.recorder.audio")

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
        try await startSystem(to: systemURL)
    }

    func stop() async throws -> Result {
        // система
        guard let s = stream, let w = writer, let input = audioInput, let sysURL = systemURL else {
            throw SwarmError.transport("recorder not started")
        }
        try await s.stopCapture()
        input.markAsFinished()
        await w.finishWriting()
        let failed = w.status == .failed
        stream = nil; writer = nil; audioInput = nil; sessionStarted = false

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

        if failed { throw SwarmError.transport("writer failed: \(w.error?.localizedDescription ?? "?")") }
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

    // ── Системный звук через ScreenCaptureKit → AAC ──────────────────────────────
    private func startSystem(to url: URL) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw SwarmError.transport("no display for audio capture")
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48_000
        cfg.channelCount = 2
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let w = try AVAssetWriter(outputURL: url, fileType: .m4a)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 24_000,
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard w.canAdd(input) else { throw SwarmError.transport("cannot add audio input") }
        w.add(input)
        self.writer = w
        self.audioInput = input

        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        self.stream = s
        try await s.startCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let w = writer, let input = audioInput else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        if !sessionStarted {
            if w.status == .unknown {
                w.startWriting()
                w.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
                sessionStarted = true
            } else { return }
        }
        if input.isReadyForMoreMediaData { input.append(sampleBuffer) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        NSLog("SwarmRecorder: stream stopped with error: \(error.localizedDescription)")
    }
}
