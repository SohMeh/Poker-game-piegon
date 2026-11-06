import FlockKit
import Messages
import UIKit

/// What happened to a bubble request, for the web (`result`) and the extension (`inserted`: the bubble
/// is now in the compose field, waiting for the player to tap Send).
struct BubblePostOutcome {
    let result: NativeToWeb
    let inserted: Bool
}

/// Turns the web table's `bubble` events into MSMessages and posts them into the conversation.
///
/// - One MSSession per table and conversation: a newer bubble of the same table replaces the older
///   one in the transcript (the older one collapses to its `summary`).
/// - Requests are de-duplicated by `dedupeKey` following FlockKit's `BubbleDedupe` policy: game
///   started, buy-back vote and rematch are remembered persistently (a reload never posts them twice);
///   your-turn and game-over keys can legitimately come back (hand numbers restart after a rematch),
///   so only an immediate repeat is dropped; invites (insert) only drop a double tap, so tapping
///   "Send to chat" again later inserts the invite again.
final class BubbleComposer {
    private let deduper: BubbleDeduper
    private var inFlight = Set<String>()
    /// "<conversation>|<roomId>" -> session
    private var sessions: [String: MSSession] = [:]

    init(ledger: BubbleLedger) {
        self.deduper = BubbleDeduper(ledger: ledger)
    }

    /// Remembers the session of a bubble seen in `conversation` (selected or received), so this
    /// device's next bubble for the same table continues it.
    func remember(_ message: MSMessage, in conversation: MSConversation) {
        guard let session = message.session, let url = message.url, let roomId = RoomLink.roomId(from: url) else { return }
        sessions[sessionKey(roomId: roomId, conversation: conversation)] = session
    }

    func post(_ request: BubbleRequest, in conversation: MSConversation?, completion: @escaping (BubblePostOutcome) -> Void) {
        let key = request.dedupeKey
        let fail: (String) -> Void = { reason in
            completion(BubblePostOutcome(
                result: .bubbleResult(dedupeKey: key, ok: false, sent: false, error: reason),
                inserted: false
            ))
        }

        let posting = !key.isEmpty && inFlight.contains(key)
        if posting || deduper.isDuplicate(key, kind: request.kind, mode: request.mode) {
            switch request.mode {
            case .send:
                fail(posting ? "Already posting" : "Already posted")
            case .insert:
                // A double tap: the invite is (being) put in the compose field already, which is what
                // the player asked for, so this is a quiet success rather than an error.
                completion(BubblePostOutcome(
                    result: .bubbleResult(dedupeKey: key, ok: true, sent: false, error: nil),
                    inserted: false
                ))
            }
            return
        }
        guard let conversation = conversation else {
            fail("No active conversation")
            return
        }
        guard let url = URL(string: request.bubble.url),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host != nil else {
            fail("Invalid table link")
            return
        }

        let message = makeMessage(request, url: url, in: conversation)
        if !key.isEmpty {
            inFlight.insert(key)
        }

        switch request.mode {
        case .insert:
            insert(message, request: request, url: url, conversation: conversation, completion: completion)
        case .send:
            conversation.send(message) { [weak self] error in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if error == nil {
                        self.inFlight.remove(key)
                        self.deduper.recordPosted(key, kind: request.kind, mode: request.mode)
                        if request.plainLink {
                            conversation.sendText(self.plainLinkText(url), completionHandler: nil)
                        }
                        completion(BubblePostOutcome(
                            result: .bubbleResult(dedupeKey: key, ok: true, sent: true, error: nil),
                            inserted: false
                        ))
                    } else {
                        // Messages only lets an extension send right after the player touched it;
                        // put the bubble in the compose field instead.
                        self.insert(message, request: request, url: url, conversation: conversation, completion: completion)
                    }
                }
            }
        }
    }

    // MARK: - Private

    private func insert(
        _ message: MSMessage,
        request: BubbleRequest,
        url: URL,
        conversation: MSConversation,
        completion: @escaping (BubblePostOutcome) -> Void
    ) {
        let key = request.dedupeKey
        conversation.insert(message) { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.inFlight.remove(key)
                if let error = error {
                    completion(BubblePostOutcome(
                        result: .bubbleResult(dedupeKey: key, ok: false, sent: false, error: error.localizedDescription),
                        inserted: false
                    ))
                    return
                }
                self.deduper.recordPosted(key, kind: request.kind, mode: request.mode)
                if request.plainLink {
                    conversation.insertText(self.plainLinkText(url), completionHandler: nil)
                }
                completion(BubblePostOutcome(
                    result: .bubbleResult(dedupeKey: key, ok: true, sent: false, error: nil),
                    inserted: true
                ))
            }
        }
    }

    private func makeMessage(_ request: BubbleRequest, url: URL, in conversation: MSConversation) -> MSMessage {
        let info = request.bubble
        let roomId = RoomLink.normalizeRoomId(info.roomId) ?? RoomLink.roomId(from: url) ?? info.roomId
        let message = MSMessage(session: session(for: roomId, in: conversation))
        message.url = url
        message.summaryText = nonEmpty(info.summary) ?? nonEmpty(info.title)

        let layout = MSMessageTemplateLayout()
        layout.caption = nonEmpty(info.title)
        layout.subcaption = nonEmpty(info.subtitle)
        layout.trailingSubcaption = nonEmpty(info.trailing)
        layout.image = BubbleImageRenderer.image(for: info, kind: request.kind)
        message.layout = layout

        let label = [info.title, info.subtitle].filter { !$0.isEmpty }.joined(separator: ". ")
        message.accessibilityLabel = label.isEmpty ? "Flock Poker game" : label
        return message
    }

    /// The session of this table in this conversation: the tapped bubble's, else the one this device
    /// used before, else a new one.
    private func session(for roomId: String, in conversation: MSConversation) -> MSSession {
        let key = sessionKey(roomId: roomId, conversation: conversation)
        if let selected = conversation.selectedMessage,
           let session = selected.session,
           let selectedURL = selected.url,
           RoomLink.roomId(from: selectedURL) == roomId {
            sessions[key] = session
            return session
        }
        if let known = sessions[key] {
            return known
        }
        let created = MSSession()
        sessions[key] = created
        return created
    }

    private func sessionKey(roomId: String, conversation: MSConversation) -> String {
        return conversation.localParticipantIdentifier.uuidString + "|" + roomId
    }

    private func plainLinkText(_ url: URL) -> String {
        return "No app? Join in your browser: \(url.absoluteString)"
    }

    private func nonEmpty(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
