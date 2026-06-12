import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

// MVP: захват СИСТЕМНОГО звука (удалённые участники звонка) через ScreenCaptureKit → AAC .m4a.
// ⚠️ НИЗКАЯ УВЕРЕННОСТЬ — писалось без компилятора, главный кандидат на правки в Xcode.
// Микрофон локального юзера + микширование — СЛЕДУЮЩАЯ итерация (сложный real-time код).
//
// Поток: SCStream(capturesAudio) → .audio CMSampleBuffer (PCM) → AVAssetWriter (AAC 16к моно).
@available(macOS 13.0, *)
final class AudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var audioInput: AVAssetWriterInput?
    private var sessionStarted = false
    private let queue = DispatchQueue(label: "swarm.recorder.audio")

    private(set) var outputURL: URL?

    // Старт записи системного звука в .m4a по указанному URL.
    func start(to url: URL) async throws {
        outputURL = url
        try? FileManager.default.removeItem(at: url)

        // 1) Контент для захвата — берём основной дисплей (весь системный звук).
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw SwarmError.transport("no display for audio capture")
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        // 2) Конфиг: только звук важен; видео-поток минимизируем (SCStream требует его наличия).
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true   // не писать собственный звук приложения
        cfg.sampleRate = 48_000
        cfg.channelCount = 2
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        // 3) AVAssetWriter → AAC 16кГц моно (компактно для речи и под лимит OpenAI 25 МБ).
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

        // 4) Стрим.
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        self.stream = s
        try await s.startCapture()
    }

    // Останов: финализирует файл и возвращает его URL.
    func stop() async throws -> URL {
        guard let s = stream, let w = writer, let input = audioInput, let url = outputURL else {
            throw SwarmError.transport("recorder not started")
        }
        try await s.stopCapture()
        input.markAsFinished()
        await w.finishWriting()
        stream = nil
        writer = nil
        audioInput = nil
        sessionStarted = false
        if w.status == .failed { throw SwarmError.transport("writer failed: \(w.error?.localizedDescription ?? "?")") }
        return url
    }

    // Приём сэмплов системного звука → запись.
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let w = writer, let input = audioInput else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }

        if !sessionStarted {
            if w.status == .unknown {
                w.startWriting()
                w.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
                sessionStarted = true
            } else {
                return
            }
        }
        if input.isReadyForMoreMediaData {
            input.append(sampleBuffer)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        NSLog("SwarmRecorder: stream stopped with error: \(error.localizedDescription)")
    }
}
