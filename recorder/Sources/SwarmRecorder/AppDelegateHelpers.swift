import AppKit
import Foundation

// Вынесено из AppDelegate.swift без изменений (лимит размера файла, scripts/check-source-size.py).

func infoAlert(_ title: String, _ text: String) {
    let a = NSAlert()
    a.messageText = title
    a.informativeText = text
    a.addButton(withTitle: "OK")
    NSApp.activate(ignoringOtherApps: true)
    a.runModal()
}

// Сетевой/транспортный сбой → состояние .offline (а не общая ошибка): URLError (нет связи,
// таймаут) или SwarmError.transport (мы не дошли до HTTP-ответа).
func isOfflineError(_ error: Error) -> Bool {
    if error is URLError { return true }
    if case SwarmError.transport = error { return true }
    return false
}
