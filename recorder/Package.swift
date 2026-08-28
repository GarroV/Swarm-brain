// swift-tools-version:5.9
// SwiftPM-обёртка для проверки компиляции (`swift build`). Для распространяемого .app
// проще создать App-таргет в Xcode (см. README) — Info.plist/LSUIElement/подпись там.
import PackageDescription

let package = Package(
    name: "SwarmRecorder",
    platforms: [.macOS(.v13)],
    targets: [
        // Чистая логика без AppKit — то, что можно проверить тестами (`swift test`).
        // Всё, что зависит от NSStatusItem/NSPanel, остаётся в SwarmRecorder.
        .target(
            name: "RecorderKit",
            path: "Sources/RecorderKit"
        ),
        .executableTarget(
            name: "SwarmRecorder",
            dependencies: ["RecorderKit"],
            path: "Sources/SwarmRecorder"
        ),
        .testTarget(
            name: "RecorderKitTests",
            dependencies: ["RecorderKit"],
            path: "Tests/RecorderKitTests"
        )
    ]
)
