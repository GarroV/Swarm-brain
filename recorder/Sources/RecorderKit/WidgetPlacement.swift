import CoreGraphics

// Где на экране появляется плавающая капсула рекордера.
//
// Issue #197: дефолт приходился на правый ВЕРХ, ровно в полосу управления веб-приложений
// (аватары, счётчики, кнопки) — капсула их накрывала, и человек оттаскивал её при каждом
// запуске заново, потому что позиция не помнилась.
//
// Решение владельца 02.09.2026: помнить, куда перетащили, а дефолт для тех, кто не таскал,
// опустить ниже полосы управления.
//
// ПЕРЕСМОТРЕНО 03.09.2026 («надо виджет поднять чуть выше, я думаю на 2 таких же фрейма»):
// на практике дефолт оказался слишком низко — окно садилось поверх содержимого, с которым
// человек работает. Дефолт поднят на две высоты баннера встречи (`defaultLift`), а полоса
// `headerBand` из-за этого сокращена с 200 до воздуха под меню-баром: удержать и подъём,
// и прежний запрет «не выше 200 пунктов» одновременно нельзя.
// Цена решения: капсула снова может накрыть шапку веб-приложения — ту боль, из-за которой
// в #197 и появились 200 пунктов. Смягчение остаётся прежним: позиция ЗАПОМИНАЕТСЯ, и кому
// нужно ниже, тот оттащит один раз.
public enum WidgetPlacement {
    /// Отступ дефолтной позиции от верха экрана — долей высоты, чтобы на любом мониторе
    /// капсула уходила из-под шапки, а не на фиксированные N пунктов.
    public static let topFraction: CGFloat = 0.28
    /// Насколько дефолт поднят относительно `topFraction` — просьба владельца 03.09.2026
    /// «поднять на 2 таких же фрейма». Фрейм = баннер встречи, который владелец и видел на
    /// экране: его ФАКТИЧЕСКАЯ высота 102 пункта (`bannerMinSize.height` = 84 — только
    /// минимум, реальная считается по контенту — замерено `--selftest-widget`), значит два
    /// фрейма = 204. Величина в пунктах, а не «2 × size.height», чтобы капсула (110) и
    /// баннер вставали на одну линию — иначе при переключении режима окно прыгало бы само.
    public static let defaultLift: CGFloat = 204
    /// Воздух под меню-баром: выше капсула не поднимается. Раньше здесь была полоса
    /// управления веб-приложений (200 пунктов, #197) — снята подъёмом, см. заголовок файла.
    public static let headerBand: CGFloat = 56
    /// И столько же над доком — там капсула мешает не меньше.
    public static let dockBand: CGFloat = 120

    /// Дефолт: правый край, ниже полосы управления.
    public static func defaultOrigin(size: CGSize, in visibleFrame: CGRect,
                                     rightInset: CGFloat = 18) -> CGPoint {
        let x = visibleFrame.maxX - size.width - rightInset
        // Желаемый отступ сверху, зажатый в коридор «ниже шапки, выше дока».
        let lowest = visibleFrame.minY + dockBand
        let highest = visibleFrame.maxY - headerBand - size.height
        let wanted = visibleFrame.maxY - visibleFrame.height * topFraction - size.height + defaultLift
        let y = highest >= lowest ? min(max(wanted, lowest), highest)
                                  : max(visibleFrame.minY, highest)   // экран ниже двух полос
        return CGPoint(x: x, y: y)
    }

    /// Позиция при показе: сохранённая (втянутая в границы экрана), иначе дефолтная.
    public static func origin(saved: CGPoint?, size: CGSize, in visibleFrame: CGRect,
                              rightInset: CGFloat = 18) -> CGPoint {
        guard let saved else { return defaultOrigin(size: size, in: visibleFrame, rightInset: rightInset) }
        // Монитор, на котором стояла капсула, могли отключить: координаты остались, экрана нет.
        // Такую позицию не «втягиваем» (капсула прилипла бы к случайному краю) — берём дефолт.
        let savedFrame = CGRect(origin: saved, size: size)
        guard savedFrame.intersects(visibleFrame) else {
            return defaultOrigin(size: size, in: visibleFrame, rightInset: rightInset)
        }
        return CGPoint(
            x: min(max(saved.x, visibleFrame.minX), max(visibleFrame.minX, visibleFrame.maxX - size.width)),
            y: min(max(saved.y, visibleFrame.minY), max(visibleFrame.minY, visibleFrame.maxY - size.height))
        )
    }
}
