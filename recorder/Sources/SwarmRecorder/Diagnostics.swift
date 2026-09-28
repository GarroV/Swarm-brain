import Foundation
import RecorderKit

// Постоянный журнал рекордера (issue #468). Раньше диагностика писалась в /tmp/swarm-calldetect.log:
// только авто-стоп, без ротации, стиралась перезагрузкой — и ничего не говорила о том, почему
// рекордер «молча пропал». Теперь:
//   • ~/Library/Logs/SwarmRecorder/recorder-YYYY-MM-DD.log, хранится 3 дня;
//   • маркер сессии — на старте видно, закрылась ли прошлая сессия штатно;
//   • строки копятся в буфере и уезжают на сервер (recorder-diag) сами — просить файлы у людей
//     не нужно (решение владельца 24.09.2026).
// Названия встреч и имена в журнал НЕ пишем — только ключи и состояния.
final class Diagnostics {
    static let shared = Diagnostics()

    private let queue = DispatchQueue(label: "swarm.diagnostics")
    private let fm = FileManager.default
    private var pending: [String] = []          // ещё не отправлено на сервер
    private static let pendingCap = 3000         // ~сутки тиков; старое выпадает первым
    private static let uploadLineCap = 1500
    private(set) var marker: SessionMarker?

    let logDir: URL = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Logs/SwarmRecorder", isDirectory: true)
    private var markerURL: URL { SwarmConfig.configURL().deletingLastPathComponent().appendingPathComponent("session.json") }

    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZZ"
        return f
    }()

    func log(_ s: String) {
        let now = Date()
        let line = "\(Self.stamp.string(from: now)) [\(getpid())] \(s)"
        queue.async { [self] in
            append(line, at: now)
            pending.append(line)
            if pending.count > Self.pendingCap { pending.removeFirst(pending.count - Self.pendingCap) }
        }
    }

    private func append(_ line: String, at date: Date) {
        try? fm.createDirectory(at: logDir, withIntermediateDirectories: true)
        let url = logDir.appendingPathComponent(DiagJournal.fileName(for: date))
        guard let data = (line + "\n").data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(data); try? h.close()
        } else {
            try? data.write(to: url)
        }
    }

    func pruneOld() {
        queue.async { [self] in
            let names = (try? fm.contentsOfDirectory(atPath: logDir.path)) ?? []
            for n in DiagJournal.expired(fileNames: names, now: Date()) {
                try? fm.removeItem(at: logDir.appendingPathComponent(n))
            }
        }
    }

    // ── Сессия ───────────────────────────────────────────────────────────────────
    // Старт: читаем маркер прошлого процесса, выносим вердикт, пишем свой (cleanExit=false).
    func beginSession(build: Int, launchedBy: String) -> SessionVerdict {
        let previous = readMarker()
        let reports = crashReports(since: previous?.startedAt)
        let verdict = SessionVerdict.judge(previous: previous, crashReports: reports)
        let m = SessionMarker(pid: getpid(), build: build, startedAt: Date(), launchedBy: launchedBy,
                              lastAliveAt: Date())
        marker = m
        writeMarker(m)
        return verdict
    }

    func touchAlive() {
        guard var m = marker else { return }
        m.lastAliveAt = Date()
        marker = m
        writeMarker(m)
    }

    // Штатный выход. Синхронно: после этого процесс может закончиться в любой момент.
    func endSession(reason: String) {
        guard var m = marker, !m.cleanExit else { return }
        m.cleanExit = true
        m.exitReason = reason
        m.lastAliveAt = Date()
        marker = m
        let line = "\(Self.stamp.string(from: Date())) [\(getpid())] EXIT clean: \(reason)"
        queue.sync { append(line, at: Date()) }
        writeMarker(m)
    }

    private func readMarker() -> SessionMarker? {
        guard let data = try? Data(contentsOf: markerURL) else { return nil }
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601
        return try? d.decode(SessionMarker.self, from: data)
    }

    private func writeMarker(_ m: SessionMarker) {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601
        guard let data = try? e.encode(m) else { return }
        try? fm.createDirectory(at: markerURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: markerURL, options: .atomic)
    }

    // Отчёты о падениях, которые macOS сохранила после старта прошлой сессии.
    private func crashReports(since: Date?) -> [String] {
        let dir = fm.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/DiagnosticReports")
        let exe = Bundle.main.executableURL?.lastPathComponent ?? "SwarmRecorder"
        let items = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return items.filter { url in
            guard url.lastPathComponent.hasPrefix(exe) else { return false }
            guard let since else { return true }
            let mod = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            return (mod ?? .distantPast) >= since
        }.map(\.lastPathComponent).sorted()
    }

    // Первые строки отчёта о падении: тип исключения и сигнал — этого хватает, чтобы понять класс.
    func crashSummary(_ name: String) -> String? {
        let url = fm.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Logs/DiagnosticReports").appendingPathComponent(name)
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return String(text.prefix(4000))
    }

    // ── Хвост журнала для отчёта о прошлой сессии ────────────────────────────────
    // Последние строки из файлов журнала (вчера+сегодня) — там момент, когда процесс умер.
    func tail(lines n: Int) -> [String] {
        queue.sync {
            let names = ((try? fm.contentsOfDirectory(atPath: logDir.path)) ?? [])
                .filter { $0.hasPrefix(DiagJournal.filePrefix) }.sorted().suffix(2)
            var all: [String] = []
            for name in names {
                let text = (try? String(contentsOf: logDir.appendingPathComponent(name), encoding: .utf8)) ?? ""
                all.append(contentsOf: text.split(separator: "\n").map(String.init))
            }
            return Array(all.suffix(n))
        }
    }

    // ── Отправка ─────────────────────────────────────────────────────────────────
    func takePending() -> [String] {
        queue.sync {
            let out = Array(pending.prefix(Self.uploadLineCap))
            pending.removeFirst(out.count)
            return out
        }
    }

    // Не доехало — возвращаем в начало очереди, чтобы не потерять.
    func restorePending(_ lines: [String]) {
        queue.async { [self] in
            pending.insert(contentsOf: lines, at: 0)
            if pending.count > Self.pendingCap { pending.removeFirst(pending.count - Self.pendingCap) }
        }
    }

    // Резидентная память процесса в МБ — рост от тика к тику выдаёт утечку, за которую macOS
    // убивает процесс без отчёта о падении.
    static func residentMB() -> Int {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return kr == KERN_SUCCESS ? Int(info.resident_size / 1_048_576) : -1
    }
}
