import AppKit

// Отрисовка марки приложения — схематичная «жопка шмеля» (bumblebee): каплевидное брюшко
// с прорезанными поперечными полосами и жалом внизу.
// Используется в меню-баре (template/красный), в плавающем виджете и как иконка приложения.
//
// Геометрия живёт ТОЛЬКО здесь. Генератор .icns (recorder/gen-icon.swift) компилируется вместе
// с этим файлом и зовёт те же функции — иначе иконка приложения и меню-бара разъезжаются молча.
enum RoyArt {
    static let amber = NSColor(srgbRed: 0xD9 / 255.0, green: 0x8A / 255.0, blue: 0x2B / 255.0, alpha: 1)
    // Графит подложки: тёмный, но не чёрный — на нём янтарь читается как шмелиная полоса.
    static let graphite = NSColor(srgbRed: 0x24 / 255.0, green: 0x1F / 255.0, blue: 0x18 / 255.0, alpha: 1)

    // Силуэт брюшка: круглая макушка, пузатые бока и мягкий кончик снизу (жало намечено формой,
    // а не приставленным треугольником — стык из него читается «шариком на ниточке»).
    // Ширина держится почти до низа: это и отличает жопку шмеля от капли.
    static func bodyPath(in size: CGFloat) -> NSBezierPath {
        let w = size * 0.68          // ширина в самом широком месте
        let cx = size / 2
        let top = size * 0.92        // макушка
        let waist = size * 0.62      // самое широкое место
        let tipY = size * 0.10       // кончик
        let p = NSBezierPath()
        p.move(to: NSPoint(x: cx, y: top))
        // Правый бок: почти полукруг сверху…
        p.curve(to: NSPoint(x: cx + w / 2, y: waist),
                controlPoint1: NSPoint(x: cx + w * 0.30, y: top),
                controlPoint2: NSPoint(x: cx + w / 2, y: top - size * 0.13))
        // …и длинный пузатый спуск к мягкому кончику.
        p.curve(to: NSPoint(x: cx, y: tipY),
                controlPoint1: NSPoint(x: cx + w / 2, y: size * 0.34),
                controlPoint2: NSPoint(x: cx + w * 0.26, y: size * 0.14))
        p.curve(to: NSPoint(x: cx - w / 2, y: waist),
                controlPoint1: NSPoint(x: cx - w * 0.26, y: size * 0.14),
                controlPoint2: NSPoint(x: cx - w / 2, y: size * 0.34))
        p.curve(to: NSPoint(x: cx, y: top),
                controlPoint1: NSPoint(x: cx - w / 2, y: top - size * 0.13),
                controlPoint2: NSPoint(x: cx - w * 0.30, y: top))
        p.close()
        return p
    }

    // Две поперечные прорези — они и делают брюшко полосатым. Ширину берём с запасом:
    // лишнее срежет клип по силуэту, а на мелких размерах полоса не должна «не доставать» до края.
    private static func stripeRects(in size: CGFloat) -> [NSRect] {
        let h = size * 0.10          // толщина полосы
        return [
            NSRect(x: 0, y: size * 0.520, width: size, height: h),
            NSRect(x: 0, y: size * 0.330, width: size, height: h)
        ]
    }

    // Брюшко одним цветом с ПРОЗРАЧНЫМИ полосами — для template-иконки меню-бара:
    // система перекрашивает силуэт под тему, прорези остаются дырками и читаются в 18 px.
    private static func drawGlyph(in size: CGFloat, color: NSColor) {
        color.setFill()
        bodyPath(in: size).fill()
        NSGraphicsContext.current?.compositingOperation = .destinationOut
        NSColor.black.setFill()
        for r in stripeRects(in: size) { r.fill() }
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }

    // Брюшко на подложке: полосы залиты цветом подложки (а не прозрачностью) — так чип
    // остаётся плотным на любом фоне виджета.
    static func drawBody(in size: CGFloat, body: NSColor, stripe: NSColor) {
        body.setFill()
        let path = bodyPath(in: size)
        path.fill()
        NSGraphicsContext.saveGraphicsState()
        path.addClip()
        stripe.setFill()
        for r in stripeRects(in: size) { r.fill() }
        NSGraphicsContext.restoreGraphicsState()
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

    // Полная марка: графитовый скруглённый чип + янтарная жопка шмеля. Для виджета и .icns.
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
        drawBody(in: s, body: amber, stripe: graphite)
        NSGraphicsContext.restoreGraphicsState()
    }
}
