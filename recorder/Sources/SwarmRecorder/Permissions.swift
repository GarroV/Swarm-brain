import Foundation
import AVFoundation
import CoreGraphics

// Запрос TCC-разрешений. MVP нужен «Screen & System Audio Recording» (для ScreenCaptureKit).
// Микрофон/Календарь — для следующих итераций, но запросить заранее не вредно.
enum Permissions {
    // Запись экрана/системного звука. CGRequestScreenCaptureAccess покажет системный запрос;
    // первый реальный SCStream всё равно триггерит проверку. Возвращает уже-выдан ли доступ.
    static func ensureScreenRecording() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        return CGRequestScreenCaptureAccess()
    }

    static func requestMicrophone() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }
}
