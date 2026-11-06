import Foundation
import XCTest
@testable import FlockKit
#if canImport(JavaScriptCore)
import JavaScriptCore
#endif

final class NativeBridgeTests: XCTestCase {
    // MARK: - JSON shapes (must equal the fixture)

    func testNativeInfoEncodesLikeTheFixture() throws {
        let info = NativeInfo(name: "Sohum", presentation: .expanded)
        XCTAssertEqual(try jsonObject(info), try Fixture.nativeInfo() as NSDictionary)
    }

    func testNativeInfoEncodesMissingNameAsNull() throws {
        let object = try jsonObject(NativeInfo(name: nil, presentation: .compact))
        XCTAssertEqual(object.allKeys.count, 4)
        XCTAssertTrue(object["name"] is NSNull, "name must be JSON null, not omitted")
        XCTAssertEqual(object["platform"] as? String, "imessage")
        XCTAssertEqual(object["version"] as? Int, 1)
        XCTAssertEqual(object["presentation"] as? String, "compact")
    }

    func testNativeToWebEncodesLikeTheFixture() throws {
        let payloads: [NativeToWeb] = [
            .presentation(.expanded),
            .bubbleResult(dedupeKey: "gameStarted:ABC123:1", ok: true, sent: true, error: nil),
            .bubbleResult(dedupeKey: "invite:ABC123:1", ok: false, sent: false, error: "No active conversation"),
        ]
        let fixture = try Fixture.nativeToWeb()
        XCTAssertEqual(fixture.count, payloads.count, "fixture nativeToWeb count changed: update this test")
        for (payload, expected) in zip(payloads, fixture) {
            XCTAssertEqual(try jsonObject(payload), expected as NSDictionary)
        }
    }

    func testBubbleResultEncodesNullError() throws {
        let object = try jsonObject(NativeToWeb.bubbleResult(dedupeKey: "k", ok: true, sent: false, error: nil))
        XCTAssertTrue(object["error"] is NSNull, "error must be JSON null, not omitted")
        XCTAssertEqual(object.allKeys.count, 5)
    }

    // MARK: - Script safety

    private func assertScriptIsInert(_ script: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(script.contains("</"), "script contains </", file: file, line: line)
        XCTAssertFalse(script.contains("<"), "script contains a raw <", file: file, line: line)
        XCTAssertFalse(script.contains(">"), "script contains a raw >", file: file, line: line)
        XCTAssertFalse(script.unicodeScalars.contains { $0.value == 0x2028 || $0.value == 0x2029 },
                       "script contains a raw U+2028/U+2029", file: file, line: line)
        XCTAssertFalse(script.contains("\n"), "script contains a raw newline", file: file, line: line)
    }

    func testInjectionScriptShapeAndEscaping() throws {
        let script = NativeBridge.injectionScript(info: NativeInfo(name: nastyText, presentation: .compact))
        XCTAssertTrue(script.hasPrefix("window.__FLOCK_NATIVE__ = {"))
        assertScriptIsInert(script)
        XCTAssertTrue(script.contains("\\u003c"))
        XCTAssertTrue(script.contains("\\u2028"))
        XCTAssertTrue(script.contains("\\u2029"))
        let literal = try between(script, prefix: NativeBridge.injectionPrefix, suffix: NativeBridge.injectionSuffix)
        let object = try parseJSONObject(literal)
        XCTAssertEqual(object["name"] as? String, nastyText)
        XCTAssertEqual(object["platform"] as? String, "imessage")
        XCTAssertEqual(object["presentation"] as? String, "compact")
    }

    func testInjectionScriptForTheFixtureInfo() throws {
        let script = NativeBridge.injectionScript(info: NativeInfo(name: "Sohum", presentation: .expanded))
        let literal = try between(script, prefix: NativeBridge.injectionPrefix, suffix: NativeBridge.injectionSuffix)
        XCTAssertEqual(try parseJSONObject(literal), try Fixture.nativeInfo() as NSDictionary)
    }

    func testDispatchScriptShapeAndEscaping() throws {
        let payload = NativeToWeb.bubbleResult(dedupeKey: "invite:ABC123:1", ok: false, sent: false, error: nastyText)
        let script = NativeBridge.dispatchScript(payload)
        XCTAssertTrue(script.hasPrefix("window.dispatchEvent(new CustomEvent('flock:native', { detail: {"))
        assertScriptIsInert(script)
        let literal = try between(script, prefix: NativeBridge.dispatchPrefix, suffix: NativeBridge.dispatchSuffix)
        let object = try parseJSONObject(literal)
        XCTAssertEqual(object["error"] as? String, nastyText)
        XCTAssertEqual(object["type"] as? String, "bubbleResult")
        XCTAssertEqual(object["dedupeKey"] as? String, "invite:ABC123:1")
    }

