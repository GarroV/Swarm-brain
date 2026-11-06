/// Measured audio coverage, matching the server's union-of-segments duration.
/// Gaps and overlapping tracks must not inflate the amount of recorded audio.
public enum RecordingCoverage {
    public struct Span {
        public let offset: Double
        public let duration: Double?

        public init(offset: Double, duration: Double?) {
            self.offset = offset
            self.duration = duration
        }
    }

    /// Unknown or invalid media stays unknown; it is never reported as zero seconds.
    public static func seconds(_ parts: [Span]) -> Double? {
        guard !parts.isEmpty else { return nil }
        var spans: [(start: Double, end: Double)] = []
        for part in parts {
            guard part.offset.isFinite, part.offset >= 0,
                  let duration = part.duration, duration.isFinite, duration > 0,
                  (part.offset + duration).isFinite else { return nil }
            spans.append((part.offset, part.offset + duration))
        }
        spans.sort { $0.start < $1.start }
        var start = spans[0].start
        var end = spans[0].end
        var covered = 0.0
        for span in spans.dropFirst() {
            if span.start <= end {
                end = max(end, span.end)
            } else {
                covered += end - start
                start = span.start
                end = span.end
            }
        }
        let total = covered + end - start
        return total.isFinite && total > 0 ? total : nil
    }
}
