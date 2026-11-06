import Foundation

/// Remembers which bubbles (by `dedupeKey`) this device already posted, so a page reload or a
/// repeated event never posts the same bubble twice. Persisted in a KeyValueStore; only the most
/// recent `capacity` keys are kept (oldest dropped first).
public final class BubbleLedger {
    public static let defaultCapacity = 300
    public static let defaultStorageKey = "flock.bubbleLedger.v1"

    public let capacity: Int
    private let store: KeyValueStore
    private let storageKey: String
    /// Oldest first.
    private var orderedKeys: [String]
    private var keySet: Set<String>

    public init(store: KeyValueStore, storageKey: String = BubbleLedger.defaultStorageKey, capacity: Int = BubbleLedger.defaultCapacity) {
        let cap = max(1, capacity)
        var loaded: [String] = []
        if let data = store.data(forKey: storageKey),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            loaded = decoded
        }
        // Drop duplicates / overflow from older data.
        var seen = Set<String>()
        var unique: [String] = []
        for key in loaded where !key.isEmpty && !seen.contains(key) {
            seen.insert(key)
            unique.append(key)
        }
        if unique.count > cap {
            unique.removeFirst(unique.count - cap)
            seen = Set(unique)
        }
        self.store = store
        self.storageKey = storageKey
        self.capacity = cap
        self.orderedKeys = unique
        self.keySet = seen
    }

    /// Stored keys, oldest first.
    public var keys: [String] {
        return orderedKeys
    }

    /// True if a bubble with this key was already recorded. An empty key is never a duplicate.
    public func contains(_ dedupeKey: String) -> Bool {
        if dedupeKey.isEmpty { return false }
        return keySet.contains(dedupeKey)
    }

    /// Records a posted bubble. Returns false if the key was already recorded (or is empty).
    @discardableResult
    public func record(_ dedupeKey: String) -> Bool {
        if dedupeKey.isEmpty || keySet.contains(dedupeKey) { return false }
        orderedKeys.append(dedupeKey)
        keySet.insert(dedupeKey)
        if orderedKeys.count > capacity {
            let overflow = orderedKeys.count - capacity
            for old in orderedKeys.prefix(overflow) {
                keySet.remove(old)
            }
            orderedKeys.removeFirst(overflow)
        }
        save()
        return true
    }

    /// Forgets a key (e.g. the bubble could not be posted after all).
    public func remove(_ dedupeKey: String) {
        guard keySet.contains(dedupeKey) else { return }
        keySet.remove(dedupeKey)
        orderedKeys.removeAll { $0 == dedupeKey }
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(orderedKeys) {
            store.setData(data, forKey: storageKey)
        }
    }
}
