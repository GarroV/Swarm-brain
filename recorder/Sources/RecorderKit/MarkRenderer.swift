import AppKit

// Отрисовка марки-шмеля: глиф на прозрачном фоне (значок меню-бара) и чип-марка
// (графитовая подложка + шмель) для капсулы, панели заметок и .icns.
//
// Живёт в RecorderKit, а не рядом с UI, по одной причине: это чистая функция
// «размер + цвет + картинка → пиксели», и она обязана быть под тестом. Марка,
// съехавшая в сплошной квадрат, выглядит как «приложение сломалось», а поймать
// такое глазами можно только собрав .app и посмотрев на экран.
//
// Рисунок инъектируется параметром (`glyph`), а не читается из бандла: приложение
// берёт его из `Bundle.main`, тест — из файла репозитория, и путь один и тот же.
public enum MarkRenderer {
    public static let amber = NSColor(srgbRed: 0xD9 / 255.0, green: 0x8A / 255.0, blue: 0x2B / 255.0, alpha: 1)
    // Графит подложки: тёмный, но не чёрный — белый контур на нём мягче, чем на чистом чёрном.
    public static let graphite = NSColor(srgbRed: 0x24 / 255.0, green: 0x1F / 255.0, blue: 0x18 / 255.0, alpha: 1)

    // Доля площади чипа под скругление углов.
    public static let cornerFraction: CGFloat = 0.22

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
    private static func drawGlyph(_ glyph: NSImage?, in rect: NSRect, color: NSColor) {
        guard let glyph else {
            drawFallback(in: rect.width, color: color)
            return
        }
        glyph.draw(in: rect)
        color.setFill()
        rect.fill(using: .sourceAtop)   // перекраска по альфе рисунка
    }

    // Только шмель, перекрашенный, на прозрачном фоне. Для значка меню-бара.
    public static func glyphImage(_ glyph: NSImage?, size s: CGFloat, color: NSColor) -> NSImage {
        let img = NSImage(size: NSSize(width: s, height: s))
        img.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        drawGlyph(glyph, in: NSRect(x: 0, y: 0, width: s, height: s), color: color)
        img.unlockFocus()
        return img
    }

    // Полная марка: скруглённый чип подложки + шмель поверх.
    public static func chipImage(_ glyph: NSImage?, size s: CGFloat,
                                plate: NSColor = graphite, glyphColor: NSColor = .white) -> NSImage {
        let img = NSImage(size: NSSize(width: s, height: s))
        img.lockFocus()
        drawChip(glyph, size: s, plate: plate, glyphColor: glyphColor)
        img.unlockFocus()
        return img
    }

    // Та же марка прямо в текущий контекст (нужно тем, кто рисует .icns покадрово).
    public static func drawChip(_ glyph: NSImage?, size s: CGFloat,
                               plate: NSColor = graphite, glyphColor: NSColor = .white) {
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current?.imageInterpolation = .high
        let rect = NSRect(x: 0, y: 0, width: s, height: s)
        NSBezierPath(roundedRect: rect, xRadius: s * cornerFraction, yRadius: s * cornerFraction).addClip()
        plate.setFill()
        rect.fill()
        // Глиф кладём УЖЕ перекрашенной картинкой, а не рисуем перекраску здесь.
        // Причина — баг #197: `fill(using: .sourceAtop)` красит всё, где в контексте есть
        // альфа, а подложка непрозрачна на всей площади → белым заливался весь чип и шмель
        // исчезал. Перекраска обязана жить в пустом контексте, где альфа есть только у шмеля.
        glyphImage(glyph, size: s, color: glyphColor).draw(in: rect)
        NSGraphicsContext.restoreGraphicsState()
    }
}
