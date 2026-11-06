import Foundation
import XCTest
@testable import FlockKit

final class BubbleLedgerTests: XCTestCase {
    func testDedupesByKey() {
        let ledger = BubbleLedger(store: InMemoryStore())
        XCTAssertFalse(ledger.contains("gameStarted:ABC123:1"))
        XCTAssertTrue(ledger.record("gameStarted:ABC123:1"))
        XCTAssertTrue(ledger.contains("gameStarted:ABC123:1"))
        XCTAssertFalse(ledger.record("gameStarted:ABC123:1"), "second record of the same key is a duplicate")
        XCTAssertFalse(ledger.contains("gameStarted:ABC123:2"))
        XCTAssertEqual(ledger.keys, ["gameStarted:ABC123:1"])
    }

    func testEmptyKeyIsNeverADuplicate() {
        let ledger = BubbleLedger(store: InMemoryStore())
        XCTAssertFalse(ledger.record(""))
        XCTAssertFalse(ledger.contains(""))
        XCTAssertEqual(ledger.keys, [])
    }

    func testPersistsAcrossInstances() {
        let store = InMemoryStore()
        let first = BubbleLedger(store: store)
        first.record("invite:ABC123:1")
        first.record("yourTurn:ABC123:15:p_carol")
        let second = BubbleLedger(store: store)
        XCTAssertTrue(second.contains("invite:ABC123:1"))
        XCTAssertTrue(second.contains("yourTurn:ABC123:15:p_carol"))
        XCTAssertEqual(second.keys, ["invite:ABC123:1", "yourTurn:ABC123:15:p_carol"])
    }

    func testCapDropsTheOldestKeys() {
        let store = InMemoryStore()
        let ledger = BubbleLedger(store: store, capacity: 3)
        for i in 1...5 {
            ledger.record("k\(i)")
        }
        XCTAssertEqual(ledger.keys, ["k3", "k4", "k5"])
        XCTAssertFalse(ledger.contains("k1"))
        XCTAssertFalse(ledger.contains("k2"))
        XCTAssertTrue(ledger.contains("k5"))
        // A dropped key can be posted again.
        XCTAssertTrue(ledger.record("k1"))
        XCTAssertEqual(ledger.keys, ["k4", "k5", "k1"])
        // The cap also applies to what was stored by a bigger ledger.
        let smaller = BubbleLedger(store: store, capacity: 2)
        XCTAssertEqual(smaller.keys, ["k5", "k1"])
    }

    func testDefaultCapIsBounded() {
        let store = InMemoryStore()
        let ledger = BubbleLedger(store: store)
        for i in 0..<(BubbleLedger.defaultCapacity + 50) {
            ledger.record("key-\(i)")
        }
        XCTAssertEqual(ledger.keys.count, BubbleLedger.defaultCapacity)
        XCTAssertEqual(BubbleLedger(store: store).keys.count, BubbleLedger.defaultCapacity)
    }

    func testRemove() {
        let store = InMemoryStore()
        let ledger = BubbleLedger(store: store)
        ledger.record("a")
        ledger.record("b")
        ledger.remove("a")
        ledger.remove("never-recorded")
        XCTAssertFalse(ledger.contains("a"))
        XCTAssertEqual(BubbleLedger(store: store).keys, ["b"])
    }

    func testIgnoresCorruptStoredData() {
        let store = InMemoryStore()
        store.setData(Data("not json".utf8), forKey: BubbleLedger.defaultStorageKey)
        let ledger = BubbleLedger(store: store)
        XCTAssertEqual(ledger.keys, [])
        XCTAssertTrue(ledger.record("x"))
    }

    func testUserDefaultsStoreRoundTrip() throws {
        let suite = "FlockKitTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsStore(defaults: defaults)
        BubbleLedger(store: store).record("persisted")
        XCTAssertTrue(BubbleLedger(store: UserDefaultsStore(defaults: defaults)).contains("persisted"))
        store.setString("Sohum", forKey: "s")
        XCTAssertEqual(store.string(forKey: "s"), "Sohum")
        store.setString(nil, forKey: "s")
        XCTAssertNil(store.string(forKey: "s"))
    }
}

final class RecentTablesTests: XCTestCase {
    /// A clock that ticks one second per call.
    private final class Clock {
        var time = Date(timeIntervalSince1970: 1_800_000_000)
        func next() -> Date {
            time = time.addingTimeInterval(1)
            return time
        }
    }

