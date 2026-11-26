import Foundation

/// Wire replies only: the real client, durable queue and expiry code run unchanged.
private final class StatusPollingProtocol: URLProtocol {
    static var calls = 0
    static var reply = (503, "{}")
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "status-poll-selftest.invalid"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.calls += 1
        let (status, body) = Self.reply
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

func runStatusPollingSelfTest() {
    let transport = URLSessionConfiguration.ephemeral
    transport.protocolClasses = [StatusPollingProtocol.self]
    let session = URLSession(configuration: transport)
    Task {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("status-poll-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        do {
            let id = UUID().uuidString.lowercased()
            let dir = root.appendingPathComponent("pending/\(id)")
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let meta = dir.appendingPathComponent("meta.json")
            let audio = dir.appendingPathComponent("sys.m4a")
            let bytes = Data("retained-audio".utf8)
            try bytes.write(to: audio)
            var payload: [String: Any] = [
                "meetingId": id, "systemSegments": [["path": "sys.m4a", "offset": 0]],
                "startISO": ISO8601DateFormatter().string(from: Date()),
                "endISO": ISO8601DateFormatter().string(from: Date()),
                "attempts": 0, "uploaded": true,
            ]
            try JSONSerialization.data(withJSONObject: payload).write(to: meta)
            let config = SwarmConfig(token: "fixture", ingestBaseURL: "https://status-poll-selftest.invalid",
                                     webBaseURL: "https://status-poll-selftest.invalid")
            func require(_ condition: Bool, _ message: String) throws {
                if !condition { throw NSError(domain: message, code: 1) }
            }
            _ = try JSONDecoder().decode(PendingUpload.self, from: Data(contentsOf: meta))
            let queue = UploadQueue(storageRoot: root, statusSession: session)
            await queue.drain(config: config)
            try require(StatusPollingProtocol.calls == 1, "503 was requested")
            try require(try Data(contentsOf: audio) == bytes, "503 must retain audio")
            StatusPollingProtocol.reply = (200, "{\"statuses\":[]}")
            await queue.drain(config: config)
            try require(StatusPollingProtocol.calls == 2, "old server must still be polled")
            StatusPollingProtocol.reply = (200, "{\"statuses\":[],\"unavailable_ids\":[\"\(id)\"]}")
            await queue.drain(config: config)
            try require(StatusPollingProtocol.calls == 3, "unavailable response was requested")
            try require(try Data(contentsOf: audio) == bytes, "unavailable must retain audio")
            let restarted = UploadQueue(storageRoot: root, statusSession: session)
            await restarted.drain(config: config)
            try require(StatusPollingProtocol.calls == 3, "restart must not resume unavailable polling")
            let stored = try JSONSerialization.jsonObject(with: Data(contentsOf: meta)) as! [String: Any]
            try require(stored["statusPollingStopped"] as? Bool == true, "stop must persist")
            payload = stored
            payload["endISO"] = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-4 * 86400))
            try JSONSerialization.data(withJSONObject: payload).write(to: meta)
            await restarted.drain(config: config)
            try require(!fm.fileExists(atPath: dir.path), "TTL must still expire backup")
            print("SELFTEST_STATUS_POLL PASS: 503 retry, old server, explicit unavailable, restart, audio retention, TTL")
            exit(0)
        } catch {
            print("SELFTEST_STATUS_POLL FAIL: \(error)")
            exit(1)
        }
    }
    RunLoop.main.run()
}
