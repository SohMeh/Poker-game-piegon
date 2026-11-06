import Foundation
import XCTest
@testable import FlockKit

/// Cross-checks the Swift enums against the TypeScript source of the contract
/// (src/client/native/bridgeTypes.ts), when the package is tested inside the repository.
final class ContractSourceTests: XCTestCase {
    private func typeScriptSource() throws -> String {
        // ios/FlockKit/Tests/FlockKitTests/<this file> -> repository root
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // FlockKitTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // FlockKit
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repository root
        let file = repoRoot.appendingPathComponent("src/client/native/bridgeTypes.ts")
        guard let source = try? String(contentsOf: file, encoding: .utf8) else {
            throw XCTSkip("bridgeTypes.ts not found at \(file.path)")
        }
        return source
    }

    private func section(_ source: String, from start: String, to end: String) throws -> String {
        let startRange = try XCTUnwrap(source.range(of: start), "\(start) not found in bridgeTypes.ts")
        let endRange = try XCTUnwrap(
            source.range(of: end, range: startRange.upperBound..<source.endIndex),
            "\(end) not found after \(start)"
        )
        return String(source[startRange.lowerBound..<endRange.lowerBound])
    }

    private func captures(_ pattern: String, in text: String) throws -> [String] {
        let regex = try NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, options: [], range: range).compactMap { match in
            guard let captured = Range(match.range(at: 1), in: text) else { return nil }
            return String(text[captured])
        }
    }

    private func quotedValues(_ text: String) throws -> Set<String> {
        return Set(try captures("'([A-Za-z:_]+)'", in: text))
    }

    func testStringUnionsMatch() throws {
        let source = try typeScriptSource()
        XCTAssertEqual(
            try quotedValues(section(source, from: "export type BubbleKind =", to: ";")),
            Set(BubbleKind.allCases.map { $0.rawValue })
        )
        XCTAssertEqual(
            try quotedValues(section(source, from: "export type BubbleMode =", to: ";")),
            Set(BubbleMode.allCases.map { $0.rawValue })
        )
        XCTAssertEqual(
            try quotedValues(section(source, from: "export type HapticStyle =", to: ";")),
            Set(HapticStyle.allCases.map { $0.rawValue })
        )
        XCTAssertEqual(
            try quotedValues(section(source, from: "status:", to: ";")),
            Set(TableStatus.allCases.map { $0.rawValue })
        )
        XCTAssertEqual(
            try quotedValues(section(source, from: "route:", to: "}")),
            Set(ReadyRoute.allCases.map { $0.rawValue })
        )
        XCTAssertEqual(
            try quotedValues(section(source, from: "presentation:", to: ";")),
            Set(PresentationStyle.allCases.map { $0.rawValue })
        )
    }

    func testEventTypesMatch() throws {
        let source = try typeScriptSource()
        let webToNative = try section(source, from: "export type WebToNative", to: "export type NativeToWeb")
        XCTAssertEqual(
            Set(try captures("type: '([A-Za-z]+)'", in: webToNative)),
            ["ready", "rememberName", "bubble", "haptic", "presentation"]
        )
        let nativeToWebStart = try XCTUnwrap(source.range(of: "export type NativeToWeb"))
        let nativeToWeb = String(source[nativeToWebStart.lowerBound...])
        XCTAssertEqual(Set(try captures("type: '([A-Za-z]+)'", in: nativeToWeb)), ["presentation", "bubbleResult"])
    }

    func testInterfaceFieldsMatch() throws {
        let source = try typeScriptSource()
        let bubbleInfo = try section(source, from: "export interface BubbleInfo {", to: "\n}")
        let sample = BubbleInfo(
            roomId: "ABC123", url: "https://flock-poker.onrender.com/g/ABC123", title: "t", subtitle: "s",
            summary: "m", trailing: "r", status: .lobby, hostName: "h", seated: 1, maxPlayers: 9,
            smallBlind: 10, bigBlind: 20, buyIn: 2000, handNumber: 0
        )
        let swiftKeys = Set(try jsonObject(sample).allKeys.compactMap { $0 as? String })
        XCTAssertEqual(Set(try captures("^\\s+(\\w+):", in: bubbleInfo)), swiftKeys)

        let nativeInfo = try section(source, from: "export interface NativeInfo {", to: "\n}")
        let infoKeys = Set(try jsonObject(NativeInfo(name: nil, presentation: .compact)).allKeys.compactMap { $0 as? String })
        XCTAssertEqual(Set(try captures("^\\s+(\\w+):", in: nativeInfo)), infoKeys)
    }

    func testConstantsMatch() throws {
        let source = try typeScriptSource()
        XCTAssertTrue(source.contains("export const BRIDGE_VERSION = \(BridgeConstants.version);"))
        XCTAssertTrue(source.contains("export const BRIDGE_HANDLER = '\(BridgeConstants.handlerName)';"))
        XCTAssertTrue(source.contains("'\(BridgeConstants.eventName)'"))
        XCTAssertTrue(source.contains(BridgeConstants.globalName))
    }
}
