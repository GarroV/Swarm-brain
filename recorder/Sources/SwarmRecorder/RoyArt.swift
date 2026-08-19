import AppKit

// Отрисовка бренд-марки «Рой/соты»: сота (hexagon) + рой из трёх точек.
// Используется в меню-баре (template/красный) и в плавающем виджете (янтарный чип).
enum RoyArt {
    static let amber = NSColor(srgbRed: 0xD9 / 255.0, green: 0x8A / 255.0, blue: 0x2B / 255.0, alpha: 1)

    private static func hexPath(center c: NSPoint, r: CGFloat) -> NSBezierPath {
        let h = r * 0.8660254 // sin(60°)
        let pts = [
            NSPoint(x: c.x + r, y: c.y),
            NSPoint(x: c.x + r / 2, y: c.y + h),
            NSPoint(x: c.x - r / 2, y: c.y + h),
            NSPoint(x: c.x - r, y: c.y),
            NSPoint(x: c.x - r / 2, y: c.y - h),
            NSPoint(x: c.x + r / 2, y: c.y - h)
        ]
        let p = NSBezierPath()
        p.move(to: pts[0])
        for i in 1 ..< pts.count { p.line(to: pts[i]) }
        p.close()
        return p
    }

    private static func drawGlyph(in size: CGFloat, color: NSColor) {
        let c = NSPoint(x: size / 2, y: size / 2)
        color.setStroke()
        color.setFill()
        let hex = hexPath(center: c, r: size * 0.40)
        hex.lineWidth = size * 0.085
        hex.lineJoinStyle = .round
        hex.stroke()
        let dr = size * 0.072
        let offsets = [
            NSPoint(x: 0, y: size * 0.13),
            NSPoint(x: -size * 0.11, y: -size * 0.07),
            NSPoint(x: size * 0.11, y: -size * 0.07)
        ]
        for o in offsets {
            NSBezierPath(ovalIn: NSRect(x: c.x + o.x - dr, y: c.y + o.y - dr, width: dr * 2, height: dr * 2)).fill()
        }
    }

    // Иконка для меню-бара. Покой — template (адаптируется к теме), запись — красная.
    static func menuBarImage(recording: Bool) -> NSImage {
        let s: CGFloat = 18
        let img = NSImage(size: NSSize(width: s, height: s))
        img.lockFocus()
        drawGlyph(in: s, color: recording ? .systemRed : .black)
        img.unlockFocus()
        img.isTemplate = !recording
        return img
    }

    // Полная марка: янтарный скруглённый чип + белая сота с роем. Для виджета и .icns.
    static func markImage(size s: CGFloat) -> NSImage {
        let img = NSImage(size: NSSize(width: s, height: s))
        img.lockFocus()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: s, height: s), xRadius: s * 0.22, yRadius: s * 0.22).addClip()
        amber.setFill()
        NSRect(x: 0, y: 0, width: s, height: s).fill()
        drawGlyph(in: s, color: .white)
        img.unlockFocus()
        return img
    }
}
