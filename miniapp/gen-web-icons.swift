// Генератор PNG-иконок «Рой/соты» для PWA/iOS (apple-touch-icon + manifest).
// Full-bleed янтарный квадрат + белая сота с роем; глиф в safe-zone (для maskable/iOS-маски).
// Запуск из miniapp/: swift gen-web-icons.swift
import AppKit

let amber = NSColor(srgbRed: 0xD9 / 255.0, green: 0x8A / 255.0, blue: 0x2B / 255.0, alpha: 1)

func hexPath(_ c: NSPoint, _ r: CGFloat) -> NSBezierPath {
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
    amber.setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill() // full-bleed (iOS/Android маскируют сами)
    let c = NSPoint(x: s / 2, y: s / 2)
    NSColor.white.setStroke(); NSColor.white.setFill()
    let hex = hexPath(c, s * 0.28); hex.lineWidth = s * 0.058; hex.lineJoinStyle = .round; hex.stroke()
    let dr = s * 0.05
    for o in [NSPoint(x: 0, y: s * 0.095), NSPoint(x: -s * 0.08, y: -s * 0.05), NSPoint(x: s * 0.08, y: -s * 0.05)] {
        NSBezierPath(ovalIn: NSRect(x: c.x + o.x - dr, y: c.y + o.y - dr, width: dr * 2, height: dr * 2)).fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

try! render(180).write(to: URL(fileURLWithPath: "src/app/apple-icon.png"))
try! render(192).write(to: URL(fileURLWithPath: "public/icon-192.png"))
try! render(512).write(to: URL(fileURLWithPath: "public/icon-512.png"))
print("web icons written: apple-icon(180), icon-192, icon-512")
