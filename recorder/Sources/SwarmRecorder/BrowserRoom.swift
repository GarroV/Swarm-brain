import AppKit
import Foundation

extension MeetingIdentity {
    // Идентичность ad-hoc-звонка из URL активной вкладки фронтового браузера (когда события
    // календаря нет). Ключ комнаты одинаков у участников по одной ссылке → дедуп. Требует
    // разрешения Automation (контроль браузера); при отказе/неизвестном браузере → nil → manual.
    static func currentRoom() -> Info? {
        guard let urlStr = frontmostBrowserURL(), let room = parseRoom(urlStr) else { return nil }
        return Info(kind: .room, key: room.key, title: room.title, attendees: [], startISO: nil, endISO: nil)
    }

    private static func frontmostBrowserURL() -> String? {
        guard let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else { return nil }
        let chromium: [String: String] = [
            "com.google.Chrome": "Google Chrome",
            "com.google.Chrome.beta": "Google Chrome Beta",
            "com.microsoft.edgemac": "Microsoft Edge",
            "com.brave.Browser": "Brave Browser",
            "company.thebrowser.Browser": "Arc",
            "ru.yandex.desktop.yandex-browser": "Yandex",
        ]
        let script: String
        if let app = chromium[bundleID] {
            script = "tell application \"\(app)\" to get URL of active tab of front window"
        } else if bundleID == "com.apple.Safari" {
            script = "tell application \"Safari\" to get URL of front document"
        } else {
            return nil
        }
        var err: NSDictionary?
        let out = NSAppleScript(source: script)?.executeAndReturnError(&err)
        if err != nil {
            NSLog("SwarmRecorder: не прочитать URL браузера (\(bundleID)) — нет Automation-доступа?")
            return nil
        }
        return out?.stringValue
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
}
