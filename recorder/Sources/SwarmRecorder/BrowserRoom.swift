import AppKit
import Foundation

extension MeetingIdentity {
    // Известные браузеры: bundleID → имя приложения для AppleScript. Safari — особый (front document).
    private static let chromiumBrowsers: [String: String] = [
        "com.google.Chrome": "Google Chrome",
        "com.google.Chrome.beta": "Google Chrome Beta",
        "com.microsoft.edgemac": "Microsoft Edge",
        "com.brave.Browser": "Brave Browser",
        "company.thebrowser.Browser": "Arc",
        "ru.yandex.desktop.yandex-browser": "Yandex"
    ]
    private static let safariBundle = "com.apple.Safari"

    // Идентичность ad-hoc-звонка из URL активной вкладки фронтового браузера (когда события
    // календаря нет). Ключ комнаты одинаков у участников по одной ссылке → дедуп. Требует
    // разрешения Automation (контроль браузера); при отказе/неизвестном браузере → nil → manual.
    static func currentRoom() -> Info? {
        guard let front = frontmostBrowser(), let room = parseRoom(front.url) else { return nil }
        // Реальное имя встречи — из заголовка вкладки (там тема созвона). Пусто/мусор → nil, тогда
        // ниже подставится дата-дефолт «Встреча <юзер> · <дата>». Захардоженное имя платформы
        // («Google Meet»/«Контур.Толк») как название больше не используем — оно бесполезно.
        let title = cleanTitle(front.title)
        // joinURL нет намеренно: комната взята из ОТКРЫТОЙ вкладки — человек уже в звонке,
        // и кнопка «подключиться» вела бы туда, где он и так находится.
        return Info(kind: .room, key: room.key, title: title, attendees: [], startISO: nil, endISO: nil,
                    joinURL: nil)
    }

    // URL + заголовок активной вкладки фронтового браузера — одним AppleScript-вызовом.
    private static func frontmostBrowser() -> (url: String, title: String?)? {
        guard let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else { return nil }
        let script: String
        if let app = chromiumBrowsers[bundleID] {
            script = "tell application \"\(app)\" to return (URL of active tab of front window) & linefeed & (title of active tab of front window)"
        } else if bundleID == safariBundle {
            script = "tell application \"Safari\" to return (URL of front document) & linefeed & (name of front document)"
        } else {
            return nil
        }
        var err: NSDictionary?
        let out = NSAppleScript(source: script)?.executeAndReturnError(&err)
        if err != nil {
            NSLog("SwarmRecorder: не прочитать URL/заголовок браузера (\(bundleID)) — нет Automation-доступа?")
            return nil
        }
        guard let raw = out?.stringValue else { return nil }
        let lines = raw.components(separatedBy: "\n")
        let url = (lines.first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let title = lines.count > 1 ? lines[1...].joined(separator: "\n") : nil
        return url.isEmpty ? nil : (url, title)
    }

    // ── Жива ли ещё вкладка встречи (для авто-стопа во время записи) ──────────────
    enum RoomPresence { case open, gone, unknown }

    // Открыта ли где-нибудь вкладка комнаты `key`. Опрашиваем ТОЛЬКО запущенные известные браузеры
    // (закрытый не будим!). Успешно опросили и не нашли → .gone. Ошибка скрипта → .unknown
    // (консервативно — не стопаем при неопределённости). Ни один браузер не запущен → .gone.
    static func roomPresence(key: String) -> RoomPresence {
        guard let seg = searchSeg(from: key) else { return .unknown }
        let running = runningKnownBrowsers()
        if running.isEmpty { return .gone }
        var checkedAny = false
        var hadError = false
        for bundleID in running {
            switch tabsContainSeg(seg, bundleID: bundleID) {
            case .some(true): return .open
            case .some(false): checkedAny = true
            case .none: hadError = true
            }
        }
        if hadError { return .unknown }       // хотя бы один браузер не опросился → не уверены
        return checkedAny ? .gone : .unknown
    }

    private static func runningKnownBrowsers() -> [String] {
        let known = Set(chromiumBrowsers.keys).union([safariBundle])
        let ids = NSWorkspace.shared.runningApplications.compactMap { $0.bundleIdentifier }
        return Array(Set(ids).intersection(known))
    }

    // Есть ли сегмент комнаты в URL хоть одной вкладки хоть одного окна. Матч делаем ВНУТРИ скрипта
    // (возвращаем "true"/"false"), чтобы не парсить вложенные списки. Ошибка → nil.
    private static func tabsContainSeg(_ seg: String, bundleID: String) -> Bool? {
        let app: String
        if let a = chromiumBrowsers[bundleID] { app = a }
        else if bundleID == safariBundle { app = "Safari" }
        else { return nil }
        let script = """
        tell application "\(app)"
            set found to false
            repeat with w in windows
                repeat with t in tabs of w
                    if (URL of t) contains "\(seg)" then set found to true
                end repeat
            end repeat
            return found
        end tell
        """
        var err: NSDictionary?
        guard let out = NSAppleScript(source: script)?.executeAndReturnError(&err), err == nil else { return nil }
        return out.booleanValue
    }

    // Сегмент для поиска в URL: часть ключа после префикса ("meet:CODE" → "CODE"). Санитизируем —
    // только [A-Za-z0-9_-], иначе nil (не рискуем инъекцией в исходник AppleScript).
    private static func searchSeg(from key: String) -> String? {
        let seg = key.contains(":") ? String(key.split(separator: ":", maxSplits: 1).last ?? "") : key
        guard !seg.isEmpty, seg.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) else { return nil }
        return seg
    }

    // meet.google.com/abc-defg-hij → meet:<code>; talk.kontur/ktalk.ru/<room> → kontur:<room>.
    private static func parseRoom(_ urlStr: String) -> (key: String, title: String)? {
        guard let u = URL(string: urlStr), let host = u.host?.lowercased() else { return nil }
        let seg = u.path.split(separator: "/").first.map(String.init) ?? ""
        if host.contains("meet.google.com") {
            let looksLikeCode = seg.contains("-") && seg.count >= 10 && seg.count <= 14
                && seg.allSatisfy { $0.isLowercase || $0 == "-" }
            return looksLikeCode ? ("meet:\(seg)", "Google Meet") : nil
        }
        if host.contains("ktalk.ru") || host.contains("talk.kontur") {
            return seg.isEmpty ? nil : ("kontur:\(seg)", "Контур.Толк")
        }
        return nil
    }

    // Реальное имя встречи из заголовка вкладки: режем по типичным разделителям, выкидываем шум
    // платформы и голый код комнаты, берём самый содержательный кусок. Пусто → nil (дата-дефолт).
    private static func cleanTitle(_ raw: String?) -> String? {
        guard let t0 = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !t0.isEmpty else { return nil }
        var parts = [t0]
        for sep in [" — ", " – ", " - ", " · ", " | ", " • "] {
            parts = parts.flatMap { $0.components(separatedBy: sep) }
        }
        let noise: Set<String> = ["google meet", "meet", "контур.толк", "контур", "ktalk", "kontur"]
        let meaningful = parts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { p in
                guard !p.isEmpty, !noise.contains(p.lowercased()) else { return false }
                // Голый код комнаты вида abc-defg-hij — это не имя встречи.
                let isCode = p.range(of: "^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$", options: .regularExpression) != nil
                return !isCode
            }
        let best = meaningful.max(by: { $0.count < $1.count }) ?? ""
        return best.isEmpty ? nil : best
    }
}
