import Foundation
import XCTest
@testable import FlockKit

final class BridgeEventTests: XCTestCase {
    private let tableURL = "https://flock-poker.onrender.com/g/ABC123"

    private func info(
        title: String,
        subtitle: String,
        summary: String,
        trailing: String,
        status: TableStatus,
        seated: Int,
        handNumber: Int
    ) -> BubbleInfo {
        return BubbleInfo(
            roomId: "ABC123",
            url: tableURL,
            title: title,
            subtitle: subtitle,
            summary: summary,
            trailing: trailing,
            status: status,
            hostName: "Sohum",
            seated: seated,
            maxPlayers: 9,
            smallBlind: 10,
            bigBlind: 20,
            buyIn: 2000,
            handNumber: handNumber
        )
    }

    /// Every webToNative entry of the fixture, in order.
    private var expectedEvents: [BridgeEvent] {
        return [
            .ready(version: 1, route: .home),
            .ready(version: 1, route: .table),
            .rememberName("Sohum"),
            .bubble(
                kind: .invite, mode: .insert, dedupeKey: "invite:ABC123:1", plainLink: true,
                bubble: info(
                    title: "Sohum's poker game",
                    subtitle: "10/20 · buy-in 2,000 · 1/9 seated — tap to join",
                    summary: "Sohum started a poker game",
                    trailing: "Lobby", status: .lobby, seated: 1, handNumber: 0
                )
            ),
            .bubble(
                kind: .gameStarted, mode: .send, dedupeKey: "gameStarted:ABC123:1", plainLink: false,
                bubble: info(
                    title: "Cards are in the air!",
                    subtitle: "4 players · 10/20 — tap to play",
                    summary: "Game started",
                    trailing: "Hand #1", status: .running, seated: 4, handNumber: 1
                )
            ),
            .bubble(
                kind: .buyBackRequested, mode: .send, dedupeKey: "buyBackRequested:ABC123:v_7f3a", plainLink: false,
                bubble: info(
                    title: "Bob wants to buy back in",
                    subtitle: "Everyone must approve within 30s — tap to vote",
                    summary: "Bob asked to buy back in",
                    trailing: "Vote", status: .running, seated: 4, handNumber: 14
                )
            ),
            .bubble(
                kind: .yourTurn, mode: .send, dedupeKey: "yourTurn:ABC123:15:p_carol", plainLink: false,
                bubble: info(
                    title: "Carol, it's your turn",
                    subtitle: "Pot 340 · flop — tap to act",
                    summary: "Waiting on Carol",
                    trailing: "Hand #15", status: .running, seated: 4, handNumber: 15
                )
            ),
            .bubble(
                kind: .gameOver, mode: .send, dedupeKey: "gameOver:ABC123:1:p_alice", plainLink: false,
                bubble: info(
                    title: "Alice won the game!",
                    subtitle: "Holding all 8,000 chips — tap for the ledger",
                    summary: "Alice won the game",
                    trailing: "Final", status: .running, seated: 4, handNumber: 41
                )
            ),
            .bubble(
                kind: .rematch, mode: .send, dedupeKey: "rematch:ABC123:2", plainLink: false,
                bubble: info(
                    title: "Rematch!",
                    subtitle: "Fresh buy-ins of 2,000 — tap to sit down",
                    summary: "New game started",
                    trailing: "Lobby", status: .lobby, seated: 4, handNumber: 0
                )
            ),
            .haptic(.success),
            .presentation(.compact),
        ]
    }

    func testFixtureVersionMatchesBridgeVersion() throws {
        let root = try Fixture.root()
        XCTAssertEqual(root["version"] as? Int, BridgeConstants.version)
    }

    func testDecodesEveryFixtureEvent() throws {
        let raw = try Fixture.webToNative()
        let expected = expectedEvents
        XCTAssertEqual(raw.count, expected.count, "fixture event count changed: update this test")
        for (index, object) in raw.enumerated() {
            let event = try NativeBridge.decode(any: object)
            XCTAssertEqual(event.type, object["type"] as? String, "event #\(index)")
            if index < expected.count {
                XCTAssertEqual(event, expected[index], "event #\(index)")
            }
        }
    }

    func testFixtureDecodesFromJSONData() throws {
        // The same events, decoded straight from JSON bytes (no JSONSerialization round trip).
        let data = try Data(contentsOf: Fixture.url())
        struct Root: Decodable {
            let webToNative: [BridgeEvent]
        }
        let root = try JSONDecoder().decode(Root.self, from: data)
        XCTAssertEqual(root.webToNative, expectedEvents)
    }

    func testFixtureCoversEveryEventTypeAndBubbleKind() throws {
        let events = try Fixture.webToNative().map { try NativeBridge.decode(any: $0) }
        let types = Set(events.map { $0.type })
        XCTAssertEqual(types, ["ready", "rememberName", "bubble", "haptic", "presentation"])
        let kinds = Set(events.compactMap { $0.bubbleRequest?.kind })
        XCTAssertEqual(kinds, Set(BubbleKind.allCases))
        let modes = Set(events.compactMap { $0.bubbleRequest?.mode })
        XCTAssertEqual(modes, Set(BubbleMode.allCases))
        for event in events {
            if case .unknown = event { XCTFail("fixture event decoded as unknown: \(event)") }
        }
    }

