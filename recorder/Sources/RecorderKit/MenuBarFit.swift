import Foundation

// Влез ли значок в строку состояния (issue #232).
//
// macOS МОЛЧА прячет элементы строки состояния, которым не хватило ширины: на 13-дюймовом
// ноутбуке с вырезом и плотным меню-баром подпись «Название · 53m left» выдавила сам значок
// bumblebee — вместе с единственным способом остановить запись и увидеть статус. Приложению
// об этом не сообщают: `NSStatusItem.isVisible` остаётся `true`.
//
// Поэтому проверяем геометрию: рамка элемента обязана целиком лежать в отведённой зоне
// меню-бара (`NSScreen.auxiliaryTopRightArea` — часть строки справа от выреза). Не лежит —
// значит элемент уехал под вырез, и подпись надо снять, оставив один глиф.
public enum MenuBarFit {
    /// `itemFrame` — рамка окна элемента, `menuBarZone` — доступная зона строки состояния.
    /// `menuBarZone == nil` (экран без выреза) считаем «места хватает»: гадать там нечем.
    public static func isVisible(itemFrame: CGRect?, menuBarZone: CGRect?) -> Bool {
        guard let itemFrame else { return false }       // окна нет — нечего и показывать
        guard itemFrame.width > 0 else { return false }  // нулевая ширина = элемент свёрнут
        guard let menuBarZone else { return true }
        // Именно `contains`, а не пересечение: элемент, наполовину заехавший под вырез,
        // обрезан и нажать по нему нельзя.
        return menuBarZone.contains(itemFrame)
    }
}
