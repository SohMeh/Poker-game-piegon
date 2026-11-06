import Foundation

/// Room codes, table links and the origin check used for navigation and bridge messages.
public enum RoomLink {
    /// ROOM_ID_ALPHABET in src/shared/constants.ts (no 0/O/1/I/L).
    public static let alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    /// LIMITS.roomIdLength in src/shared/constants.ts.
    public static let idLength = 6
    /// Query added to every page the extension loads (sticky for the page session).
    public static let embedQuery = "embed=imessage"

    private static let allowedCharacters = Set(alphabet.unicodeScalars)

    /// Upper-cases and trims a room code; nil if it can never be a valid code.
    public static func normalizeRoomId(_ raw: String) -> String? {
        let id = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let scalars = Array(id.unicodeScalars)
        guard scalars.count == idLength else { return nil }
        for scalar in scalars where !allowedCharacters.contains(scalar) {
            return nil
        }
        return id
    }

    /// The room code of a table link `http(s)://<host>/g/<ID>` (a trailing slash, the query and the
    /// fragment are ignored; the code is case-insensitive). When `serverHost` is given the link must
    /// also pass `isAllowed(_:serverHost:)`, i.e. be an https link to that exact host.
    public static func roomId(from url: URL, serverHost: String? = nil) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        if let serverHost = serverHost, !isAllowed(url, serverHost: serverHost) { return nil }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count == 2, parts[0].lowercased() == "g" else { return nil }
        return normalizeRoomId(String(parts[1]))
    }

    /// Convenience for a URL string (e.g. MSMessage.url?.absoluteString or BubbleInfo.url).
    public static func roomId(fromString string: String, serverHost: String? = nil) -> String? {
        guard let url = URL(string: string) else { return nil }
        return roomId(from: url, serverHost: serverHost)
    }

    /// `<server>/?embed=imessage` (home screen).
    public static func homeURL(server: URL) -> URL {
        return build(server: server, path: "/", query: embedQuery)
    }

    /// `<server>/?embed=imessage&create=1` (app drawer "New game": create form first).
    public static func createURL(server: URL) -> URL {
        return build(server: server, path: "/", query: embedQuery + "&create=1")
    }

    /// `<server>/g/<ID>?embed=imessage` (a game bubble was tapped). nil for an invalid room code.
    public static func tableURL(server: URL, roomId: String) -> URL? {
        guard let id = normalizeRoomId(roomId) else { return nil }
        return build(server: server, path: "/g/" + id, query: embedQuery)
    }

    /// The public link of a table (what friends without the app open): `<server>/g/<ID>`.
    public static func shareURL(server: URL, roomId: String) -> URL? {
        guard let id = normalizeRoomId(roomId) else { return nil }
        return build(server: server, path: "/g/" + id, query: nil)
    }

    /// True if `url` is an https URL on exactly `serverHost` (a host name, optionally with ":port").
    /// Host comparison is case-insensitive; subdomains, look-alike suffixes, other ports and
    /// non-https schemes are rejected.
    public static func isAllowed(_ url: URL, serverHost: String) -> Bool {
        guard url.scheme?.lowercased() == "https" else { return false }
        guard let host = url.host?.lowercased(), !host.isEmpty else { return false }
        guard let expected = parseHost(serverHost) else { return false }
        guard host == expected.host else { return false }
        let port = url.port ?? 443
        return port == (expected.port ?? 443)
    }

    /// Host and port of `serverHost` ("example.com" or "example.com:8443"), host lower-cased.
    public static func parseHost(_ serverHost: String) -> (host: String, port: Int?)? {
        let trimmed = serverHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("/"), !trimmed.contains("@") else { return nil }
        guard let components = URLComponents(string: "https://" + trimmed),
              let host = components.host?.lowercased(), !host.isEmpty else { return nil }
        return (host, components.port)
    }

    private static func build(server: URL, path: String, query: String?) -> URL {
        var components = URLComponents()
        components.scheme = server.scheme ?? "https"
        components.host = server.host
        components.port = server.port
        components.path = path
        components.percentEncodedQuery = query
        if let url = components.url {
            return url
        }
        return server
    }
}