    func testBubbleInfoRoundTripsEveryField() throws {
        // Encoding the decoded BubbleInfo gives back exactly the fixture object: no field is missing,
        // renamed or extra on the Swift side.
        for object in try Fixture.webToNative() where object["type"] as? String == "bubble" {
            let fixtureBubble = try XCTUnwrap(object["bubble"] as? [String: Any])
            guard let request = try NativeBridge.decode(any: object).bubbleRequest else {
                XCTFail("not a bubble: \(object)")
                continue
            }
            XCTAssertEqual(try jsonObject(request.bubble), fixtureBubble as NSDictionary)
        }
    }

    func testBubbleRequestAccessor() throws {
        let event = try NativeBridge.decode(any: try Fixture.webToNative()[3])
        let request = try XCTUnwrap(event.bubbleRequest)
        XCTAssertEqual(request.kind, .invite)
        XCTAssertEqual(request.mode, .insert)
        XCTAssertEqual(request.dedupeKey, "invite:ABC123:1")
        XCTAssertTrue(request.plainLink)
        XCTAssertEqual(request.bubble.roomId, "ABC123")
        XCTAssertEqual(request.bubble.url, tableURL)
        XCTAssertEqual(request.bubble.title, "Sohum's poker game")
        XCTAssertEqual(request.bubble.subtitle, "10/20 · buy-in 2,000 · 1/9 seated — tap to join")
        XCTAssertEqual(request.bubble.summary, "Sohum started a poker game")
        XCTAssertEqual(request.bubble.trailing, "Lobby")
        XCTAssertEqual(request.bubble.status, .lobby)
        XCTAssertEqual(request.bubble.hostName, "Sohum")
        XCTAssertEqual(request.bubble.seated, 1)
        XCTAssertEqual(request.bubble.maxPlayers, 9)
        XCTAssertEqual(request.bubble.smallBlind, 10)
        XCTAssertEqual(request.bubble.bigBlind, 20)
        XCTAssertEqual(request.bubble.buyIn, 2000)
        XCTAssertEqual(request.bubble.handNumber, 0)
        XCTAssertNil(BridgeEvent.haptic(.light).bubbleRequest)
    }

    func testUnknownTypeDecodesToUnknown() throws {
        let event = try NativeBridge.decode(any: ["type": "somethingFromTheFuture", "x": 1] as [String: Any])
        XCTAssertEqual(event, .unknown("somethingFromTheFuture"))
        XCTAssertEqual(event.type, "somethingFromTheFuture")
    }

    func testMalformedKnownEventsThrow() {
        let bad: [[String: Any]] = [
            [:],
            ["type": 7],
            ["type": "ready", "version": 1],
            ["type": "ready", "version": 1, "route": "lobby"],
            ["type": "rememberName"],
            ["type": "haptic", "style": "rumble"],
            ["type": "presentation", "style": "fullscreen"],
            ["type": "bubble", "kind": "invite", "mode": "insert", "dedupeKey": "k", "plainLink": true],
            ["type": "bubble", "kind": "selfie", "mode": "insert", "dedupeKey": "k", "plainLink": true, "bubble": [:] as [String: Any]],
        ]
        for object in bad {
            XCTAssertThrowsError(try NativeBridge.decode(any: object), "should not decode: \(object)")
        }
    }

    func testDecodesJSONStringBody() throws {
        let event = try NativeBridge.decode(any: "{\"type\":\"haptic\",\"style\":\"selection\"}")
        XCTAssertEqual(event, .haptic(.selection))
    }

    func testRejectsNonObjectBody() {
        XCTAssertThrowsError(try NativeBridge.decode(any: NSNumber(value: 3))) { error in
            XCTAssertEqual(error as? BridgeError, .invalidBody)
        }
        XCTAssertThrowsError(try NativeBridge.decode(any: NSNull()))
    }

    func testDecodesFromNSDictionaryLikeWKScriptMessageBody() throws {
        // WKScriptMessage.body for a posted JS object is an NSDictionary with NSNumber values.
        let body = NSMutableDictionary()
        body["type"] = "ready"
        body["version"] = NSNumber(value: 1)
        body["route"] = "table"
        XCTAssertEqual(try NativeBridge.decode(any: body), .ready(version: 1, route: .table))
    }

    func testRawValuesMatchTheTypeScriptContract() {
        XCTAssertEqual(BubbleKind.allCases.map { $0.rawValue }, ["invite", "gameStarted", "buyBackRequested", "yourTurn", "gameOver", "rematch"])
        XCTAssertEqual(BubbleMode.allCases.map { $0.rawValue }, ["insert", "send"])
        XCTAssertEqual(HapticStyle.allCases.map { $0.rawValue }, ["light", "medium", "heavy", "success", "warning", "error", "selection"])
        XCTAssertEqual(PresentationStyle.allCases.map { $0.rawValue }, ["compact", "expanded"])
        XCTAssertEqual(ReadyRoute.allCases.map { $0.rawValue }, ["home", "table"])
        XCTAssertEqual(TableStatus.allCases.map { $0.rawValue }, ["lobby", "running", "paused"])
        XCTAssertEqual(BridgeConstants.handlerName, "flock")
        XCTAssertEqual(BridgeConstants.eventName, "flock:native")
        XCTAssertEqual(BridgeConstants.globalName, "__FLOCK_NATIVE__")
    }
}
