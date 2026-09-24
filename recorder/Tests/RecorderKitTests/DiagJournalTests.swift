import XCTest
@testable import RecorderKit

// Постоянный журнал и автозапуск рекордера (issue #468).
final class DiagJournalTests: XCTestCase {
    private let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Belgrade")!
        return c
    }()
    private func day(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: h))!
    }

    func testFileNamePerLocalDay() {
        XCTAssertEqual(DiagJournal.fileName(for: day(2026, 9, 4), calendar: cal), "recorder-2026-09-04.log")
        // 23:30 по Белграду — ещё тот же день, хотя в UTC уже другое время суток.
        XCTAssertEqual(DiagJournal.fileName(for: day(2026, 9, 24, 23), calendar: cal), "recorder-2026-09-24.log")
    }

    func testKeepsThreeDaysDeletesOlder() {
        let names = ["recorder-2026-09-24.log", "recorder-2026-09-23.log", "recorder-2026-09-22.log",
                     "recorder-2026-09-21.log", "recorder-2026-08-01.log"]
        XCTAssertEqual(DiagJournal.expired(fileNames: names, now: day(2026, 9, 24), calendar: cal),
                       ["recorder-2026-08-01.log", "recorder-2026-09-21.log"])
    }

    func testNeverDeletesForeignFiles() {
        let names = ["self-update.log", "recorder-notes.log", "recorder-2026-09-01.txt", "config.json"]
        XCTAssertEqual(DiagJournal.expired(fileNames: names, now: day(2026, 9, 24), calendar: cal), [])
    }

    func testVerdictAbnormalWhenMarkerNotClosed() {
        let alive = day(2026, 9, 24, 11)
        let m = SessionMarker(pid: 42, build: 34, startedAt: day(2026, 9, 24, 9), launchedBy: "user",
                              cleanExit: false, lastAliveAt: alive)
        XCTAssertEqual(SessionVerdict.judge(previous: m, crashReports: ["SwarmRecorder-2026-09-24.ips"]),
                       .abnormal(lastAliveAt: alive, crashReports: ["SwarmRecorder-2026-09-24.ips"]))
    }

    func testVerdictCleanAndFirstRun() {
        let m = SessionMarker(pid: 1, build: 34, startedAt: day(2026, 9, 24), launchedBy: "launchd",
                              cleanExit: true, exitReason: "SIGTERM")
        XCTAssertEqual(SessionVerdict.judge(previous: m, crashReports: []), .clean(reason: "SIGTERM"))
        XCTAssertEqual(SessionVerdict.judge(previous: nil, crashReports: []), .firstRun)
    }

    func testAutoStartHandsOffOnlyInstalledAppNotUnderLaunchd() {
        let app = "/Applications/bumblebee.app"
        XCTAssertEqual(AutoStartPlan.decide(bundlePath: app, environment: [:], disabled: false), .handOff)
        XCTAssertEqual(AutoStartPlan.decide(bundlePath: app, environment: [AutoStartPlan.launchdEnvKey: "1"],
                                            disabled: false), .keepRunning)
        // Dev-сборка и выключатель — не трогаем автозагрузку вообще.
        XCTAssertEqual(AutoStartPlan.decide(bundlePath: "/Users/x/Swarm/recorder/build/bumblebee.app",
                                            environment: [:], disabled: false), .none)
        XCTAssertEqual(AutoStartPlan.decide(bundlePath: app, environment: [:], disabled: true), .none)
    }

    func testPlistRestartsOnlyAfterAbnormalExit() {
        let p = AutoStartPlan.plist(executablePath: "/Applications/bumblebee.app/Contents/MacOS/SwarmRecorder")
        XCTAssertEqual(p["RunAtLoad"] as? Bool, true)
        // «Выйти» из меню = код 0 → launchd не поднимает; падение/SIGKILL → поднимает.
        XCTAssertEqual((p["KeepAlive"] as? [String: Bool])?["SuccessfulExit"], false)
        XCTAssertEqual((p["EnvironmentVariables"] as? [String: String])?[AutoStartPlan.launchdEnvKey], "1")
    }
}
