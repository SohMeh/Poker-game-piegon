import Foundation

/// Minimal persistent key-value storage, injectable so the logic is testable without UserDefaults.
public protocol KeyValueStore: AnyObject {
    func data(forKey key: String) -> Data?
    func setData(_ data: Data?, forKey key: String)
    func string(forKey key: String) -> String?
    func setString(_ string: String?, forKey key: String)
}

/// UserDefaults-backed store (what the extension uses).
public final class UserDefaultsStore: KeyValueStore {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func data(forKey key: String) -> Data? {
        return defaults.data(forKey: key)
    }

    public func setData(_ data: Data?, forKey key: String) {
        if let data = data {
            defaults.set(data, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }

    public func string(forKey key: String) -> String? {
        return defaults.string(forKey: key)
    }

    public func setString(_ string: String?, forKey key: String) {
        if let string = string {
            defaults.set(string, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
}

/// In-memory store (tests, previews).
public final class InMemoryStore: KeyValueStore {
    private var values: [String: Any] = [:]

    public init() {}

    public func data(forKey key: String) -> Data? {
        return values[key] as? Data
    }

    public func setData(_ data: Data?, forKey key: String) {
        if let data = data {
            values[key] = data
        } else {
            values.removeValue(forKey: key)
        }
    }

    public func string(forKey key: String) -> String? {
        return values[key] as? String
    }

    public func setString(_ string: String?, forKey key: String) {
        if let string = string {
            values[key] = string
        } else {
            values.removeValue(forKey: key)
        }
    }
}
