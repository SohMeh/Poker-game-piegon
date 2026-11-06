import Foundation

/// A table this device opened recently (shown in the compact view).
public struct RecentTable: Codable, Equatable {
    public var roomId: String
    public var title: String
    public var lastOpened: Date

    public init(roomId: String, title: String, lastOpened: Date) {
        self.roomId = roomId
        self.title = title
        self.lastOpened = lastOpened
    }
}

/// Small persisted list of recent tables, most recently opened first, at most `maxCount` entries.
public final class RecentTables {
    public static let defaultMaxCount = 8
    public static let defaultStorageKey = "flock.recentTables.v1"
    /// Longest title kept (the compact view shows one line).
    public static let maxTitleLength = 60

    public let maxCount: Int
    private let store: KeyValueStore
    private let storageKey: String
    private let now: () -> Date
    private var entries: [RecentTable]

    public init(
        store: KeyValueStore,
        storageKey: String = RecentTables.defaultStorageKey,
        maxCount: Int = RecentTables.defaultMaxCount,
        now: @escaping () -> Date = { Date() }
    ) {
        let cap = max(1, maxCount)
        var loaded: [RecentTable] = []
        if let data = store.data(forKey: storageKey),
           let decoded = try? RecentTables.makeDecoder().decode([RecentTable].self, from: data) {
            loaded = decoded
        }
        // Keep valid, unique room codes, newest first, capped.
        var seen = Set<String>()
        var cleaned: [RecentTable] = []
        for entry in loaded.sorted(by: { $0.lastOpened > $1.lastOpened }) {
            guard let id = RoomLink.normalizeRoomId(entry.roomId), !seen.contains(id) else { continue }
            seen.insert(id)
            var copy = entry
            copy.roomId = id
            cleaned.append(copy)
            if cleaned.count == cap { break }
        }
        self.store = store
        self.storageKey = storageKey
        self.maxCount = cap
        self.now = now
        self.entries = cleaned
    }

    /// Most recently opened first.
    public var tables: [RecentTable] {
        return entries
    }

    /// Moves (or adds) a table to the front and stamps it with the current time. A nil or blank
    /// `title` keeps the stored title (or uses "Table <ID>" for a new entry). Invalid codes are ignored.
    @discardableResult
    public func touch(roomId: String, title: String? = nil) -> RecentTable? {
        guard let id = RoomLink.normalizeRoomId(roomId) else { return nil }
        let cleanTitle = RecentTables.clean(title)
        let existing = entries.first { $0.roomId == id }
        let resolvedTitle = cleanTitle ?? existing?.title ?? RecentTables.defaultTitle(for: id)
        let entry = RecentTable(roomId: id, title: resolvedTitle, lastOpened: now())
        entries.removeAll { $0.roomId == id }
        entries.insert(entry, at: 0)
        if entries.count > maxCount {
            entries.removeLast(entries.count - maxCount)
        }
        save()
        return entry
    }

    /// Renames a stored table without changing its position (no-op if it is not stored).
    public func rename(roomId: String, title: String) {
        guard let id = RoomLink.normalizeRoomId(roomId), let cleanTitle = RecentTables.clean(title) else { return }
        guard let index = entries.firstIndex(where: { $0.roomId == id }) else { return }
        entries[index].title = cleanTitle
        save()
    }

    public func remove(roomId: String) {
        guard let id = RoomLink.normalizeRoomId(roomId) else { return }
        let before = entries.count
        entries.removeAll { $0.roomId == id }
        if entries.count != before { save() }
    }

    public func removeAll() {
        entries.removeAll()
        save()
    }

    public static func defaultTitle(for roomId: String) -> String {
        return "Table \(roomId)"
    }

    private static func clean(_ title: String?) -> String? {
        guard let title = title else { return nil }
        let trimmed = title
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        if trimmed.count > maxTitleLength {
            return String(trimmed.prefix(maxTitleLength - 1)) + "…"
        }
        return trimmed
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return decoder
    }

    private static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        return encoder
    }

    private func save() {
        if let data = try? RecentTables.makeEncoder().encode(entries) {
            store.setData(data, forKey: storageKey)
        }
    }
}
