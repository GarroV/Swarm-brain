import AppKit

// Вынимает белый рисунок с чёрного фона в PNG с альфой: яркость пикселя становится
// прозрачностью, цвет — чистый белый. Порог с мягким краем срезает JPEG-звон у контуров.
// Затем обрезает по содержимому и вписывает в квадрат с полями.
let src = CommandLine.arguments[1], dst = CommandLine.arguments[2]
let out = CGFloat(Int(CommandLine.arguments[3]) ?? 1024)
let margin = CGFloat(Double(CommandLine.arguments[4]) ?? 0.06)

guard let img = NSImage(contentsOfFile: src) else { fatalError("не читается \(src)") }
// Исходник перерисовываем в СВОЙ 8-битный RGBA-битмап: у декодера JPEG может оказаться
// 16 бит на канал или планарный формат, и чтение байтов «как есть» тогда даёт мусор
// (первый заход так и вышел — альфа получилась единицей всюду, рисунок стал белым квадратом).
// Размер берём В ПИКСЕЛЯХ у representation: img.size отдаёт точки с поправкой на DPI
// (у этого JPEG — 491 вместо 2048, то есть вчетверо меньше деталей).
let w = img.representations.map { $0.pixelsWide }.max() ?? Int(img.size.width)
let h = img.representations.map { $0.pixelsHigh }.max() ?? Int(img.size.height)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: w * 4, bitsPerPixel: 32)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.black.setFill(); NSRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)).fill()
img.draw(in: NSRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)))
NSGraphicsContext.restoreGraphicsState()

let alpha = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: w * 4, bitsPerPixel: 32)!
var minX = w, minY = h, maxX = -1, maxY = -1
let srcData = rep.bitmapData!
let srcSpp = 4, srcRow = w * 4
var lumMin: CGFloat = 1, lumMax: CGFloat = 0
let dstData = alpha.bitmapData!

for y in 0 ..< h {
    for x in 0 ..< w {
        let s = y * srcRow + x * srcSpp
        let lum = (CGFloat(srcData[s]) + CGFloat(srcData[s + 1]) + CGFloat(srcData[s + 2])) / 3 / 255
        // Мягкий порог: ниже lo — фон, выше hi — рисунок, между — сглаженный край.
        let lo: CGFloat = 0.22, hi: CGFloat = 0.62
        if lum < lumMin { lumMin = lum }; if lum > lumMax { lumMax = lum }
        let a = min(max((lum - lo) / (hi - lo), 0), 1)
        let d = y * w * 4 + x * 4
        // NSBitmapImageRep по умолчанию хранит цвет, УМНОЖЕННЫЙ на альфу. Записать белый как
        // 255 при полупрозрачной альфе — значит получить «пересвет»: картинка схлопывается
        // в сплошной белый квадрат (проверено). Поэтому цвет тоже масштабируем альфой.
        let v = UInt8(a * 255)
        dstData[d] = v; dstData[d + 1] = v; dstData[d + 2] = v
        dstData[d + 3] = v
        if a > 0.35 {
            if x < minX { minX = x }; if x > maxX { maxX = x }
            if y < minY { minY = y }; if y > maxY { maxY = y }
        }
    }
}
guard maxX > minX else { fatalError("рисунок не найден — фон не чёрный?") }
print(String(format: "яркость: min %.2f max %.2f", lumMin, lumMax))
print("bbox: x \(minX)…\(maxX), y \(minY)…\(maxY) из \(w)×\(h)")

// Вписываем содержимое в квадрат с полями, сохраняя пропорции.
let cw = CGFloat(maxX - minX + 1), ch = CGFloat(maxY - minY + 1)
let inner = out * (1 - margin * 2)
let scale = min(inner / cw, inner / ch)
let dw = cw * scale, dh = ch * scale

let res = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(out), pixelsHigh: Int(out),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: res)
NSGraphicsContext.current?.imageInterpolation = .high
let cropped = NSImage(size: NSSize(width: w, height: h))
cropped.addRepresentation(alpha)
cropped.draw(in: NSRect(x: (out - dw) / 2, y: (out - dh) / 2, width: dw, height: dh),
             from: NSRect(x: CGFloat(minX), y: CGFloat(h - maxY - 1), width: cw, height: ch),
             operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try! res.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: dst))
print("готово: \(dst) (\(Int(out))×\(Int(out)), поля \(Int(margin * 100))%)")
