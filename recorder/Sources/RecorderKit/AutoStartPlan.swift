import Foundation

// Автозапуск рекордера через launchd (issue #468). До этого автозапуска не было вообще: после
// перезагрузки, падения или убийства процесса рекордер не поднимался, пока его не откроют руками,
// и встречи молча не писались.
//
// Схема: LaunchAgent с RunAtLoad (старт при входе в систему) и KeepAlive{SuccessfulExit=false}
// (поднять после падения/SIGKILL, но НЕ после штатного выхода с кодом 0: «Выйти» из меню — это
// решение человека). SIGTERM (апдейтер, выход из системы) приложение ловит и выходит с кодом 0,
// поэтому launchd не поднимет старый бинарник посреди подмены.
//
// KeepAlive работает только для процесса, который запустил сам launchd. Экземпляр, открытый
// руками или через `open` (установщик, апдейтер), передаёт эстафету: регистрирует агента и выходит,
// а launchd поднимает приложение уже под своим присмотром.
public enum AutoStartPlan {
    public static let label = "io.dodobrands.swarmrecorder"
    // Метка «меня запустил launchd» — ставим сами через EnvironmentVariables, а не угадываем по
    // XPC_SERVICE_NAME: так проверка не зависит от версии macOS.
    public static let launchdEnvKey = "SWARM_RECORDER_LAUNCHD"
    public static let throttleSeconds = 10

    public static func plist(executablePath: String) -> [String: Any] {
        [
            "Label": label,
            "ProgramArguments": [executablePath],
            "RunAtLoad": true,
            "KeepAlive": ["SuccessfulExit": false],
            "LimitLoadToSessionType": "Aqua",
            "ProcessType": "Interactive",
            "ThrottleInterval": throttleSeconds,
            "EnvironmentVariables": [launchdEnvKey: "1"],
        ]
    }

    // Автозапуск ставим только установленному приложению. Dev-сборка из рабочей папки или
    // `swift run` не должна прописывать себя в автозагрузку разработчика.
    public static func isInstalledLocation(bundlePath: String) -> Bool {
        bundlePath.hasPrefix("/Applications/") && bundlePath.hasSuffix(".app")
    }

    public enum Action: Equatable {
        case none            // dev-сборка или отключено
        case keepRunning     // мы уже под launchd
        case handOff         // зарегистрировать агента и выйти: launchd поднимет нас сам
    }

    public static func decide(bundlePath: String, environment: [String: String], disabled: Bool) -> Action {
        guard !disabled, isInstalledLocation(bundlePath: bundlePath) else { return .none }
        return environment[launchdEnvKey] == "1" ? .keepRunning : .handOff
    }
}
