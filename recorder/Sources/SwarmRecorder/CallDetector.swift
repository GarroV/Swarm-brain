import CoreAudio
import Foundation

// Детект «идёт звонок» по активности микрофона — без календаря. Свойство
// kAudioDevicePropertyDeviceIsRunningSomewhere на устройстве ввода по умолчанию: true,
// когда вход занят любым процессом (Meet/Zoom/Telegram/Контур и т.п.). Чтение свойства
// НЕ требует доступа к микрофону (это аппаратный флаг, не захват звука).
enum CallDetector {
    static func isMicActive() -> Bool {
        var devID = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var devAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        )
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devAddr, 0, nil, &size, &devID) == noErr,
              devID != 0 else { return false }

        var running: UInt32 = 0
        var rsize = UInt32(MemoryLayout<UInt32>.size)
        var runAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        )
        guard AudioObjectGetPropertyData(devID, &runAddr, 0, nil, &rsize, &running) == noErr else { return false }
        return running != 0
    }
}
