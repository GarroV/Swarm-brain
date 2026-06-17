import CoreAudio
import Foundation

// Детект звонка по аудио без календаря.
//   • isMicActive() — устройство ввода занято кем-либо (device-level). Годится, пока МЫ НЕ
//     пишем (idle): ловит старт звонка. Во время нашей записи бесполезно — мы сами держим мик.
//   • othersUsingMic() — per-process (macOS 14.0+): какие ДРУГИЕ процессы держат вход, исключая
//     наш PID. Работает и во время записи → этим ловим конец звонка (список опустел). Без TCC.
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

    // ── per-process детект входа (macOS 14.0+), исключая свой процесс ─────────────
    @available(macOS 14.0, *)
    static func othersUsingMic() -> [pid_t] {
        let me = ProcessInfo.processInfo.processIdentifier
        return processList().compactMap { obj in
            guard let pid = readPID(obj), pid > 0, pid != me else { return nil }
            // Boolean Core Audio читаем как UInt32 (4 байта), сравниваем с 1.
            guard (readU32(obj, kAudioProcessPropertyIsRunningInput) ?? 0) == 1 else { return nil }
            return pid
        }
    }

    @available(macOS 14.0, *)
    private static func processList() -> [AudioObjectID] {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var sz: UInt32 = 0
        let sys = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(sys, &addr, 0, nil, &sz) == noErr, sz > 0 else { return [] }
        var ids = [AudioObjectID](repeating: AudioObjectID(kAudioObjectUnknown), count: Int(sz) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(sys, &addr, 0, nil, &sz, &ids) == noErr else { return [] }
        return ids
    }

    @available(macOS 14.0, *)
    private static func readPID(_ obj: AudioObjectID) -> pid_t? {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyPID,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var v: pid_t = -1
        var sz = UInt32(MemoryLayout<pid_t>.size)
        return AudioObjectGetPropertyData(obj, &addr, 0, nil, &sz, &v) == noErr ? v : nil
    }

    @available(macOS 14.0, *)
    private static func readU32(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> UInt32? {
        var addr = AudioObjectPropertyAddress(
            mSelector: sel,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var v: UInt32 = 0
        var sz = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(obj, &addr, 0, nil, &sz, &v) == noErr ? v : nil
    }
}
