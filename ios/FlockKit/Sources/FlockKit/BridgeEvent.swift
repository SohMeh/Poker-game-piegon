import Foundation

// Swift side of the web <-> native bridge contract.
// Source of truth: src/client/native/bridgeTypes.ts (keep the raw values identical).
// Shared fixture:   Tests/FlockKitTests/Fixtures/bridge-events.json

/// Constants of the bridge (mirror BRIDGE_VERSION / BRIDGE_HANDLER in bridgeTypes.ts).
public enum BridgeConstants {
    /// BRIDGE_VERSION
    public static let version = 1
    /// BRIDGE_HANDLER: window.webkit.messageHandlers.flock
    public static let handlerName = "flock"
    /// Name of the CustomEvent native dispatches on window.
    public static let eventName = "flock:native"
    /// Global native defines before any page script runs.
    public static let globalName = "__FLOCK_NATIVE__"
    /// NativeInfo.platform
    public static let platform = "imessage"
}

/// 'compact' (app drawer height) or 'expanded' (full screen).
public enum PresentationStyle: String, Codable, Equatable, CaseIterable {
    case compact
    case expanded
}

/// `route` of the `ready` event.
public enum ReadyRoute: String, Codable, Equatable, CaseIterable {
    case home
    case table
}

/// Why a bubble is posted (BubbleKind).
public enum BubbleKind: String, Codable, Equatable, CaseIterable {
    case invite
    case gameStarted
    case buyBackRequested
    case yourTurn
    case gameOver
    case rematch
}

/// insert: put the bubble in the compose field. send: post it straight into the conversation.
public enum BubbleMode: String, Codable, Equatable, CaseIterable {
    case insert
    case send
}

/// HapticStyle
public enum HapticStyle: String, Codable, Equatable, CaseIterable {
    case light
    case medium
    case heavy
    case success
    case warning
    case error
    case selection
}

/// BubbleInfo.status
public enum TableStatus: String, Codable, Equatable, CaseIterable {
    case lobby
    case running
    case paused
}

/// What a chat bubble shows (BubbleInfo).
public struct BubbleInfo: Codable, Equatable {
    public var roomId: String
    /// Absolute table URL, stored as MSMessage.url.
    public var url: String
    public var title: String
    public var subtitle: String
    public var summary: String
    public var trailing: String
    public var status: TableStatus
    public var hostName: String
    public var seated: Int
    public var maxPlayers: Int
    public var smallBlind: Int
    public var bigBlind: Int
    public var buyIn: Int
    public var handNumber: Int

    public init(
        roomId: String,
        url: String,
        title: String,
        subtitle: String,
        summary: String,
        trailing: String,
        status: TableStatus,
        hostName: String,
        seated: Int,
        maxPlayers: Int,
        smallBlind: Int,
        bigBlind: Int,
        buyIn: Int,
        handNumber: Int
    ) {
        self.roomId = roomId
        self.url = url
        self.title = title
        self.subtitle = subtitle
        self.summary = summary
        self.trailing = trailing
        self.status = status
        self.hostName = hostName
        self.seated = seated
        self.maxPlayers = maxPlayers
        self.smallBlind = smallBlind
        self.bigBlind = bigBlind
        self.buyIn = buyIn
        self.handNumber = handNumber
    }
}

/// The payload of a `bubble` event, bundled for convenience.
public struct BubbleRequest: Equatable {
    public var kind: BubbleKind
    public var mode: BubbleMode
    public var dedupeKey: String
    public var plainLink: Bool
    public var bubble: BubbleInfo

    public init(kind: BubbleKind, mode: BubbleMode, dedupeKey: String, plainLink: Bool, bubble: BubbleInfo) {
        self.kind = kind
        self.mode = mode
        self.dedupeKey = dedupeKey
        self.plainLink = plainLink
        self.bubble = bubble
    }
}

/// A web -> native message (WebToNative in bridgeTypes.ts).
/// Unknown `type`s decode to `.unknown(type)` instead of throwing, so a newer web page never breaks
/// an older extension. A known type with missing or invalid fields still throws.
public enum BridgeEvent: Equatable, Decodable {
    /// Page booted and the bridge is live.
    case ready(version: Int, route: ReadyRoute)
    /// Remember the player's poker name on this device.
    case rememberName(String)
    /// Post / insert a chat bubble for this game.
    case bubble(kind: BubbleKind, mode: BubbleMode, dedupeKey: String, plainLink: Bool, bubble: BubbleInfo)
    /// Native haptic feedback.
    case haptic(HapticStyle)
    /// Ask Messages to resize the extension.
    case presentation(PresentationStyle)
    /// A `type` this build does not know.
    case unknown(String)

    private enum CodingKeys: String, CodingKey {
        case type
        case version
        case route
        case name
        case kind
        case mode
        case dedupeKey
        case plainLink
        case bubble
        case style
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "ready":
            let version = try container.decode(Int.self, forKey: .version)
            let route = try container.decode(ReadyRoute.self, forKey: .route)
            self = .ready(version: version, route: route)
        case "rememberName":
            let name = try container.decode(String.self, forKey: .name)
            self = .rememberName(name)
        case "bubble":
            let kind = try container.decode(BubbleKind.self, forKey: .kind)
            let mode = try container.decode(BubbleMode.self, forKey: .mode)
            let dedupeKey = try container.decode(String.self, forKey: .dedupeKey)
            let plainLink = try container.decode(Bool.self, forKey: .plainLink)
            let info = try container.decode(BubbleInfo.self, forKey: .bubble)
            self = .bubble(kind: kind, mode: mode, dedupeKey: dedupeKey, plainLink: plainLink, bubble: info)
        case "haptic":
            let style = try container.decode(HapticStyle.self, forKey: .style)
            self = .haptic(style)
        case "presentation":
            let style = try container.decode(PresentationStyle.self, forKey: .style)
            self = .presentation(style)
        default:
            self = .unknown(type)
        }
    }

    /// The `type` string of this event.
    public var type: String {
        switch self {
        case .ready: return "ready"
        case .rememberName: return "rememberName"
        case .bubble: return "bubble"
        case .haptic: return "haptic"
        case .presentation: return "presentation"
        case .unknown(let type): return type
        }
    }

    /// The bubble payload of a `.bubble` event, nil for every other event.
    public var bubbleRequest: BubbleRequest? {
        if case let .bubble(kind, mode, dedupeKey, plainLink, info) = self {
            return BubbleRequest(kind: kind, mode: mode, dedupeKey: dedupeKey, plainLink: plainLink, bubble: info)
        }
        return nil
    }
}
