import XCTest
@testable import RecorderKit

final class RecordingCoverageTests: XCTestCase {
    private func seconds(_ spans: [(Double, Double?)]) -> Double? {
        RecordingCoverage.seconds(spans.map { .init(offset: $0.0, duration: $0.1) })
    }

    func testFinalizedSegmentsKeepTheirMeasuredDuration() {
        XCTAssertEqual(seconds([(0, 300), (300, 60)]), 360)
    }

    func testGapsDoNotBecomeRecordedAudio() {
        XCTAssertEqual(seconds([(0, 300), (600, 60)]), 360)
    }

    func testOverlapAndDuplicateSegmentsDoNotCountTwice() {
        XCTAssertEqual(seconds([(0, 300), (0, 300), (120, 240)]), 360)
    }

    func testUnsortedFractionalSegmentsAreMerged() {
        XCTAssertEqual(seconds([(0.5, 0.25), (0, 0.5)]), 0.75)
    }

    func testUnmeasuredAudioStaysUnknownInsteadOfZero() {
        XCTAssertNil(seconds([]))
        XCTAssertNil(seconds([(0, nil)]))
        XCTAssertNil(seconds([(0, 300), (300, nil)]))
        XCTAssertNil(seconds([(0, 0)]))
    }

    func testInvalidMetadataCannotProducePlausibleDuration() {
        XCTAssertNil(seconds([(-1, 30)]))
        XCTAssertNil(seconds([(.infinity, 30)]))
        XCTAssertNil(seconds([(0, .nan)]))
        XCTAssertNil(seconds([(0, -1)]))
    }
}
