// Генератор иконки приложения — схематичная «жопка шмеля» (bumblebee).
// Геометрия НЕ дублируется: рисует RoyArt из исходников приложения, чтобы иконка приложения,
// меню-бара и виджета не разъехались.
// Запуск (из recorder/):  ./gen-icon.sh   → AppIcon.iconset + AppIcon.icns
import AppKit

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    RoyArt.drawMark(in: s)
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
