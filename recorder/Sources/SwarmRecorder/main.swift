import AppKit
import AVFoundation
import Foundation

// Режим --selftest: headless-проверка захвата системного звука без меню-бара.
// Пишет ~6с, параллельно проигрывая клип через afplay, печатает размер файла.
func runSelfTest() {
    let tmp = FileManager.default.temporaryDirectory
    let sysURL = tmp.appendingPathComponent("swarm-selftest-sys.m4a")
    let micURL = tmp.appendingPathComponent("swarm-selftest-mic.m4a")
    let rec = AudioRecorder()
    Task {
        do {
            NSLog("selftest: запускаю захват…")
            try await rec.start(systemURL: sysURL, micURL: micURL)

            // Источник системного звука для захвата.
            let clip = FileManager.default.fileExists(atPath: "/tmp/e2e.m4a")
                ? "/tmp/e2e.m4a" : "/System/Library/Sounds/Glass.aiff"
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
            p.arguments = [clip]
            try? p.run()

            try await Task.sleep(nanoseconds: 6_000_000_000)
            if p.isRunning { p.terminate() }

            let res = try await rec.stop()
            func sz(_ u: URL) -> Int { ((try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? Int) ?? 0 }
            print("SELFTEST_CAPTURE system=\(sz(res.system)) mic=\(res.mic.map { String(sz($0)) } ?? "none")")
            NSLog("selftest: захват готов, system=\(sz(res.system)) mic=\(res.mic != nil)")

            // Полный цикл (если есть config.json): claim + загрузка своим же SwarmClient.
            if let cfg = try? SwarmConfig.load() {
                let client = SwarmClient(config: cfg)
                let now = ISO8601DateFormatter().string(from: Date())
                let req = ClaimRequest(
                    identityKind: .manual,
                    identityKey: "manual:selftest-\(UUID().uuidString)",
                    title: "Selftest захват",
                    startedAt: now, endedAt: now, agentVersion: "0.1.0-selftest"
                )
                let claim = try await client.claim(req)
                print("SELFTEST_CLAIM meeting_id=\(claim.meetingId) decision=\(claim.decision)")
                if claim.shouldTranscribe {
                    let sysParts = try await Segmenter.segment(res.system)
                    var micParts: [AudioPart] = []
                    if let micURL = res.mic { micParts = try await Segmenter.segment(micURL, allowEmpty: true) }
                    let ing = try await client.uploadAudio(meetingID: claim.meetingId, system: sysParts, mic: micParts)
                    print("SELFTEST_UPLOAD meeting_id=\(claim.meetingId) status=\(ing.summaryStatus ?? "?")")
                }
            } else {
                print("SELFTEST_NOCONFIG (только захват, без отправки)")
            }
            exit(0)
        } catch {
            print("SELFTEST_ERROR \(error)")
            NSLog("selftest: ОШИБКА \(error)")
            exit(1)
        }
    }
    RunLoop.main.run()
}

// Режим --analyze <file.m4a…>: печатает речевые блоки SilenceTrimmer и % экономии Whisper-минут.
// Временный debug для калибровки на реальных записях (сверка со ссылочным ffmpeg-замером).
func runAnalyze(_ files: [String]) {
    Task {
        for path in files {
            let url = URL(fileURLWithPath: path)
            let asset = AVURLAsset(url: url)
            let full = (try? await asset.load(.duration).seconds) ?? 0
            guard let blocks = await SilenceTrimmer.speechBlocks(url) else {
                print("ANALYZE \(url.lastPathComponent): анализ не удался"); continue
            }
            let speech = blocks.reduce(0.0) { $0 + ($1.end - $1.start) }
            let pct = full > 0 ? (1 - speech / full) * 100 : 0
            print(String(format: "ANALYZE %@: полн %.0fс, речь %.0fс, блоков %d → экономия -%.0f%%",
                         url.lastPathComponent, full, speech, blocks.count, pct))
        }
        exit(0)
    }
    RunLoop.main.run()
}

if let ai = CommandLine.arguments.firstIndex(of: "--analyze") {
    runAnalyze(Array(CommandLine.arguments[(ai + 1)...]))
} else if CommandLine.arguments.contains("--selftest") {
    runSelfTest()   // не возвращается (RunLoop) до exit()
} else {
    // Меню-бар агент: без иконки в Dock, без главного окна.
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
