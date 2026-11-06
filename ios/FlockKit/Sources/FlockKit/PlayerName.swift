import Foundation

/// The poker name remembered on this device (`rememberName`), passed back in NativeInfo.name.
public final class PlayerNameStore {
    /// LIMITS.nameMaxLength in src/shared/constants.ts.
    public static let maxLength = 16
    public static let defaultStorageKey = "flock.playerName.v1"

    private let store: KeyValueStore
    private let storageKey: String

    public init(store: KeyValueStore, storageKey: String = PlayerNameStore.defaultStorageKey) {
        self.store = store
        self.storageKey = storageKey
    }

    /// The stored name, or nil.
    public var name: String? {
        guard let stored = store.string(forKey: storageKey) else { return nil }
        return PlayerNameStore.sanitize(stored)
    }

    /// Stores a name (trimmed, control characters removed, at most `maxLength` characters).
    /// A blank name clears it.
    public func remember(_ raw: String) {
        store.setString(PlayerNameStore.sanitize(raw), forKey: storageKey)
    }

    public func clear() {
        store.setString(nil, forKey: storageKey)
    }

    /// Trimmed name without control characters, cut to `maxLength` characters; nil when blank.
    public static func sanitize(_ raw: String) -> String? {
        var scalars = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars where !CharacterSet.controlCharacters.contains(scalar) {
            scalars.append(scalar)
        }
        let trimmed = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return String(trimmed.prefix(maxLength))
    }
}