    func testDispatchScriptsForTheFixturePayloads() throws {
        let payloads: [NativeToWeb] = [
            .presentation(.expanded),
            .bubbleResult(dedupeKey: "gameStarted:ABC123:1", ok: true, sent: true, error: nil),
            .bubbleResult(dedupeKey: "invite:ABC123:1", ok: false, sent: false, error: "No active conversation"),
        ]
        let fixture = try Fixture.nativeToWeb()
        XCTAssertEqual(fixture.count, payloads.count)
        for (payload, expected) in zip(payloads, fixture) {
            let script = NativeBridge.dispatchScript(payload)
            let literal = try between(script, prefix: NativeBridge.dispatchPrefix, suffix: NativeBridge.dispatchSuffix)
            XCTAssertEqual(try parseJSONObject(literal), expected as NSDictionary)
        }
    }

    func testEscapeForJavaScriptLeavesOrdinaryTextAlone() {
        XCTAssertEqual(NativeBridge.escapeForJavaScript("{\"a\":\"Bob 🐔 10/20\"}"), "{\"a\":\"Bob 🐔 10/20\"}")
        XCTAssertEqual(NativeBridge.escapeForJavaScript("<>&\u{2028}\u{2029}"), "\\u003c\\u003e\\u0026\\u2028\\u2029")
    }

    // MARK: - Running the scripts in a real JavaScript engine

    #if canImport(JavaScriptCore)
    private func makeContext() throws -> JSContext {
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("""
        var window = this;
        var received = [];
        function CustomEvent(type, init) { this.type = type; this.detail = init ? init.detail : null; }
        window.dispatchEvent = function (event) { received.push(event); return true; };
        """)
        XCTAssertNil(context.exception, "setup failed: \(String(describing: context.exception))")
        return context
    }

    func testInjectionScriptRunsInJavaScriptCore() throws {
        let context = try makeContext()
        context.evaluateScript(NativeBridge.injectionScript(info: NativeInfo(name: nastyText, presentation: .expanded)))
        XCTAssertNil(context.exception, "script threw: \(String(describing: context.exception))")
        XCTAssertEqual(context.evaluateScript("window.__FLOCK_NATIVE__.name")?.toString(), nastyText)
        XCTAssertEqual(context.evaluateScript("window.__FLOCK_NATIVE__.platform")?.toString(), "imessage")
        XCTAssertEqual(context.evaluateScript("window.__FLOCK_NATIVE__.presentation")?.toString(), "expanded")
        XCTAssertEqual(context.evaluateScript("String(window.__FLOCK_NATIVE__.version)")?.toString(), "1")
        // Nothing else ran (the </script> in the name did not end anything).
        XCTAssertEqual(context.evaluateScript("String(received.length)")?.toString(), "0")
    }

    func testInjectionScriptWithoutNameDefinesNull() throws {
        let context = try makeContext()
        context.evaluateScript(NativeBridge.injectionScript(info: NativeInfo(name: nil, presentation: .compact)))
        XCTAssertNil(context.exception)
        XCTAssertEqual(context.evaluateScript("String(window.__FLOCK_NATIVE__.name === null)")?.toString(), "true")
    }

    func testDispatchScriptRunsInJavaScriptCore() throws {
        let context = try makeContext()
        context.evaluateScript(NativeBridge.dispatchScript(.presentation(.compact)))
        context.evaluateScript(NativeBridge.dispatchScript(.bubbleResult(dedupeKey: "k", ok: false, sent: false, error: nastyText)))
        XCTAssertNil(context.exception, "script threw: \(String(describing: context.exception))")
        XCTAssertEqual(context.evaluateScript("String(received.length)")?.toString(), "2")
        XCTAssertEqual(context.evaluateScript("received[0].type")?.toString(), "flock:native")
        XCTAssertEqual(context.evaluateScript("received[0].detail.type + ':' + received[0].detail.style")?.toString(), "presentation:compact")
        XCTAssertEqual(context.evaluateScript("received[1].detail.error")?.toString(), nastyText)
        XCTAssertEqual(context.evaluateScript("String(received[1].detail.ok) + String(received[1].detail.sent)")?.toString(), "falsefalse")
    }
    #endif
}
