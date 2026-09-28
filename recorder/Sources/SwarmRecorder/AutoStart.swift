import Foundation
import RecorderKit

// Автозапуск через launchd (issue #468). Схема и причины — RecorderKit/AutoStartPlan.swift.
// Выключатель на случай беды: файл ~/Library/Application Support/SwarmRecorder/no-autostart.
enum AutoStart {
    static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(AutoStartPlan.label).plist")
    }
    private static var disableFlag: URL {
        SwarmConfig.configURL().deletingLastPathComponent().appendingPathComponent("no-autostart")
    }

    static var isUnderLaunchd: Bool {
        ProcessInfo.processInfo.environment[AutoStartPlan.launchdEnvKey] == "1"
    }

    static func action() -> AutoStartPlan.Action {
        AutoStartPlan.decide(bundlePath: Bundle.main.bundlePath,
                             environment: ProcessInfo.processInfo.environment,
                             disabled: FileManager.default.fileExists(atPath: disableFlag.path))
    }

    // Пишем plist, если его нет или путь к бинарнику поменялся (переезд бандла). true — файл обновлён.
    @discardableResult
    static func writePlistIfNeeded() -> Bool {
        guard let exe = Bundle.main.executablePath else { return false }
        let want = AutoStartPlan.plist(executablePath: exe)
        if let have = NSDictionary(contentsOf: plistURL), have.isEqual(to: want) { return false }
        try? FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        return (want as NSDictionary).write(to: plistURL, atomically: true)
    }

    // Эстафета: отсоединённый хелпер ждёт, пока мы выйдем, перерегистрирует агента (bootstrap с
    // RunAtLoad сам поднимает приложение) и проверяет, что оно поднялось. Не поднялось — открывает
    // по-старому через `open`: приложение не имеет права исчезнуть из-за автозапуска.
    // Возвращает true, если хелпер стартовал — тогда зовущий обязан выйти.
    static func handOff() -> Bool {
        guard writePlistIfNeeded() || FileManager.default.fileExists(atPath: plistURL.path) else { return false }
        let app = Bundle.main.bundlePath
        let exe = Bundle.main.executableURL?.lastPathComponent ?? "SwarmRecorder"
        let domain = "gui/\(getuid())"
        let script = """
        LOG="$HOME/Library/Logs/SwarmRecorder/autostart.log"
        mkdir -p "$(dirname "$LOG")"
        log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
        for _ in $(seq 1 20); do kill -0 \(getpid()) 2>/dev/null || break; sleep 0.5; done
        launchctl bootout \(domain)/\(AutoStartPlan.label) 2>/dev/null
        if launchctl bootstrap \(domain) "\(plistURL.path)" 2>>"$LOG"; then log "bootstrap ok"; else log "bootstrap failed"; fi
        sleep 4
        if pgrep -u "$(id -u)" -x "\(exe)" >/dev/null; then log "running under launchd"; exit 0; fi
        log "not running after bootstrap → open"
        open "\(app)"
        """
        // Как у апдейтера: скрипт в файл + nohup … & — хелпер обязан пережить наш выход.
        let scriptURL = SwarmConfig.configURL().deletingLastPathComponent().appendingPathComponent("autostart-handoff.sh")
        guard (try? script.write(to: scriptURL, atomically: true, encoding: .utf8)) != nil else { return false }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "nohup /bin/bash '\(scriptURL.path)' >/dev/null 2>&1 &"]
        do { try p.run(); p.waitUntilExit() } catch { return false }
        return p.terminationStatus == 0
    }
}
