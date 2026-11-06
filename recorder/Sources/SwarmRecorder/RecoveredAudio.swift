import Foundation
import AVFoundation
import RecorderKit

/// Uses the same readable, finalized files for recovery upload and its duration claim.
enum RecoveredAudio {
    struct Selection {
        let segments: [(url: URL, offset: Double)]
        let recordedSeconds: Double?
    }

    static func read(_ candidates: [(url: URL, offset: Double)]) -> Selection {
        var segments: [(url: URL, offset: Double)] = []
        var spans: [RecordingCoverage.Span] = []
        for segment in candidates {
            guard FileManager.default.fileExists(atPath: segment.url.path),
                  ((try? segment.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 1024,
                  let file = try? AVAudioFile(forReading: segment.url) else { continue }
            segments.append(segment)
            let rate = file.processingFormat.sampleRate
            let duration = rate > 0 ? Double(file.length) / rate : nil
            spans.append(.init(offset: segment.offset, duration: duration))
        }
        return Selection(segments: segments, recordedSeconds: RecordingCoverage.seconds(spans))
    }
}
