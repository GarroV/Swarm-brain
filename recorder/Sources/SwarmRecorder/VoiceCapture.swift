import AVFoundation
import Foundation
import RecorderKit

// Запись диктовки для задачи голосом. СВОЙ экземпляр AVAudioRecorder: ни общих объектов, ни общих
// сессий с `AudioRecorder` (запись встреч). AAC m4a, 16 кГц, моно — речь, а не музыка: минута
// укладывается в сотни килобайт, потолок сервера 2 МБ.
final class VoiceCapture: NSObject {
    enum StartResult { case started, micDenied, failed }

    private var recorder: AVAudioRecorder?
    private(set) var fileURL: URL?

    var isRecording: Bool { recorder?.isRecording == true }
    /// Сколько уже записано, секунды.
    var elapsed: TimeInterval { recorder?.currentTime ?? 0 }

    private static let filePrefix = "bumblebee-voice-"

    func start() async -> StartResult {
        guard !isRecording else { return .started }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .denied, .restricted:
            return .micDenied
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .audio) else { return .micDenied }
        default:
            break
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(Self.filePrefix)\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            guard r.prepareToRecord(), r.record() else { return .failed }
            recorder = r
            fileURL = url
            return .started
        } catch {
            NSLog("SwarmRecorder: голос — запись не началась: \(error)")
            return .failed
        }
    }

    /// Остановить и отдать файл с длительностью. Файл удаляет вызывающий (`discard`).
    func finish() -> (url: URL, duration: TimeInterval)? {
        guard let r = recorder, let url = fileURL else { return nil }
        let duration = r.currentTime
        r.stop()
        recorder = nil
        return (url, duration)
    }

    /// Остановить и выбросить запись.
    func cancel() {
        recorder?.stop()
        recorder = nil
        discard()
    }

    /// Удалить временный файл — всегда, при любом исходе.
    func discard() {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
    }

    /// Остатки прошлых сессий (краш посреди диктовки) — на старте.
    static func sweepStaleFiles() {
        let dir = FileManager.default.temporaryDirectory
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        for n in names where n.hasPrefix(filePrefix) { try? FileManager.default.removeItem(at: dir.appendingPathComponent(n)) }
    }
}
