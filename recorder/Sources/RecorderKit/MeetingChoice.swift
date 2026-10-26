import Foundation

// Что капсула предлагает по календарю и какую встречу выбрал человек (D026, D027).
//
// D026: капсула всплывает только для созвонов — события со ссылкой. Слот, заглушка, напоминание
// без ссылки капсулу не зовут: для них есть уведомления Google. Сервер (`meeting-current`) такие
// уже не отдаёт; здесь второй барьер — на случай старого сервера или ссылки, которую мы не приняли
// (пускаем только https, см. JoinLink).
// D027: пересекающиеся созвоны капсула показывает все, у каждого своя «Подключиться». Выбор
// ищется по КЛЮЧУ встречи, а не по номеру строки: список обновляется раз в минуту, и номер,
// увиденный человеком, к моменту клика мог указывать уже на другую встречу.
public enum MeetingChoice {
    /// Предложения капсулы в порядке сервера (лучший первым): только со ссылкой, без закрытых
    /// человеком, без повторов одного ключа.
    public static func offers<T>(_ items: [T], key: (T) -> String, hasLink: (T) -> Bool,
                                 isDismissed: (String) -> Bool) -> [T] {
        var seen = Set<String>()
        return items.filter { item in
            let k = key(item)
            guard hasLink(item), !isDismissed(k), !seen.contains(k) else { return false }
            seen.insert(k)
            return true
        }
    }

    /// Встреча, которую выбрал человек. `nil` — её уже нет среди предложений: тогда ничего не
    /// открываем и не пишем, а не подставляем соседнюю.
    public static func chosen<T>(_ items: [T], key: (T) -> String, _ chosenKey: String) -> T? {
        items.first { key($0) == chosenKey }
    }

    /// Встреча для «Записать» из меню, когда созвонов несколько (26.10.2026: при двух созвонах в
    /// одно время запись молча бралась к первому по рейтингу сервера, а не к тому, где человек
    /// сидит). Порядок: созвон, чья вкладка открыта у человека → созвон, который ещё никто не
    /// пишет → первый по рейтингу. `isOpen` зовётся, только если выбирать есть из чего.
    public static func manualPick<T>(_ items: [T], key: (T) -> String, isOpen: (T) -> Bool,
                                     isRecordedByOthers: (String) -> Bool) -> T? {
        guard items.count > 1 else { return items.first }
        if let open = items.first(where: isOpen) { return open }
        return items.first { !isRecordedByOthers(key($0)) } ?? items.first
    }

    /// Изменилось ли предложение — капсулу перерисовываем только тогда.
    public static func sameOffer<T>(_ a: [T], _ b: [T], key: (T) -> String) -> Bool {
        a.map(key) == b.map(key)
    }
}
