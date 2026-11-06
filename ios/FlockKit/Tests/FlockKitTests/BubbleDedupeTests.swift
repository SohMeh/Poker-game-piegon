import Foundation
import XCTest
@testable import FlockKit

final class BubbleDedupeTests: XCTestCase {
    /// A clock the test moves by hand.
    private final class Clock {
        var time = Date(timeIntervalSince1970: 1_800_000_000)

        func now() -> Date {
            return time
        }

        func advance(_ seconds: TimeInterval) {
            time = time.addingTimeInterval(seconds)
        }
    }

    func testPolicyPerKind() {
        XCTAssertEqual(BubbleDedupe.policy(kind: .gameStarted, mode: .send), .persistent)
        XCTAssertEqual(BubbleDedupe.policy(kind: .buyBackRequested, mode: .send), .persistent)
        XCTAssertEqual(BubbleDedupe.policy(kind: .rematch, mode: .send), .persistent)
        XCTAssertEqual(BubbleDedupe.policy(kind: .yourTurn, mode: .send), .window(BubbleDedupe.repeatableWindow))
        XCTAssertEqual(BubbleDedupe.policy(kind: .gameOver, mode: .send), .window(BubbleDedupe.repeatableWindow))
        XCTAssertEqual(BubbleDedupe.policy(kind: .invite, mode: .send), .window(BubbleDedupe.insertWindow))
        for kind in BubbleKind.allCases {
            XCTAssertEqual(BubbleDedupe.policy(kind: kind, mode: .insert), .window(BubbleDedupe.insertWindow), kind.rawValue)
        }
    }

    func testOncePerRoomKindsStayDuplicatesAcrossReloads() {
        let store = InMemoryStore()
        let clock = Clock()
        let deduper = BubbleDeduper(ledger: BubbleLedger(store: store), now: clock.now)
        let key = "gameStarted:ABC123:1"
        XCTAssertFalse(deduper.isDuplicate(key, kind: .gameStarted, mode: .send))
        deduper.recordPosted(key, kind: .gameStarted, mode: .send)
        XCTAssertTrue(deduper.isDuplicate(key, kind: .gameStarted, mode: .send))
        clock.advance(24 * 60 * 60)
        XCTAssertTrue(deduper.isDuplicate(key, kind: .gameStarted, mode: .send))
        // The extension was relaunched: a new ledger over the same store still knows the key.
        let reloaded = BubbleDeduper(ledger: BubbleLedger(store: store), now: clock.now)
        XCTAssertTrue(reloaded.isDuplicate(key, kind: .gameStarted, mode: .send))
        XCTAssertEqual(BubbleLedger(store: store).keys, [key])
    }

    func testYourTurnKeyCanComeBackInALaterGame() {
        // yourTurn:<room>:<hand>:<player>: hand numbers restart after a rematch, so game 2 can send
        // exactly the key game 1 sent. Only a doubled event is dropped.
        let store = InMemoryStore()
        let clock = Clock()
        let deduper = BubbleDeduper(ledger: BubbleLedger(store: store), now: clock.now)
        let key = "yourTurn:ABC123:15:p_carol"
        deduper.recordPosted(key, kind: .yourTurn, mode: .send)
        XCTAssertTrue(deduper.isDuplicate(key, kind: .yourTurn, mode: .send), "the same event twice is dropped")
        clock.advance(BubbleDedupe.repeatableWindow + 1)
        XCTAssertFalse(deduper.isDuplicate(key, kind: .yourTurn, mode: .send), "a later game's nudge goes out")
        XCTAssertEqual(BubbleLedger(store: store).keys, [], "repeatable keys are not persisted")
        let reloaded = BubbleDeduper(ledger: BubbleLedger(store: store), now: clock.now)
        XCTAssertFalse(reloaded.isDuplicate(key, kind: .yourTurn, mode: .send))
    }

    func testGameOverKeyCanComeBackAfterABuyBack() {
        let clock = Clock()
        let deduper = BubbleDeduper(ledger: BubbleLedger(store: InMemoryStore()), now: clock.now)
        let key = "gameOver:ABC123:1:p_alice"
        deduper.recordPosted(key, kind: .gameOver, mode: .send)
        clock.advance(5)
        XCTAssertTrue(deduper.isDuplicate(key, kind: .gameOver, mode: .send))
        clock.advance(BubbleDedupe.repeatableWindow)
        XCTAssertFalse(deduper.isDuplicate(key, kind: .gameOver, mode: .send))
    }

    func testInviteInsertOnlyDropsADoubleTap() {
        let clock = Clock()
        let deduper = BubbleDeduper(ledger: BubbleLedger(store: InMemoryStore()), now: clock.now)
        let key = "invite:ABC123:1"
        deduper.recordPosted(key, kind: .invite, mode: .insert)
        clock.advance(1)
        XCTAssertTrue(deduper.isDuplicate(key, kind: .invite, mode: .insert))
        clock.advance(BubbleDedupe.insertWindow)
        XCTAssertFalse(deduper.isDuplicate(key, kind: .invite, mode: .insert), "a later Send to chat inserts again")
    }

    func testEmptyKeyIsNeverADuplicate() {
        let deduper = BubbleDeduper(ledger: BubbleLedger(store: InMemoryStore()))
        deduper.recordPosted("", kind: .gameStarted, mode: .send)
        deduper.recordPosted("", kind: .yourTurn, mode: .send)
        XCTAssertFalse(deduper.isDuplicate("", kind: .gameStarted, mode: .send))
        XCTAssertFalse(deduper.isDuplicate("", kind: .yourTurn, mode: .send))
    }
}
