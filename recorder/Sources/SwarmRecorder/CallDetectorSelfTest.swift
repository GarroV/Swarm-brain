import CoreAudio
import Foundation
import RecorderKit

/// Runs the production sampler against controlled OS read results. No audio, UI or network.
func runCallDetectorSelfTest() -> Never {
    typealias Case = (name: String, objects: [AudioObjectID]?, pids: [AudioObjectID: pid_t],
                      running: [AudioObjectID: UInt32], bundles: [AudioObjectID: String], expected: Bool?)
    let cases: [Case] = [
        ("unavailable-list", nil, [:], [:], [:], nil),
        ("confirmed-empty", [], [:], [:], [:], false),
        ("unavailable-pid", [2], [:], [:], [:], nil),
        ("invalid-pid", [2], [2:0], [2:1], [:], nil),
        ("unavailable-input", [2], [2:22], [:], [:], nil),
        ("own-recorder-excluded", [1], [1:1], [:], [:], false),
        ("system-daemon-excluded", [2], [2:22], [2:1], [2:"com.apple.CoreSpeech"], false),
        ("external-call", [2], [2:22], [2:1], [2:"test.call"], true),
        ("known-active-wins", [2,3], [2:22], [2:1], [2:"test.call"], true),
        ("idle-with-unreadable-process", [2,3], [2:22], [2:0], [:], nil),
        ("invalid-input-flag", [2], [2:22], [2:2], [:], nil),
    ]
    for sample in cases {
        let result = CallDetector.sampleProcesses(objects: sample.objects, currentPID: 1,
            pid: { sample.pids[$0] }, running: { sample.running[$0] }, bundle: { sample.bundles[$0] })
        guard result?.active == sample.expected else {
            print("SELFTEST_CALL_DETECTOR FAIL case=\(sample.name)")
            exit(1)
        }
    }
    var rule = AutoStopRule()
    for _ in 0..<2 {
        _ = rule.observe(elapsed: 60, systemPeak: 0.5, micPeak: 0, realCall: true, roomPresence: nil)
    }
    let unknown = CallDetector.sampleProcesses(objects: nil, currentPID: 1,
        pid: { _ in nil }, running: { _ in nil }, bundle: { _ in nil })
    for _ in 0..<10 {
        guard rule.observe(elapsed: 60, systemPeak: 0.5, micPeak: 0,
                           realCall: unknown?.active, roomPresence: nil) == nil else {
            print("SELFTEST_CALL_DETECTOR FAIL case=unknown-must-not-stop-live-recording"); exit(1)
        }
    }
    let idle = CallDetector.sampleProcesses(objects: [], currentPID: 1,
        pid: { _ in nil }, running: { _ in nil }, bundle: { _ in nil })
    var reason: AutoStopRule.StopReason?
    for _ in 0..<3 {
        reason = rule.observe(elapsed: 60, systemPeak: 0.5, micPeak: 0,
                              realCall: idle?.active, roomPresence: nil)
    }
    guard reason == .micReleased else {
        print("SELFTEST_CALL_DETECTOR FAIL case=confirmed-idle-must-still-stop"); exit(1)
    }
    print("SELFTEST_CALL_DETECTOR PASS cases=\(cases.count) hardware=unused audio=unused network=unused")
    exit(0)
}
