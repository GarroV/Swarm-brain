// Генератор AppIcon.icns: графитовый чип + марка из Resources/BeeMark.png.
// Запуск (из recorder/):  ./gen-icon.sh
//
// Чип рисует `MarkRenderer` из RecorderKit — тот же код, что даёт марку капсуле, панели
// заметок и значку меню-бара. Свой рисовальщик здесь был вторым путём и разъезжался с
// первым (радиус, цвет подложки, перекраска глифа копировались руками).
//
// Код обёрнут в `@main`, а не написан «сверху вниз»: файл компилируется ВМЕСТЕ с
// MarkRenderer.swift, а top-level инструкции Swift разрешает только в main.swift.
import AppKit

@main
enum GenIcon {
    static let sizes: [(String, Int)] = [
        ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
        ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
        ("icon_512x512", 512), ("icon_512x512@2x", 1024),
    ]

    static func render(_ px: Int, mark: NSImage) -> Data {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        MarkRenderer.drawChip(mark, size: CGFloat(px))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])!
    }

    static func main() throws {
        let markURL = URL(fileURLWithPath: "Resources/BeeMark.png")
        guard let mark = NSImage(contentsOf: markURL) else { fatalError("нет Resources/BeeMark.png") }

        let set = "AppIcon.iconset"
        try? FileManager.default.createDirectory(atPath: set, withIntermediateDirectories: true)
        for (name, px) in sizes {
            try render(px, mark: mark).write(to: URL(fileURLWithPath: "\(set)/\(name).png"))
        }
        print("iconset written: \(sizes.count) sizes")
    }
}
