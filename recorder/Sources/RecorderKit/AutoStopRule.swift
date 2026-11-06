import Foundation

/// Deterministic recording-end rules. One instance belongs to one recording.
/// Timers, audio/browser reads, notifications and saving remain in AppDelegate.
public struct AutoStopRule {
    public enum RoomPresence { case open, gone, unknown }
    public enum StopReason: Equatable {
        case roomClosed, bothSidesSilent, otherSideSilent, hardLimit, micReleased, noCallLimit
    }

    public private(set) var callSeenDuringRec = false
    public private(set) var silentTicks = 0
    public private(set) var conversation = ConversationGate()
    public private(set) var systemSilentTicks = 0
    public private(set) var systemOnlySilentTicks = 0
    public private(set) var roomGoneTicks = 0
    private var loudStreak = 0

    // Existing production thresholds, moved unchanged from AppDelegate (#273).
    private static let systemSilenceLevel: Float = 0.02
    private static let micSilenceLevel: Float = 0.12
    private static let systemSilenceTicksToStop = 36
    private static let systemOnlySilenceTicksToStop = 180
    private static let roomGoneTicksToStop = 4
    private static let maxNoCallSeconds: TimeInterval = 75 * 60
    private static let maxHardSeconds: TimeInterval = 4 * 60 * 60

    public init() {}

    /// One five-second tick. `nil` room presence means this is not a room recording.
    /// Unknown browser reads neither add nor erase confirmed gone ticks, as before.
    public mutating func observe(elapsed: TimeInterval, systemPeak: Float, micPeak: Float,
                                 realCall: Bool?, roomPresence: RoomPresence?) -> StopReason? {
        let anyoneAudible = systemPeak >= Self.systemSilenceLevel || micPeak >= Self.micSilenceLevel
        // A single notification blip does not clear three minutes of silence.
        if !anyoneAudible {
            systemSilentTicks += 1
            loudStreak = 0
        } else {
            loudStreak += 1
            if loudStreak >= 2 { systemSilentTicks = 0 }
        }
        conversation.observe(otherSideAudible: systemPeak >= Self.systemSilenceLevel)
        if systemPeak < Self.systemSilenceLevel {
            systemOnlySilentTicks += 1
        } else {
            systemOnlySilentTicks = 0
        }

        // Deliberately uses a call seen on an earlier tick, preserving rule order.
        if callSeenDuringRec, let presence = roomPresence {
            switch presence {
            case .open: roomGoneTicks = 0
            case .gone: roomGoneTicks += 1
            case .unknown: break
            }
            if roomGoneTicks >= Self.roomGoneTicksToStop { return .roomClosed }
        } else {
            roomGoneTicks = 0
        }

        // Lobby silence is waiting, not the end of a conversation (#379).
        if callSeenDuringRec && conversation.isOpen && systemSilentTicks >= Self.systemSilenceTicksToStop {
            return .bothSidesSilent
        }
        // A noisy microphone cannot keep a recording alive without the other side.
        if callSeenDuringRec && systemOnlySilentTicks >= Self.systemOnlySilenceTicksToStop {
            return .otherSideSilent
        }
        // The hard ceiling applies even while speech and the call detector are active.
        if elapsed >= Self.maxHardSeconds { return .hardLimit }

        // An unanswered audio-service query is not evidence that the mic was released.
        // Independent audio/room/hard-ceiling rules above still apply.
        guard let realCall else { return nil }
        if realCall {
            callSeenDuringRec = true
            silentTicks = 0
            return nil
        }
        silentTicks += 1
        if callSeenDuringRec && conversation.isOpen && silentTicks >= 3 { return .micReleased }

        // #271: a blind detector alone must never end a loud, live call at 75 min.
        if elapsed >= Self.maxNoCallSeconds && silentTicks >= 3
            && systemSilentTicks >= Self.systemSilenceTicksToStop {
            return .noCallLimit
        }
        // Calendar end is intentionally not an input: it cannot cut a live call.
        return nil
    }
}
