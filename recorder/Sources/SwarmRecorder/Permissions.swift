import Foundation
import AVFoundation
import CoreGraphics
import AppKit

// Запрос TCC-разрешений. MVP нужен «Screen & System Audio Recording» (для ScreenCaptureKit).
// Микрофон/Календарь — для следующих итераций, но запросить заранее не вредно.
enum Permissions {
    // Запись экрана/системного звука. CGRequestScreenCaptureAccess покажет системный запрос
    // ОДИН раз за жизнь процесса — поэтому дёргаем его только по явному действию пользователя
    // (старт записи), а не на старте приложения, иначе промпт «съедается» молча и больше не
    // показывается. Возвращает, выдан ли доступ.
    static func ensureScreenRecording() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        return CGRequestScreenCaptureAccess()
    }

    // Открывает панель «Screen & System Audio Recording» — там же живёт разрешение
    // Core Audio process-tap (macOS 14.4+, TCC-сервис kTCCServiceScreenCapture). Отдельной
    // «System Audio»-панели/anchor НЕТ — правильный anchor именно Privacy_ScreenCapture.
    // Сначала пробуем современный bundle id (Sequoia+), затем легаси-фолбэк.
    static func openScreenRecordingSettings() {
        let anchors = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        ]
        for s in anchors {
            if let url = URL(string: s), NSWorkspace.shared.open(url) { return }
        }
    }

    static func requestMicrophone() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }
}
