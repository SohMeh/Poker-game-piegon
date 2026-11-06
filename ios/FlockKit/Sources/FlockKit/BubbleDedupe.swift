import Foundation

/// How the extension de-duplicates a bubble request by its `dedupeKey`.
///
/// The web builds the keys (src/client/native/bubbles.ts):
/// - `gameStarted:<room>:<game>`, `buyBackRequested:<room>:<voteId>` and `rematch:<room>:<game>`
///   each name one event for the whole life of a room, so they are remembered persistently.
/// - `yourTurn:<room>:<hand>:<player>` comes back in a later game (hand numbers restart after a
///   rematch), and `gameOver:<room>:<game>:<winner>` comes back when a buy-back is approved after the
///   game ended and the same player wins again. Those are real new bubbles, so only a repeat within a
///   short window (a doubled event) is dropped, and nothing is persisted.
/// - `invite:<room>:<game>` (insert mode) is reused by every deliberate "Send to chat" tap: only a
///   double tap is dropped.
public enum BubbleDedupe: Equatable {
    /// Remembered in the persistent BubbleLedger: never posted twice from this device.
    case persistent
    /// Dropped only when the same key was posted less than this many seconds ago (memory only).
    case window(TimeInterval)

    /// A second insert of the same invite within this many seconds is a double tap.
    public static let insertWindow: TimeInterval = 3
    /// A yourTurn / gameOver key repeated within this many seconds is the same event.
    public static let repeatableWindow: TimeInterval = 60

    public static func policy(kind: BubbleKind, mode: BubbleMode) -> BubbleDedupe {
        if mode == .insert {
            return .window(insertWindow)
        }
        switch kind {
        case .gameStarted, .buyBackRequested, .rematch:
            return .persistent
        case .yourTurn, .gameOver:
            return .window(repeatableWindow)
        case .invite:
            return .window(insertWindow)
        }
    }
}

/// Decides whether a bubble request repeats one this device already posted, following
/// `BubbleDedupe.policy(kind:mode:)`.
public final class BubbleDeduper {
    private let ledger: BubbleLedger
    private let now: () -> Date
    /// dedupeKey -> when it was last posted, for `.window` policies.
    private var recent: [String: Date] = [:]

    public init(ledger: BubbleLedger, now: @escaping () -> Date = { Date() }) {
        self.ledger = ledger
        self.now = now
    }

    /// True if this request is a bubble this device already posted. An empty key is never a duplicate.
    public func isDuplicate(_ key: String, kind: BubbleKind, mode: BubbleMode) -> Bool {
        if key.isEmpty { return false }
        switch BubbleDedupe.policy(kind: kind, mode: mode) {
        case .persistent:
            return ledger.contains(key)
        case .window(let seconds):
            guard let stamp = recent[key] else { return false }
            return now().timeIntervalSince(stamp) < seconds
        }
    }

    /// Records that the bubble for `key` was posted (sent, or put in the compose field).
    public func recordPosted(_ key: String, kind: BubbleKind, mode: BubbleMode) {
        if key.isEmpty { return }
        switch BubbleDedupe.policy(kind: kind, mode: mode) {
        case .persistent:
            ledger.record(key)
        case .window:
            let time = now()
            recent[key] = time
            if recent.count > 100 {
                recent = recent.filter { time.timeIntervalSince($0.value) < BubbleDedupe.repeatableWindow }
            }
        }
    }
}
