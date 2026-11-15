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
//
// ПЕРЕСМОТРЕНО 12.11.2026 («капсула пусть помнит место» — вариант «помнить строже»).
// 06.11 запомненное место оказалось посреди второго монитора: рекордер слушал
// `NSWindow.didMoveNotification` и не отличал ручной сдвиг от сдвига, который делает сама
// macOS при подключении/отключении монитора. Теперь:
//   • место запоминается ТОЛЬКО по завершённому перетаскиванию мышкой (окно капсулы ловит
//     mouseDown → mouseUp и сравнивает положение до и после, см. `WidgetPanel`); любой
//     другой сдвиг — системный, показ, переход капсула ↔ баннер — не пишется никогда;
//   • хранится не абсолютная точка, а ОТСТУП правого верхнего угла от правого верхнего угла
//     visibleFrame экрана (`WidgetInset`): на другом мониторе или после смены разрешения
//     капсула встаёт у того же угла, а не в случайную точку чужих координат;
//   • прежнее абсолютное значение (`widget.topRight`, сборка 39) не читается — оно как раз
//     и могло оказаться «в середине второго монитора»; у кого оно было, капсула вернётся на
//     дефолтное место, и первое же перетаскивание запомнится уже по-новому.
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

    /// Куда съехать окну, когда МЕНЯЕТСЯ РЕЖИМ (капсула записи ↔ баннер встречи) и вместе с
    /// ним размер. Правый край и верх сохраняются — тогда баннер «вытекает» из капсулы влево,
    /// а не выглядит вторым, отдельно прилетевшим окном (просьба владельца 03.09.2026:
    /// «чтобы элемент по сути был единым, и уведомление из капсулы вытекало»).
    ///
    /// Пересчитывать позицию через `defaultOrigin` здесь НЕЛЬЗЯ: окно, которое человек
    /// перетащил, прыгало бы на дефолтное место при каждой смене режима.
    public static func morphOrigin(from current: CGRect, to size: CGSize,
                                   in visibleFrame: CGRect) -> CGPoint {
        // Растём влево от правого края и вниз от верхнего.
        var x = current.maxX - size.width
        var y = current.maxY - size.height
        // У левого края расти влево некуда — прижимаемся и растём вправо.
        x = min(max(x, visibleFrame.minX), max(visibleFrame.minX, visibleFrame.maxX - size.width))
        // Тот же зажим по вертикали: у нижнего края окно не должно уйти за экран.
        y = min(max(y, visibleFrame.minY), max(visibleFrame.minY, visibleFrame.maxY - size.height))
        return CGPoint(x: x, y: y)
    }

    /// Отступ правого верхнего угла окна от правого верхнего угла видимой области экрана.
    /// Неотрицательные пункты; значения вне экрана (окно частично за краем) сводятся к 0.
    public static func inset(of frame: CGRect, in visibleFrame: CGRect) -> WidgetInset {
        WidgetInset(right: max(0, visibleFrame.maxX - frame.maxX),
                    top: max(0, visibleFrame.maxY - frame.maxY))
    }

    /// Позиция при показе: сохранённый отступ от правого верхнего угла экрана (втянутый
    /// в границы экрана), иначе дефолтная. Нечисловой отступ (`nan`/`inf` из мусора в
    /// настройках) — тоже дефолт.
    ///
    /// Окно привязано к ПРАВОМУ ВЕРХНЕМУ углу, а не к левому нижнему (origin). Капсула (72 пт) и
    /// баннер встречи (~300 пт) — одно окно разной ширины, растущее влево от правого края
    /// (`morphOrigin`). Пока запоминался origin, баннер записывал свой левый край, а узкая
    /// капсула потом вставала в него: каждый цикл «баннер → капсула» уводил окно на ширину
    /// баннера влево, и за несколько дней оно доползало до середины экрана (03.11.2026,
    /// замерено: сохранено x=709 на экране шириной 1710). Угол, от которого окно растёт, при
    /// смене режима не двигается — дрейфовать нечему.
    public static func origin(savedInset: WidgetInset?, size: CGSize, in visibleFrame: CGRect,
                              rightInset: CGFloat = 18) -> CGPoint {
        guard let saved = savedInset, saved.right.isFinite, saved.top.isFinite else {
            return defaultOrigin(size: size, in: visibleFrame, rightInset: rightInset)
        }
        let wanted = CGPoint(x: visibleFrame.maxX - max(0, saved.right) - size.width,
                             y: visibleFrame.maxY - max(0, saved.top) - size.height)
        // Монитор мог смениться (другой размер, другое разрешение): отступ больше экрана
        // зажимаем у ближайшего края — окно всегда целиком на видимой области.
        return CGPoint(
            x: min(max(wanted.x, visibleFrame.minX), max(visibleFrame.minX, visibleFrame.maxX - size.width)),
            y: min(max(wanted.y, visibleFrame.minY), max(visibleFrame.minY, visibleFrame.maxY - size.height))
        )
    }
}

/// Куда человек перетащил капсулу: отступ её правого верхнего угла от правого верхнего
/// угла видимой области экрана. Не зависит от того, на каком мониторе и с каким
/// разрешением капсулу показывают.
public struct WidgetInset: Equatable {
    public let right: CGFloat
    public let top: CGFloat
    public init(right: CGFloat, top: CGFloat) {
        self.right = right
        self.top = top
    }

    /// Строка для `UserDefaults` вида `"12.0,340.5"`.
    public var stored: String { "\(right),\(top)" }

    /// Разбор `stored`; мусор, не два числа, нечисловое или отрицательное → `nil` (дефолт).
    public init?(stored: String) {
        let parts = stored.split(separator: ",", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let r = Double(parts[0]), let t = Double(parts[1]),
              r.isFinite, t.isFinite, r >= 0, t >= 0 else { return nil }
        self.init(right: CGFloat(r), top: CGFloat(t))
    }
}
