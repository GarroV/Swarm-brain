// Генератор PNG-иконок для PWA/iOS (apple-touch-icon + manifest) — тот же знак, что src/app/icon.svg:
// рубленая S в глитч-обработке семьи decimus/meridius (решение владельца 14.10.2026,
// docs/decisions/2026-10-14-logo-s.md). Full-bleed тёмно-синий квадрат (iOS/Android маскируют сами),
// знак — в безопасной зоне 80% (для maskable). Запуск из miniapp/: swift gen-web-icons.swift
import AppKit

func rgb(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

let bg = rgb(0x0E1116), ink = rgb(0xEAF6FA), cyan = rgb(0x00C8FF), red = rgb(0xFF2D55)

// Контуры в сетке 64×64 (ось y вниз, как в SVG) — копия путей из src/app/icon.svg.
let glyph: [[CGPoint]] = [
    [(20, 12), (52, 12), (52, 25), (44, 25), (44, 20), (23, 20), (23, 28), (44, 28), (52, 36), (52, 44),
     (44, 52), (12, 52), (12, 39), (20, 39), (20, 44), (41, 44), (41, 36), (20, 36), (12, 28), (12, 20)],
    [(5, 11), (14, 11), (14, 15), (5, 15)],
    [(50, 49), (59, 49), (59, 53), (50, 53)],
].map { $0.map { CGPoint(x: $0.0, y: $0.1) } }

// Полосы глитча: верх и низ на месте, средняя (y 27…37) сдвинута на 4.
let bands: [(y0: CGFloat, y1: CGFloat, dx: CGFloat)] = [(0, 27, 0), (27, 37, 4), (37, 64, 0)]

func glyphPath(dx: CGFloat) -> NSBezierPath {
    let p = NSBezierPath()
    for poly in glyph {
        p.move(to: NSPoint(x: poly[0].x + dx, y: poly[0].y))
        for pt in poly.dropFirst() { p.line(to: NSPoint(x: pt.x + dx, y: pt.y)) }
        p.close()
    }
    return p
}

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    bg.setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    // Сетка 64 → безопасная зона 80% по центру, ось y переворачиваем под SVG.
    let k = s * 0.8 / 64
    let t = NSAffineTransform()
    t.translateX(by: s * 0.1, yBy: s * 0.9)
    t.scaleX(by: k, yBy: -k)
    t.concat()
    cyan.setFill(); glyphPath(dx: -2.5).fill()
    red.setFill(); glyphPath(dx: 2.5).fill()
    ink.setFill()
    for b in bands {
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(rect: NSRect(x: -10, y: b.y0, width: 84, height: b.y1 - b.y0)).addClip()
        glyphPath(dx: b.dx).fill()
        NSGraphicsContext.restoreGraphicsState()
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

try! render(180).write(to: URL(fileURLWithPath: "src/app/apple-icon.png"))
try! render(192).write(to: URL(fileURLWithPath: "public/icon-192.png"))
try! render(512).write(to: URL(fileURLWithPath: "public/icon-512.png"))
print("web icons written: apple-icon(180), icon-192, icon-512")
