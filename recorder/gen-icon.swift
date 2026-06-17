// Генератор иконки приложения «Рой/соты»: янтарный чип + белая сота с роем.
// Запуск: swift gen-icon.swift   → пишет AppIcon.iconset, далее iconutil -c icns.
import AppKit

let amber = NSColor(srgbRed: 0xD9 / 255.0, green: 0x8A / 255.0, blue: 0x2B / 255.0, alpha: 1)

func hexPath(center c: NSPoint, r: CGFloat) -> NSBezierPath {
    let h = r * 0.8660254
    let pts = [
        NSPoint(x: c.x + r, y: c.y), NSPoint(x: c.x + r / 2, y: c.y + h),
        NSPoint(x: c.x - r / 2, y: c.y + h), NSPoint(x: c.x - r, y: c.y),
        NSPoint(x: c.x - r / 2, y: c.y - h), NSPoint(x: c.x + r / 2, y: c.y - h),
    ]
    let p = NSBezierPath()
    p.move(to: pts[0]); for i in 1 ..< 6 { p.line(to: pts[i]) }; p.close()
    return p
}

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: s, height: s), xRadius: s * 0.22, yRadius: s * 0.22).addClip()
    amber.setFill(); NSRect(x: 0, y: 0, width: s, height: s).fill()
    let c = NSPoint(x: s / 2, y: s / 2)
    NSColor.white.setStroke(); NSColor.white.setFill()
    let hex = hexPath(center: c, r: s * 0.40); hex.lineWidth = s * 0.085; hex.lineJoinStyle = .round; hex.stroke()
    let dr = s * 0.072
    for o in [NSPoint(x: 0, y: s * 0.13), NSPoint(x: -s * 0.11, y: -s * 0.07), NSPoint(x: s * 0.11, y: -s * 0.07)] {
        NSBezierPath(ovalIn: NSRect(x: c.x + o.x - dr, y: c.y + o.y - dr, width: dr * 2, height: dr * 2)).fill()
    }
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
