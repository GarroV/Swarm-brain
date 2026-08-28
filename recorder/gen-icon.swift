// Генератор AppIcon.icns: графитовый чип + марка из Resources/BeeMark.png.
// Запуск (из recorder/):  ./gen-icon.sh
import AppKit

let markURL = URL(fileURLWithPath: "Resources/BeeMark.png")
guard let mark = NSImage(contentsOf: markURL) else { fatalError("нет Resources/BeeMark.png") }
let graphite = NSColor(srgbRed: 0x24 / 255.0, green: 0x1F / 255.0, blue: 0x18 / 255.0, alpha: 1)

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: s, height: s), xRadius: s * 0.22, yRadius: s * 0.22).addClip()
    graphite.setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    mark.draw(in: NSRect(x: 0, y: 0, width: s, height: s))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let set = "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: set, withIntermediateDirectories: true)
let map: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
for (name, px) in map {
    try! render(px).write(to: URL(fileURLWithPath: "\(set)/\(name).png"))
}
print("iconset written: \(map.count) sizes")
