import Foundation

/// Injected by native at document start as window.__FLOCK_NATIVE__ (NativeInfo in bridgeTypes.ts).
public struct NativeInfo: Encodable, Equatable {
    /// Always "imessage".
    public var platform: String
    public var version: Int
    /// Poker name remembered on this device, or nil (encoded as JSON null, never omitted).
    public var name: String?
    /// Presentation at load time.
    public var presentation: PresentationStyle

    public init(name: String?, presentation: PresentationStyle) {
        self.platform = BridgeConstants.platform
        self.version = BridgeConstants.version
        self.name = name
        self.presentation = presentation
    }

    private enum CodingKeys: String, CodingKey {
        case platform
        case version
        case name
        case presentation
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(platform, forKey: .platform)
        try container.encode(version, forKey: .version)
        if let name = name {
            try container.encode(name, forKey: .name)
        } else {
            try container.encodeNil(forKey: .name)
        }
        try container.encode(presentation, forKey: .presentation)
    }
}

/// A native -> web message (NativeToWeb in bridgeTypes.ts), delivered as the `detail` of a
/// `flock:native` CustomEvent.
public enum NativeToWeb: Encodable, Equatable {
    /// Messages resized the extension.
    case presentation(PresentationStyle)
    /// A bubble was posted / inserted (or failed). `sent` is true only when it went straight into the
    /// conversation; `error` is nil on success (encoded as JSON null).
    case bubbleResult(dedupeKey: String, ok: Bool, sent: Bool, error: String?)

    private enum CodingKeys: String, CodingKey {
        case type
        case style
        case dedupeKey
        case ok
        case sent
        case error
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .presentation(let style):
            try container.encode("presentation", forKey: .type)
            try container.encode(style, forKey: .style)
        case let .bubbleResult(dedupeKey, ok, sent, error):
            try container.encode("bubbleResult", forKey: .type)
            try container.encode(dedupeKey, forKey: .dedupeKey)
            try container.encode(ok, forKey: .ok)
            try container.encode(sent, forKey: .sent)
            if let error = error {
                try container.encode(error, forKey: .error)
            } else {
                try container.encodeNil(forKey: .error)
            }
        }
    }
}

public enum BridgeError: Error, Equatable {
    /// WKScriptMessage.body was not a JSON object (or a JSON string).
    case invalidBody
}

/// Builds the JavaScript native runs in the page, and decodes what the page posts.
/// Every value is JSON-encoded and then made safe for embedding in JavaScript source; user text is
/// never concatenated into a script.
public enum NativeBridge {
    /// Prefix and suffix of `injectionScript(info:)`; the JSON literal sits in between.
    public static let injectionPrefix = "window.\(BridgeConstants.globalName) = "
    public static let injectionSuffix = ";"
    /// Prefix and suffix of `dispatchScript(_:)`; the JSON literal sits in between.
    public static let dispatchPrefix = "window.dispatchEvent(new CustomEvent('\(BridgeConstants.eventName)', { detail: "
    public static let dispatchSuffix = " }));"

    /// Source of the WKUserScript run at document start: defines window.__FLOCK_NATIVE__.
    public static func injectionScript(info: NativeInfo) -> String {
        let literal = (try? jsonLiteral(info)) ?? "null"
        return injectionPrefix + literal + injectionSuffix
    }

    /// JavaScript that delivers `payload` to the page as a `flock:native` CustomEvent.
    public static func dispatchScript(_ payload: NativeToWeb) -> String {
        let literal = (try? jsonLiteral(payload)) ?? "null"
        return dispatchPrefix + literal + dispatchSuffix
    }

    /// JSON for `value`, safe to paste into JavaScript source (and into an HTML <script> block):
    /// `<`, `>`, `&`, U+2028 and U+2029 are written as \u escapes. Those characters can only occur
    /// inside JSON string literals, where the escapes decode back to the same text.
    public static func jsonLiteral<T: Encodable>(_ value: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        guard let json = String(data: data, encoding: .utf8) else {
            throw EncodingError.invalidValue(
                value,
                EncodingError.Context(codingPath: [], debugDescription: "JSON is not UTF-8")
            )
        }
        return escapeForJavaScript(json)
    }

    /// Escapes the characters that are unsafe in JavaScript / HTML source but legal raw in JSON.
    public static func escapeForJavaScript(_ json: String) -> String {
        var out = ""
        out.reserveCapacity(json.utf8.count)
        for scalar in json.unicodeScalars {
            switch scalar.value {
            case 0x3C: out += "\\u003c" // <
            case 0x3E: out += "\\u003e" // >
            case 0x26: out += "\\u0026" // &
            case 0x2028: out += "\\u2028" // LINE SEPARATOR
            case 0x2029: out += "\\u2029" // PARAGRAPH SEPARATOR
            default: out.unicodeScalars.append(scalar)
            }
        }
        return out
    }

    /// Decodes WKScriptMessage.body: an NSDictionary for a posted JS object (the contract), or a
    /// JSON string. Unknown event types decode to `.unknown`; malformed known events throw.
    public static func decode(any body: Any) throws -> BridgeEvent {
        let data: Data
        if let string = body as? String {
            data = Data(string.utf8)
        } else if JSONSerialization.isValidJSONObject(body) {
            data = try JSONSerialization.data(withJSONObject: body, options: [])
        } else {
            throw BridgeError.invalidBody
        }
        return try JSONDecoder().decode(BridgeEvent.self, from: data)
    }
}
