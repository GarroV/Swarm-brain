import Foundation

/// Decode both recorder (camel-case strategy) and board (snake-case keys) API responses.
/// An explicit null is a blocked entry, while an absent field supports older servers.
public struct BrowserMeetingLink: Decodable, Sendable {
    public let url: URL?

    private enum Keys: String, CodingKey { case joinUrl, openUrl, join_url, open_url }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let key: Keys
        if c.contains(.openUrl) { key = .openUrl }
        else if c.contains(.open_url) { key = .open_url }
        else { key = c.contains(.joinUrl) ? .joinUrl : .join_url }
        url = JoinLink.safeURL(try c.decodeIfPresent(String.self, forKey: key))
    }
}
