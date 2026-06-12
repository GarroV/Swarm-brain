// swift-tools-version:5.9
// SwiftPM-обёртка для проверки компиляции (`swift build`). Для распространяемого .app
// проще создать App-таргет в Xcode (см. README) — Info.plist/LSUIElement/подпись там.
import PackageDescription

let package = Package(
    name: "SwarmRecorder",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "SwarmRecorder",
            path: "Sources/SwarmRecorder"
        )
    ]
)
