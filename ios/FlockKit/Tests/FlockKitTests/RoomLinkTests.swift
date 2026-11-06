import Foundation
import XCTest
@testable import FlockKit

final class RoomLinkTests: XCTestCase {
    private let host = "flock-poker.onrender.com"
    private let server = URL(string: "https://flock-poker.onrender.com")!

    private func room(_ string: String, serverHost: String? = nil) -> String? {
        guard let url = URL(string: string) else { return nil }
        return RoomLink.roomId(from: url, serverHost: serverHost)
    }

    func testAlphabetMatchesTheServer() {
        // ROOM_ID_ALPHABET in src/shared/constants.ts: no 0/O/1/I/L.
        XCTAssertEqual(RoomLink.alphabet, "ABCDEFGHJKMNPQRSTUVWXYZ23456789")
        XCTAssertEqual(RoomLink.alphabet.count, 31)
        XCTAssertEqual(RoomLink.idLength, 6)
    }

    func testNormalizeRoomId() {
        XCTAssertEqual(RoomLink.normalizeRoomId("ABC234"), "ABC234")
        XCTAssertEqual(RoomLink.normalizeRoomId("abc234"), "ABC234")
        XCTAssertEqual(RoomLink.normalizeRoomId("  xyz789\n"), "XYZ789")
        XCTAssertNil(RoomLink.normalizeRoomId(""))
        XCTAssertNil(RoomLink.normalizeRoomId("ABC23"))
        XCTAssertNil(RoomLink.normalizeRoomId("ABC2345"))
        XCTAssertNil(RoomLink.normalizeRoomId("ABC 23"))
        for bad in ["ABC230", "ABC23O", "ABC231", "ABC23I", "ABC23L", "abc23l", "ABC23-", "ABC23É", "ÅBC234", "ABC23🐔"] {
            XCTAssertNil(RoomLink.normalizeRoomId(bad), bad)
        }
    }

    func testParsesTableLinks() {
        XCTAssertEqual(room("https://flock-poker.onrender.com/g/ABC234"), "ABC234")
        XCTAssertEqual(room("https://flock-poker.onrender.com/g/abc234"), "ABC234")
        XCTAssertEqual(room("https://flock-poker.onrender.com/G/AbC234"), "ABC234")
        XCTAssertEqual(room("https://flock-poker.onrender.com/g/ABC234/"), "ABC234")
        XCTAssertEqual(room("https://flock-poker.onrender.com/g/ABC234?embed=imessage"), "ABC234")
        XCTAssertEqual(room("https://flock-poker.onrender.com/g/ABC234?embed=imessage&x=/g/ZZZZZZ#frag"), "ABC234")
        XCTAssertEqual(room("http://localhost:3000/g/XYZ789"), "XYZ789")
        XCTAssertEqual(room("https://FLOCK-POKER.onrender.com/g/ABC234", serverHost: host), "ABC234")
    }

    func testRejectsOtherLinks() {
        let bad = [
            "https://flock-poker.onrender.com/",
            "https://flock-poker.onrender.com/g/",
            "https://flock-poker.onrender.com/g/ABC23",
            "https://flock-poker.onrender.com/g/ABC2345",
            "https://flock-poker.onrender.com/g/ABC23O",
            "https://flock-poker.onrender.com/x/ABC234",
            "https://flock-poker.onrender.com/ABC234",
            "https://flock-poker.onrender.com/g/ABC234/extra",
            "https://flock-poker.onrender.com/api/g/ABC234",
            "https://flock-poker.onrender.com/?room=ABC234",
            "ftp://flock-poker.onrender.com/g/ABC234",
            "flockpoker://g/ABC234",
            "data:text/plain,/g/ABC234",
        ]
        for string in bad {
            XCTAssertNil(room(string), string)
        }
    }

