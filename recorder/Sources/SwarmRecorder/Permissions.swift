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

    // Открывает панель разрешения на запись СИСТЕМНОГО ЗВУКА.
    // macOS 26 (Tahoe): системный звук — ОТДЕЛЬНЫЙ TCC-сервис kTCCServiceAudioCapture
    // («…would like access to record your system audio»), своя панель, НЕ «Screen Recording».
    // Сначала аудио-anchor (современный + легаси bundle id), затем фолбэк на ScreenCapture
    // (старые ОС, где тап шёл через ScreenCaptureKit/kTCCServiceScreenCapture).
    static func openScreenRecordingSettings() {
        let anchors = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AudioCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture",
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
