import AppKit
import Foundation

// Вынесено из AppDelegate.swift (лимит размера файла, scripts/check-source-size.py).

// Короткое сообщение человеку — своя карточка рекордера, не системное окно (решение владельца
// 09.11.2026, RecorderNotices). Заголовок задаёт id: тот же текст подряд заменяет, а не копит.
func postInfoNotice(_ title: String, _ text: String = "") {
    RecorderNotices.shared.post(id: "info-\(title)", title: title, body: text)
}

// Сетевой/транспортный сбой → состояние .offline (а не общая ошибка): URLError (нет связи,
// таймаут) или SwarmError.transport (мы не дошли до HTTP-ответа).
func isOfflineError(_ error: Error) -> Bool {
    if error is URLError { return true }
    if case SwarmError.transport = error { return true }
    return false
}
