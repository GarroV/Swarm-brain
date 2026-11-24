import Foundation

/// Exercise the actual meeting-current parser without account access, recording or network.
func runMeetingJoinSelfTest() {
    do {
        let room = "https://meet.google.com/abc-defg-hij"
        let entry = "https://accounts.google.com/AccountChooser?Email=work%40example.com&continue=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij"
        func check(_ value: Bool, _ label: String) {
            print("MEET \(value ? "OK" : "FAIL") \(label)")
            if !value { exit(1) }
        }
        func lookup(_ extra: [String: Any]) throws -> SwarmClient.MeetingLookup {
            var meeting: [String: Any] = ["identity_key": "event:2026-11-24", "join_url": room]
            meeting.merge(extra) { _, new in new }
            let data = try JSONSerialization.data(withJSONObject: ["meetings": [meeting]])
            return try SwarmClient.parseMeetingLookup(data)
        }
        let offered = try lookup(["open_url": entry])
        check(offered.meeting?.joinURL?.absoluteString == room, "raw room retained for identity and bot")
        check(offered.meeting?.browserURL?.absoluteString == entry, "recorder selects work account entry")
        let absent = try lookup(["open_url": NSNull()])
        check(absent.meeting?.joinURL?.absoluteString == room, "blocked entry retains calendar event")
        check(absent.meeting?.browserURL == nil, "blocked entry cannot fall back to raw room")
        check(try lookup([:]).meeting?.browserURL?.absoluteString == room, "old server remains compatible")
        check(AppDelegate().openJoinLink(nil) == false, "unavailable entry cannot open or start recording")
        exit(0)
    } catch {
        print("MEET FAIL \(error)")
        exit(1)
    }
}
