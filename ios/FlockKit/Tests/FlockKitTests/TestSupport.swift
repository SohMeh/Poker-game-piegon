import Foundation
import XCTest

/// Loads Fixtures/bridge-events.json (the shared web <-> native contract fixture).
enum Fixture {
    static func url() throws -> URL {
        let url = Bundle.module.url(forResource: "bridge-events", withExtension: "json", subdirectory: "Fixtures")
        return try XCTUnwrap(url, "Fixtures/bridge-events.json is missing from the test bundle")
    }

    static func root() throws -> [String: Any] {
        let data = try Data(contentsOf: url())
        let object = try JSONSerialization.jsonObject(with: data, options: [])
        return try XCTUnwrap(object as? [String: Any], "fixture root is not an object")
    }

    static func webToNative() throws -> [[String: Any]] {
        return try XCTUnwrap(root()["webToNative"] as? [[String: Any]], "fixture has no webToNative array")
    }

    static func nativeToWeb() throws -> [[String: Any]] {
        return try XCTUnwrap(root()["nativeToWeb"] as? [[String: Any]], "fixture has no nativeToWeb array")
    }

    static func nativeInfo() throws -> [String: Any] {
        return try XCTUnwrap(root()["nativeInfo"] as? [String: Any], "fixture has no nativeInfo object")
    }
}

/// Encodes a value and parses it back with JSONSerialization, for comparing with fixture objects.
func jsonObject<T: Encodable>(_ value: T) throws -> NSDictionary {
    let data = try JSONEncoder().encode(value)
    let object = try JSONSerialization.jsonObject(with: data, options: [])
    return try XCTUnwrap(object as? NSDictionary, "value did not encode to a JSON object")
}

/// Parses a JSON object literal (e.g. the part of a script between its prefix and suffix).
func parseJSONObject(_ literal: String) throws -> NSDictionary {
    let object = try JSONSerialization.jsonObject(with: Data(literal.utf8), options: [])
    return try XCTUnwrap(object as? NSDictionary, "literal is not a JSON object: \(literal)")
}

/// Strips a known prefix and suffix, failing the test if they are not there.
func between(_ text: String, prefix: String, suffix: String, file: StaticString = #filePath, line: UInt = #line) throws -> String {
    XCTAssertTrue(text.hasPrefix(prefix), "script does not start with \(prefix)", file: file, line: line)
    XCTAssertTrue(text.hasSuffix(suffix), "script does not end with \(suffix)", file: file, line: line)
    guard text.hasPrefix(prefix), text.hasSuffix(suffix), text.count >= prefix.count + suffix.count else {
        throw NSError(domain: "FlockKitTests", code: 1)
    }
    return String(text.dropFirst(prefix.count).dropLast(suffix.count))
}

/// A string with everything that tends to break script injection.
let nastyText = "Bo\"b's </script><script>alert(1)</script> & <!-- \u{2028}line\u{2029}para \\ \\u2028 `${x}` \n\t🐔🂡👨‍👩‍👧"
