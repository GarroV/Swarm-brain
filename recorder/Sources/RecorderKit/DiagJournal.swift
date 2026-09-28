import Foundation

// Чистая логика постоянного журнала рекордера (issue #468): имена файлов, ротация, вердикт о том,
// как закончилась прошлая сессия. Файлы, сеть и AppKit — в SwarmRecorder/Diagnostics.swift.
//
// Зачем: рекордер у коллег «молча пропадает из строки меню», а сервер видит только последний
// снимок heartbeat — ни момента, ни причины. Журнал живёт на диске 3 дня и уезжает на сервер сам.
public enum DiagJournal {
    public static let keepDays = 3
    public static let filePrefix = "recorder-"
    public static let fileSuffix = ".log"

    // Файл на день: recorder-2026-09-24.log. День — локальный, человек так и скажет «вчера в обед».
    public static func fileName(for date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%@%04d-%02d-%02d%@", filePrefix, c.year ?? 0, c.month ?? 0, c.day ?? 0, fileSuffix)
    }

    // Какие файлы журнала пора удалить: всё, что не входит в последние keepDays дней (сегодня
    // включительно). Чужие файлы в папке не трогаем — только наш префикс и формат даты.
    public static func expired(fileNames: [String], now: Date, keepDays: Int = keepDays,
                               calendar: Calendar = .current) -> [String] {
        let keep = Set((0..<max(keepDays, 1)).compactMap { offset -> String? in
            guard let d = calendar.date(byAdding: .day, value: -offset, to: now) else { return nil }
            return fileName(for: d, calendar: calendar)
        })
        return fileNames.filter { name in
            name.hasPrefix(filePrefix) && name.hasSuffix(fileSuffix) && isDated(name) && !keep.contains(name)
        }.sorted()
    }

    private static func isDated(_ name: String) -> Bool {
        let core = name.dropFirst(filePrefix.count).dropLast(fileSuffix.count)
        let parts = core.split(separator: "-")
        return parts.count == 3 && parts.allSatisfy { !$0.isEmpty && $0.allSatisfy(\.isNumber) }
    }
}

// Маркер сессии на диске: пишется при старте (cleanExit=false) и переписывается при штатном
// выходе. Нашли на старте маркер с cleanExit=false — прошлый процесс умер, не успев попрощаться:
// падение, SIGKILL (Force Quit, нехватка памяти), выключение питания.
public struct SessionMarker: Codable, Equatable {
    public var pid: Int32
    public var build: Int
    public var startedAt: Date
    public var launchedBy: String          // "launchd" | "user"
    public var cleanExit: Bool
    public var exitReason: String?
    public var lastAliveAt: Date?          // последний тик — примерное время смерти

    public init(pid: Int32, build: Int, startedAt: Date, launchedBy: String,
                cleanExit: Bool = false, exitReason: String? = nil, lastAliveAt: Date? = nil) {
        self.pid = pid; self.build = build; self.startedAt = startedAt; self.launchedBy = launchedBy
        self.cleanExit = cleanExit; self.exitReason = exitReason; self.lastAliveAt = lastAliveAt
    }
}

public enum SessionVerdict: Equatable {
    case firstRun                                  // маркера не было — первый запуск с журналом
    case clean(reason: String)                     // штатный выход (меню, апдейтер, выход из системы)
    case abnormal(lastAliveAt: Date?, crashReports: [String])   // умер молча

    public static func judge(previous: SessionMarker?, crashReports: [String]) -> SessionVerdict {
        guard let p = previous else { return .firstRun }
        if p.cleanExit { return .clean(reason: p.exitReason ?? "unknown") }
        return .abnormal(lastAliveAt: p.lastAliveAt, crashReports: crashReports)
    }

    public var kind: String {
        switch self {
        case .firstRun: return "first_run"
        case .clean: return "clean"
        case .abnormal: return "abnormal"
        }
    }
}
