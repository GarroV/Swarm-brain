import AppKit
import RecorderKit

// Марка приложения — рисунок шмеля из `Resources/BeeMark.png` (белый контур на прозрачном фоне).
// Здесь только загрузка ресурса из бандла; сама отрисовка — в `RecorderKit/MarkRenderer`,
// потому что она под тестом (issue #197: чип съезжал в сплошной белый квадрат).
// Как файл получен из исходника — Resources/README.md.
enum RoyArt {
    static let amber = MarkRenderer.amber
    static let graphite = MarkRenderer.graphite

    private static let mark: NSImage? = {
        guard let url = Bundle.main.url(forResource: "BeeMark", withExtension: "png"),
              let img = NSImage(contentsOf: url) else {
            NSLog("SwarmRecorder: BeeMark.png не найден в бандле — значок будет запасной")
            return nil
        }
        return img
    }()

    // Иконка для меню-бара. Покой — template (macOS красит сама под тему), запись — красная.
    static func menuBarImage(recording: Bool) -> NSImage {
        let img = MarkRenderer.glyphImage(mark, size: 18, color: recording ? .systemRed : .black)
        img.isTemplate = !recording
        return img
    }

    // Полная марка: графитовый скруглённый чип + белый шмель. Для виджета и .icns.
    static func markImage(size s: CGFloat) -> NSImage {
        MarkRenderer.chipImage(mark, size: s)
    }

    // Та же марка прямо в текущий контекст.
    static func drawMark(in s: CGFloat) {
        MarkRenderer.drawChip(mark, size: s)
    }
}
