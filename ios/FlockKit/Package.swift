// swift-tools-version:5.9
// Pure, UI-free logic shared by the Flock Poker iMessage extension: the web <-> native bridge
// contract, room links, bubble de-duplication and the recent-tables list.
// `swift test --package-path ios/FlockKit` runs the tests on macOS.
import PackageDescription

let package = Package(
    name: "FlockKit",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "FlockKit", targets: ["FlockKit"]),
    ],
    targets: [
        .target(
            name: "FlockKit",
            path: "Sources/FlockKit"
        ),
        .testTarget(
            name: "FlockKitTests",
            dependencies: ["FlockKit"],
            path: "Tests/FlockKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
