import Foundation
import AVFoundation
import CoreGraphics
import AppKit

// Запрос TCC-разрешений. MVP нужен «Screen & System Audio Recording» (для ScreenCaptureKit).
// Микрофон/Календарь — для следующих итераций, но запросить заранее не вредно.
enum Permissions {
    // На macOS 14.4+ системный звук пишется через Core Audio process-tap → нужен ОТДЕЛЬНЫЙ
    // TCC-сервис kTCCServiceAudioCapture, в System Settings он называется «System Audio Recording».
    // Ниже 14.4 системный звук берётся через ScreenCaptureKit → требуется «Screen Recording».
    // Эта развилка определяет и текст для пользователя, и какую панель настроек открывать.
    static var usesSystemAudioCapture: Bool {
        if #available(macOS 14.4, *) { return true }
        return false
    }

    // Человекочитаемое имя нужного разрешения (для заголовков ошибок и текста «куда идти»).
    static var captureSettingName: String {
        usesSystemAudioCapture ? "System Audio Recording" : "Screen Recording"
    }

    // Точный путь в System Settings, который надо продиктовать пользователю (RU-локаль macOS
    // показывает английские названия секций приватности как есть).
    static var captureSettingsPath: String {
        "System Settings → Privacy & Security → \(captureSettingName) → включить SwarmRecorder"
    }

    // Запись экрана/системного звука. CGRequestScreenCaptureAccess покажет системный запрос
    // ОДИН раз за жизнь процесса — поэтому дёргаем его только по явному действию пользователя
    // (старт записи), а не на старте приложения, иначе промпт «съедается» молча и больше не
    // показывается. Возвращает, выдан ли доступ.
    static func ensureScreenRecording() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        return CGRequestScreenCaptureAccess()
    }

    // Открывает панель нужного разрешения на запись звука.
    // 14.4+ → kTCCServiceAudioCapture («System Audio Recording»), своя панель, НЕ «Screen Recording».
    // Сначала пробуем якорь, соответствующий ОС, затем фолбэки (легаси bundle id / другой сервис).
    static func openScreenRecordingSettings() {
        let audio = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AudioCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"
        ]
        let screen = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        ]
        // На 14.4+ нужен AudioCapture, на старых ОС — ScreenCapture; второй список как фолбэк.
        let anchors = usesSystemAudioCapture ? audio + screen : screen + audio
        for s in anchors {
            if let url = URL(string: s), NSWorkspace.shared.open(url) { return }
        }
    }

    // Открывает панель разрешения МИКРОФОНА (Privacy → Microphone).
    static func openMicrophoneSettings() {
        let anchors = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        ]
        for s in anchors {
            if let url = URL(string: s), NSWorkspace.shared.open(url) { return }
        }
    }

    // Открывает панель разрешения УВЕДОМЛЕНИЙ, по возможности сразу на карточке bumblebee.
    // Якорь с ?id=<bundle id> ведёт прямо к приложению — иначе человек попадает в общий список
    // из полусотни программ и ищет нас глазами. Дальше фолбэки: панель без якоря на приложение
    // и легаси-идентификатор для старых ОС.
    static func openNotificationSettings() {
        let bundleId = Bundle.main.bundleIdentifier ?? ""
        let encoded = bundleId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? bundleId
        var anchors: [String] = []
        if !bundleId.isEmpty {
            anchors.append("x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(encoded)")
        }
        anchors.append("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
        anchors.append("x-apple.systempreferences:com.apple.preference.notifications")
        for s in anchors {
            if let url = URL(string: s), NSWorkspace.shared.open(url) { return }
        }
    }

    static func requestMicrophone() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }
}
