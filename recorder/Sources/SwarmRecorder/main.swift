import AppKit
import Foundation

// Режим --selftest: headless-проверка захвата системного звука без меню-бара.
// Пишет ~6с, параллельно проигрывая клип через afplay, печатает размер файла.
func runSelfTest() {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("swarm-selftest.m4a")
    let rec = AudioRecorder()
    Task {
        do {
            NSLog("selftest: запускаю захват…")
            try await rec.start(to: url)

            // Источник системного звука для захвата.
            let clip = FileManager.default.fileExists(atPath: "/tmp/e2e.m4a")
                ? "/tmp/e2e.m4a" : "/System/Library/Sounds/Glass.aiff"
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
            p.arguments = [clip]
            try? p.run()

            try await Task.sleep(nanoseconds: 6_000_000_000)
            if p.isRunning { p.terminate() }

            let out = try await rec.stop()
            let size = ((try? FileManager.default.attributesOfItem(atPath: out.path))?[.size] as? Int) ?? 0
            print("SELFTEST_RESULT path=\(out.path) size=\(size)")
            NSLog("selftest: готово, size=\(size)")
            exit(0)
        } catch {
            print("SELFTEST_ERROR \(error)")
            NSLog("selftest: ОШИБКА \(error)")
            exit(1)
        }
    }
    RunLoop.main.run()
}

if CommandLine.arguments.contains("--selftest") {
    runSelfTest()   // не возвращается (RunLoop) до exit()
} else {
    // Меню-бар агент: без иконки в Dock, без главного окна.
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