    func testMostRecentFirstAndMoveToFront() {
        let clock = Clock()
        let recents = RecentTables(store: InMemoryStore(), now: clock.next)
        recents.touch(roomId: "AAAAAA", title: "Sohum's game")
        recents.touch(roomId: "BBBBBB", title: "Bob's game")
        recents.touch(roomId: "CCCCCC", title: "Carol's game")
        XCTAssertEqual(recents.tables.map { $0.roomId }, ["CCCCCC", "BBBBBB", "AAAAAA"])
        recents.touch(roomId: "aaaaaa")
        XCTAssertEqual(recents.tables.map { $0.roomId }, ["AAAAAA", "CCCCCC", "BBBBBB"])
        XCTAssertEqual(recents.tables.first?.title, "Sohum's game", "a nil title keeps the stored one")
        XCTAssertEqual(recents.tables.first?.lastOpened, clock.time)
    }

    func testCapsAtEight() {
        let recents = RecentTables(store: InMemoryStore(), now: Clock().next)
        let ids = ["AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE", "FFFFFF", "GGGGGG", "HHHHHH", "JJJJJJ", "KKKKKK"]
        for id in ids {
            recents.touch(roomId: id, title: nil)
        }
        XCTAssertEqual(RecentTables.defaultMaxCount, 8)
        XCTAssertEqual(recents.tables.count, 8)
        XCTAssertEqual(recents.tables.map { $0.roomId }, Array(ids.reversed().prefix(8)))
        XCTAssertFalse(recents.tables.contains { $0.roomId == "AAAAAA" })
    }

    func testTitles() {
        let recents = RecentTables(store: InMemoryStore(), now: Clock().next)
        recents.touch(roomId: "ABC234", title: "   ")
        XCTAssertEqual(recents.tables.first?.title, "Table ABC234")
        recents.touch(roomId: "ABC234", title: "  Sohum's\npoker game ")
        XCTAssertEqual(recents.tables.first?.title, "Sohum's poker game")
        recents.touch(roomId: "ABC234", title: String(repeating: "x", count: 200))
        XCTAssertEqual(recents.tables.first?.title.count, RecentTables.maxTitleLength)
        XCTAssertEqual(recents.tables.first?.title.hasSuffix("…"), true)
        recents.rename(roomId: "abc234", title: "Friday game")
        XCTAssertEqual(recents.tables.first?.title, "Friday game")
    }

    func testIgnoresInvalidRoomCodes() {
        let recents = RecentTables(store: InMemoryStore(), now: Clock().next)
        XCTAssertNil(recents.touch(roomId: "nope", title: "x"))
        XCTAssertNil(recents.touch(roomId: "ABC23O", title: "x"))
        XCTAssertEqual(recents.tables, [])
    }

    func testPersistsAndRemoves() {
        let store = InMemoryStore()
        let clock = Clock()
        let recents = RecentTables(store: store, now: clock.next)
        recents.touch(roomId: "AAAAAA", title: "A")
        recents.touch(roomId: "BBBBBB", title: "B")
        let reloaded = RecentTables(store: store, now: clock.next)
        XCTAssertEqual(reloaded.tables, recents.tables)
        XCTAssertEqual(reloaded.tables.map { $0.title }, ["B", "A"])
        reloaded.remove(roomId: "bbbbbb")
        XCTAssertEqual(RecentTables(store: store).tables.map { $0.roomId }, ["AAAAAA"])
        reloaded.removeAll()
        XCTAssertEqual(RecentTables(store: store).tables, [])
    }

    func testLoadingSortsDedupesAndCapsStoredData() throws {
        let store = InMemoryStore()
        let stored: [[String: Any]] = [
            ["roomId": "AAAAAA", "title": "old", "lastOpened": 100],
            ["roomId": "bbbbbb", "title": "newest", "lastOpened": 300],
            ["roomId": "AAAAAA", "title": "dup newer", "lastOpened": 200],
            ["roomId": "bad!", "title": "invalid", "lastOpened": 400],
        ]
        store.setData(try JSONSerialization.data(withJSONObject: stored), forKey: RecentTables.defaultStorageKey)
        let recents = RecentTables(store: store, maxCount: 8)
        XCTAssertEqual(recents.tables.map { $0.roomId }, ["BBBBBB", "AAAAAA"])
        XCTAssertEqual(recents.tables.map { $0.title }, ["newest", "dup newer"])
    }
}

final class PlayerNameStoreTests: XCTestCase {
    func testRemembersASanitizedName() {
        let store = InMemoryStore()
        let names = PlayerNameStore(store: store)
        XCTAssertNil(names.name)
        names.remember("  Sohum \n")
        XCTAssertEqual(names.name, "Sohum")
        XCTAssertEqual(PlayerNameStore(store: store).name, "Sohum")
        names.remember("Bo\u{0007}b")
        XCTAssertEqual(names.name, "Bob")
        names.remember("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        XCTAssertEqual(names.name, "ABCDEFGHIJKLMNOP")
        names.remember("🐔 Chicken")
        XCTAssertEqual(names.name, "🐔 Chicken")
        names.remember("   ")
        XCTAssertNil(names.name, "a blank name clears it")
        names.remember("Carol")
        names.clear()
        XCTAssertNil(names.name)
    }
}