    func testRequiresTheServerHostWhenGiven() {
        let bad = [
            "http://flock-poker.onrender.com/g/ABC234",
            "https://evil.example/g/ABC234",
            "https://evil.flock-poker.onrender.com/g/ABC234",
            "https://flock-poker.onrender.com.evil.example/g/ABC234",
            "https://flock-poker.onrender.com@evil.example/g/ABC234",
            "https://flock-poker.onrender.com:8443/g/ABC234",
        ]
        for string in bad {
            XCTAssertNil(room(string, serverHost: host), string)
            XCTAssertNotNil(room(string), "without a host check this one parses: \(string)")
        }
        XCTAssertEqual(RoomLink.roomId(fromString: "https://flock-poker.onrender.com/g/abc234", serverHost: host), "ABC234")
        XCTAssertNil(RoomLink.roomId(fromString: "not a url", serverHost: host))
    }

    func testBuildsExtensionURLs() {
        XCTAssertEqual(RoomLink.createURL(server: server).absoluteString, "https://flock-poker.onrender.com/?embed=imessage&create=1")
        XCTAssertEqual(RoomLink.homeURL(server: server).absoluteString, "https://flock-poker.onrender.com/?embed=imessage")
        XCTAssertEqual(RoomLink.tableURL(server: server, roomId: "abc234")?.absoluteString, "https://flock-poker.onrender.com/g/ABC234?embed=imessage")
        XCTAssertEqual(RoomLink.shareURL(server: server, roomId: "ABC234")?.absoluteString, "https://flock-poker.onrender.com/g/ABC234")
        XCTAssertNil(RoomLink.tableURL(server: server, roomId: "nope"))
        XCTAssertNil(RoomLink.shareURL(server: server, roomId: "ABC23O"))

        // A server URL with a trailing slash or a port.
        let slash = URL(string: "https://flock-poker.onrender.com/")!
        XCTAssertEqual(RoomLink.tableURL(server: slash, roomId: "ABC234")?.absoluteString, "https://flock-poker.onrender.com/g/ABC234?embed=imessage")
        let dev = URL(string: "https://dev.example.com:8443")!
        XCTAssertEqual(RoomLink.createURL(server: dev).absoluteString, "https://dev.example.com:8443/?embed=imessage&create=1")
    }

    func testBuiltTableURLParsesBack() throws {
        let url = try XCTUnwrap(RoomLink.tableURL(server: server, roomId: "XYZ789"))
        XCTAssertEqual(RoomLink.roomId(from: url, serverHost: host), "XYZ789")
        XCTAssertTrue(RoomLink.isAllowed(url, serverHost: host))
        XCTAssertTrue(RoomLink.isAllowed(RoomLink.createURL(server: server), serverHost: host))
    }

    func testIsAllowed() {
        let good = [
            "https://flock-poker.onrender.com",
            "https://flock-poker.onrender.com/",
            "https://flock-poker.onrender.com/g/ABC234?embed=imessage",
            "https://Flock-Poker.OnRender.com/assets/index.js",
            "https://flock-poker.onrender.com:443/socket.io/?EIO=4",
        ]
        for string in good {
            XCTAssertTrue(RoomLink.isAllowed(URL(string: string)!, serverHost: host), string)
        }
        let bad = [
            "http://flock-poker.onrender.com/",
            "https://onrender.com/",
            "https://evil.flock-poker.onrender.com/",
            "https://flock-poker.onrender.com.evil.example/",
            "https://flock-poker.onrender.com@evil.example/",
            "https://flock-poker.onrender.com:8443/",
            "about:blank",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "sms:123",
        ]
        for string in bad {
            XCTAssertFalse(RoomLink.isAllowed(URL(string: string)!, serverHost: host), string)
        }
    }

    func testIsAllowedWithAPortInTheServerHost() {
        XCTAssertTrue(RoomLink.isAllowed(URL(string: "https://dev.example.com:8443/g/ABC234")!, serverHost: "dev.example.com:8443"))
        XCTAssertFalse(RoomLink.isAllowed(URL(string: "https://dev.example.com/g/ABC234")!, serverHost: "dev.example.com:8443"))
        XCTAssertFalse(RoomLink.isAllowed(URL(string: "https://flock-poker.onrender.com/")!, serverHost: ""))
        XCTAssertFalse(RoomLink.isAllowed(URL(string: "https://flock-poker.onrender.com/")!, serverHost: "https://flock-poker.onrender.com"))
    }
}
