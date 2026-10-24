import Carbon.HIToolbox
import Foundation

// Глобальная клавиша голосовой задачи (⌃⌥Space) — Carbon `RegisterEventHotKey`: без сторонних
// пакетов и без разрешения Accessibility. Своя, отдельная от всего остального в рекордере.
// Занята другим приложением → `register()` вернёт false, а доска остаётся с кнопкой.
final class BoardHotKey {
    var onPress: (() -> Void)?
    private(set) var isRegistered = false

    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private static let signature: OSType = 0x4242_484B   // 'BBHK'

    @discardableResult
    func register(keyCode: Int = kVK_Space, modifiers: Int = controlKey | optionKey) -> Bool {
        guard !isRegistered else { return true }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let me = Unmanaged.passUnretained(self).toOpaque()
        let installed = InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            let hotKey = Unmanaged<BoardHotKey>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { hotKey.onPress?() }
            return noErr
        }, 1, &spec, me, &handlerRef)
        guard installed == noErr else {
            NSLog("SwarmRecorder: доска — не поставился обработчик клавиши (\(installed))")
            return false
        }
        let id = EventHotKeyID(signature: Self.signature, id: 1)
        let status = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), id, GetApplicationEventTarget(), 0, &hotKeyRef)
        guard status == noErr else {
            NSLog("SwarmRecorder: доска — ⌃⌥Space не зарегистрировалась (\(status)); скорее всего, занята другим приложением")
            if let handlerRef { RemoveEventHandler(handlerRef) }
            handlerRef = nil
            return false
        }
        isRegistered = true
        return true
    }

    func unregister() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let handlerRef { RemoveEventHandler(handlerRef) }
        hotKeyRef = nil; handlerRef = nil; isRegistered = false
    }

    deinit { unregister() }
}
