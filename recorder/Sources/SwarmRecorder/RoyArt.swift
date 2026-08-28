import AppKit

// Отрисовка марки приложения — схематичный шмель (bumblebee): линейный рисунок из тела с
// полосами, двух крыльев и усиков. Используется в меню-баре (template/красный), в плавающем
// виджете и как иконка приложения.
//
// Геометрия живёт ТОЛЬКО здесь. Генератор .icns (recorder/gen-icon.swift) компилируется вместе
// с этим файлом и зовёт те же функции — иначе иконка приложения и меню-бара разъедутся молча.
enum RoyArt {
    static let amber = NSColor(srgbRed: 0xD9 / 255.0, green: 0x8A / 255.0, blue: 0x2B / 255.0, alpha: 1)
    // Графит подложки: тёмный, но не чёрный — линии на нём мягче, чем на чистом чёрном.
    static let graphite = NSColor(srgbRed: 0x24 / 255.0, green: 0x1F / 255.0, blue: 0x18 / 255.0, alpha: 1)

    // ── Геометрия. Всё считается от квадрата size×size, рисунок вписан с полями ────────────

    // Тело: круглая макушка, пузатые бока, короткое жало снизу.
    static func bodyPath(in size: CGFloat) -> NSBezierPath {
        let w = size * 0.50          // ширина тела
        let cx = size / 2
        let top = size * 0.80        // макушка
        let waist = size * 0.55      // самое широкое место
        let tipY = size * 0.13       // кончик жала
        let p = NSBezierPath()
        p.move(to: NSPoint(x: cx, y: top))
        p.curve(to: NSPoint(x: cx + w / 2, y: waist),
                controlPoint1: NSPoint(x: cx + w * 0.34, y: top),
                controlPoint2: NSPoint(x: cx + w / 2, y: top - size * 0.10))
        p.curve(to: NSPoint(x: cx, y: tipY),
                controlPoint1: NSPoint(x: cx + w / 2, y: size * 0.30),
                controlPoint2: NSPoint(x: cx + w * 0.30, y: size * 0.17))
        p.curve(to: NSPoint(x: cx - w / 2, y: waist),
                controlPoint1: NSPoint(x: cx - w * 0.30, y: size * 0.17),
                controlPoint2: NSPoint(x: cx - w / 2, y: size * 0.30))
        p.curve(to: NSPoint(x: cx, y: top),
                controlPoint1: NSPoint(x: cx - w / 2, y: top - size * 0.10),
                controlPoint2: NSPoint(x: cx - w * 0.34, y: top))
        p.close()
        return p
    }

    // Поперечные полосы тела: линии, обрезанные силуэтом тела.
    private static func stripeYs(in size: CGFloat) -> [CGFloat] {
        [size * 0.560, size * 0.455, size * 0.350, size * 0.250]
    }

    // Крыло: вытянутый овал, наклонённый от плеча вниз-вбок. mirrored — левое.
    private static func wingPath(in size: CGFloat, mirrored: Bool) -> NSBezierPath {
        let w = size * 0.155, h = size * 0.44
        let oval = NSBezierPath(ovalIn: NSRect(x: -w / 2, y: -h / 2, width: w, height: h))
        let t = NSAffineTransform()
        t.translateX(by: size / 2 + (mirrored ? -1 : 1) * size * 0.250, yBy: size * 0.480)
        t.rotate(byDegrees: (mirrored ? 1 : -1) * 20)
        oval.transform(using: t as AffineTransform)
        return oval
    }

    // Усик: дуга от макушки вверх-вбок.
    private static func antennaPath(in size: CGFloat, mirrored: Bool) -> NSBezierPath {
        let s: CGFloat = mirrored ? -1 : 1
        let cx = size / 2
        let p = NSBezierPath()
        p.move(to: NSPoint(x: cx + s * size * 0.055, y: size * 0.795))
        p.curve(to: NSPoint(x: cx + s * size * 0.250, y: size * 0.960),
                controlPoint1: NSPoint(x: cx + s * size * 0.040, y: size * 0.900),
                controlPoint2: NSPoint(x: cx + s * size * 0.140, y: size * 0.955))
        return p
    }

