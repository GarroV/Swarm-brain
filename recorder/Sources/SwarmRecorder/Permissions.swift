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

    // Открывает прямо нужную панель настроек (выдать доступ к записи экрана/системного звука).
    static func openScreenRecordingSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    static func requestMicrophone() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }
}
