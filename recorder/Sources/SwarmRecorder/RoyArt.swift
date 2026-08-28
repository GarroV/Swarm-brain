import AppKit

// Марка приложения — рисунок шмеля из `Resources/BeeMark.png` (белый контур на прозрачном фоне).
// Раньше фигура рисовалась кодом; теперь источник один — файл, чтобы иконка приложения,
// меню-бара и виджета не могли разъехаться. Как файл получен из исходника — Resources/README.md.
enum RoyArt {
    static let amber = NSColor(srgbRed: 0xD9 / 255.0, green: 0x8A / 255.0, blue: 0x2B / 255.0, alpha: 1)
    // Графит подложки: тёмный, но не чёрный — белый контур на нём мягче, чем на чистом чёрном.
    static let graphite = NSColor(srgbRed: 0x24 / 255.0, green: 0x1F / 255.0, blue: 0x18 / 255.0, alpha: 1)

    private static let mark: NSImage? = {
        guard let url = Bundle.main.url(forResource: "BeeMark", withExtension: "png"),
              let img = NSImage(contentsOf: url) else {
            NSLog("SwarmRecorder: BeeMark.png не найден в бандле — значок будет запасной")
            return nil
        }
        return img
    }()

    // Запасная фигура на случай, если ресурс не доехал в бандл: значок в меню-баре обязан быть
    // хоть каким-то — исчезнувший значок означает «приложение пропало» для пользователя.
    private static func drawFallback(in size: CGFloat, color: NSColor) {
        color.setStroke()
        let r = size * 0.36, c = NSPoint(x: size / 2, y: size / 2)
        let body = NSBezierPath(ovalIn: NSRect(x: c.x - r * 0.8, y: c.y - r, width: r * 1.6, height: r * 2))
        body.lineWidth = max(size * 0.06, 1)
        body.stroke()
        NSGraphicsContext.saveGraphicsState()
        body.addClip()
        for dy in [-r * 0.35, r * 0.15] {
            let l = NSBezierPath()
            l.move(to: NSPoint(x: 0, y: c.y + dy)); l.line(to: NSPoint(x: size, y: c.y + dy))
            l.lineWidth = max(size * 0.06, 1); l.stroke()
        }
        NSGraphicsContext.restoreGraphicsState()
    }

    // Рисунок в текущий контекст, перекрашенный в нужный цвет.
    private static func drawMarkGlyph(in rect: NSRect, color: NSColor) {
        guard let mark else {
            drawFallback(in: rect.width, color: color)
            return
        }
        mark.draw(in: rect)
        color.setFill()
        rect.fill(using: .sourceAtop)   // перекраска по альфе рисунка
    }

    // Иконка для меню-бара. Покой — template (macOS красит сама под тему), запись — красная.
    static func menuBarImage(recording: Bool) -> NSImage {
        let s: CGFloat = 18
        let img = NSImage(size: NSSize(width: s, height: s))
        img.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        drawMarkGlyph(in: NSRect(x: 0, y: 0, width: s, height: s), color: recording ? .systemRed : .black)
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

    // Та же марка прямо в текущий контекст.
    static func drawMark(in s: CGFloat) {
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current?.imageInterpolation = .high
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: s, height: s), xRadius: s * 0.22, yRadius: s * 0.22).addClip()
        graphite.setFill()
        NSRect(x: 0, y: 0, width: s, height: s).fill()
        drawMarkGlyph(in: NSRect(x: 0, y: 0, width: s, height: s), color: .white)
        NSGraphicsContext.restoreGraphicsState()
    }
}