    // Весь рисунок одним цветом линий. Крылья рисуются позади тела, тело залито фоном, чтобы
    // линии крыльев не просвечивали сквозь него (в template-иконке фона нет — там тело
    // «вырезает» крылья прозрачностью, рисунок остаётся читаемым).
    // `scale` < 1 вписывает рисунок с полями — нужно на чипе, где усики иначе упираются в край.
    // В меню-баре полей нет (фона нет), поэтому там масштаб 1.
    static func drawGlyph(in size: CGFloat, color: NSColor, fill: NSColor?, scale: CGFloat = 1) {
        if scale != 1 {
            NSGraphicsContext.saveGraphicsState()
            let t = NSAffineTransform()
            t.translateX(by: size / 2, yBy: size / 2)
            t.scale(by: scale)
            t.translateX(by: -size / 2, yBy: -size / 2)
            t.concat()
            defer { NSGraphicsContext.restoreGraphicsState() }
            drawGlyphBody(in: size, color: color, fill: fill)
            return
        }
        drawGlyphBody(in: size, color: color, fill: fill)
    }

    private static func drawGlyphBody(in size: CGFloat, color: NSColor, fill: NSColor?) {
        let lw = max(size * 0.045, 1)
        color.setStroke()
        let body = bodyPath(in: size)

        for mirrored in [false, true] {
            let wing = wingPath(in: size, mirrored: mirrored)
            wing.lineWidth = lw
            wing.stroke()
        }
        // Тело непрозрачно: либо цветом подложки, либо «дыркой» (для template).
        if let fill {
            fill.setFill()
            body.fill()
        } else {
            NSGraphicsContext.current?.compositingOperation = .destinationOut
            NSColor.black.setFill()
            body.fill()
            NSGraphicsContext.current?.compositingOperation = .sourceOver
        }
        body.lineWidth = lw
        body.stroke()

        NSGraphicsContext.saveGraphicsState()
        body.addClip()
        for y in stripeYs(in: size) {
            let line = NSBezierPath()
            line.move(to: NSPoint(x: 0, y: y))
            line.line(to: NSPoint(x: size, y: y))
            line.lineWidth = lw
            line.stroke()
        }
        NSGraphicsContext.restoreGraphicsState()

        for mirrored in [false, true] {
            let a = antennaPath(in: size, mirrored: mirrored)
            a.lineWidth = max(lw * 0.85, 1)
            a.lineCapStyle = .round
            a.stroke()
        }
    }

    // ── Готовые изображения ────────────────────────────────────────────────────────────────

    // Иконка для меню-бара. Покой — template (адаптируется к теме), запись — красная.
    static func menuBarImage(recording: Bool) -> NSImage {
        let s: CGFloat = 18
        let img = NSImage(size: NSSize(width: s, height: s))
        img.lockFocus()
        drawGlyph(in: s, color: recording ? .systemRed : .black, fill: nil)
        img.unlockFocus()
        img.isTemplate = !recording
        return img
    }

    // Полная марка: графитовый скруглённый чип + белый шмель. Для виджета и .icns.
    static func markImage(size s: CGFloat) -> NSImage {
        let img = NSImage(size: NSSize(width: s, height: s))
        img.lockFocus()
        drawMark(in: s)
        img.unlockFocus()
        return img
    }

    // Та же марка прямо в текущий контекст — используется генератором .icns.
    static func drawMark(in s: CGFloat) {
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: s, height: s), xRadius: s * 0.22, yRadius: s * 0.22).addClip()
        graphite.setFill()
        NSRect(x: 0, y: 0, width: s, height: s).fill()
        drawGlyph(in: s, color: .white, fill: graphite, scale: 0.86)
        NSGraphicsContext.restoreGraphicsState()
    }
}
