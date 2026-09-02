import XCTest
import AppKit
@testable import RecorderKit

// Марка-шмель: проверяем ПИКСЕЛИ, а не «собралось». Регресс, из-за которого тест появился
// (issue #197): чип рисовался сплошным белым квадратом — подложка заливалась на всю площадь,
// а перекраска глифа шла `fill(using: .sourceAtop)`, то есть красила всё, где в контексте
// есть альфа. Глазами это ловится только на собранном .app, поэтому проверка здесь.
final class MarkRendererTests: XCTestCase {
    /// Реальный рисунок из репозитория — тот же файл, что build-app.sh кладёт в бандл.
    private func beeMark() throws -> NSImage {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // RecorderKitTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // recorder
            .appendingPathComponent("Resources/BeeMark.png")
        let img = try XCTUnwrap(NSImage(contentsOf: url), "BeeMark.png не найден: \(url.path)")
        return img
    }

    /// Доля пикселей, близких к заданному цвету (по каналам RGB, допуск 0.06).
    private func share(of image: NSImage, near target: NSColor) throws -> Double {
        let rep = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
        let want = try XCTUnwrap(target.usingColorSpace(.deviceRGB))
        var hit = 0, total = 0
        for y in stride(from: 0, to: rep.pixelsHigh, by: 2) {
            for x in stride(from: 0, to: rep.pixelsWide, by: 2) {
                guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                total += 1
                guard c.alphaComponent > 0.5 else { continue }
                if abs(c.redComponent - want.redComponent) < 0.06,
                   abs(c.greenComponent - want.greenComponent) < 0.06,
                   abs(c.blueComponent - want.blueComponent) < 0.06 { hit += 1 }
            }
        }
        return total == 0 ? 0 : Double(hit) / Double(total)
    }

    func testChipKeepsPlateVisibleUnderTheGlyph() throws {
        let chip = MarkRenderer.chipImage(try beeMark(), size: 96)

        // Шмель занимает меньше пятой части площади — значит подложка обязана занимать
        // большую часть чипа. Сплошная заливка цветом глифа = баг #197.
        let plate = try share(of: chip, near: MarkRenderer.graphite)
        XCTAssertGreaterThan(plate, 0.5, "подложка чипа затёрта: графита \(Int(plate * 100))% площади")
    }

    func testChipDrawsTheGlyph() throws {
        let chip = MarkRenderer.chipImage(try beeMark(), size: 96)

        let glyph = try share(of: chip, near: .white)
        XCTAssertGreaterThan(glyph, 0.05, "шмеля на чипе не видно: белого \(Int(glyph * 100))%")
        XCTAssertLessThan(glyph, 0.5, "белого больше половины чипа — похоже на сплошную заливку")
    }

    func testGlyphImageIsTransparentOutsideTheBee() throws {
        let img = MarkRenderer.glyphImage(try beeMark(), size: 96, color: .white)

        // Значок меню-бара — глиф без подложки: цветным должен быть только шмель.
        let white = try share(of: img, near: .white)
        XCTAssertGreaterThan(white, 0.05, "глиф пустой")
        XCTAssertLessThan(white, 0.5, "глиф залил весь квадрат")
    }
}
