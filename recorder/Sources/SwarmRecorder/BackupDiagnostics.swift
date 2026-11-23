import Foundation

enum BackupDiagnostics {
    static func prompt(_ event: String, key: String) {
        log(event, key: nil, details: ["prompt_key": key])
    }

    static func log(_ event: String, key: String?, details: [String: Any] = [:]) {
        var fields = details
        fields["event"] = event
        fields["meeting_key"] = key.map { $0 as Any } ?? NSNull()
        guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return }
        Diagnostics.shared.log("BACKUP \(text)")
    }
}
