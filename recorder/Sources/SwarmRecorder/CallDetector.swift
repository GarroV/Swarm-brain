import CoreAudio
import Foundation
import RecorderKit

// Детект звонка по аудио без календаря.
//   • isMicActiveBlocking() — устройство ввода занято кем-либо (device-level). Годится, пока МЫ НЕ
//     пишем (idle): ловит старт звонка. Во время нашей записи бесполезно — мы сами держим мик.
//   • sampleProcesses() — per-process (macOS 14.0+): какие ДРУГИЕ процессы держат вход, исключая
//     наш PID. Работает и во время записи → этим ловим конец звонка (список опустел). Без TCC.
enum CallDetector {
    struct MicProcess: Sendable { let pid: pid_t; let bundle: String }
    struct Snapshot: Sendable { let active: Bool; let processes: [MicProcess] }

    // HAL can block forever while coreaudiod is unresponsive. Exactly one provider
    // request may be in flight, even after its deadline. No caller waits for it.
    private static let probe = NonBlockingProbe<Snapshot?>(timeout: 1, refreshInterval: 1) {
        if #available(macOS 14.0, *) {
            return sampleProcesses(objects: processList(), currentPID: ProcessInfo.processInfo.processIdentifier,
                                   pid: readPID, running: { readU32($0, kAudioProcessPropertyIsRunningInput) }, bundle: readBundle)
        }
        guard let active = isMicActiveBlocking() else { return nil }
        return Snapshot(active: active, processes: [])
    }
    private static var pollTimer: DispatchSourceTimer?

    static func startMonitoring(onUnavailable: @escaping @MainActor @Sendable (Bool) -> Void) {
        probe.onAvailabilityChange { unavailable in
            DispatchQueue.main.async { onUnavailable(unavailable) }
        }
        guard pollTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now(), repeating: 1)
        timer.setEventHandler { _ = probe.poll() }
        pollTimer = timer
        timer.resume()
    }

    static func snapshot() -> Snapshot? {
        switch probe.poll() {
        case .value(let value): return value
        case .pending, .timedOut: return nil
        }
    }

    private static func isMicActiveBlocking() -> Bool? {
        var devID = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var devAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devAddr, 0, nil, &size, &devID) == noErr else { return nil }
        guard devID != 0 else { return false }

        var running: UInt32 = 0
        var rsize = UInt32(MemoryLayout<UInt32>.size)
        var runAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(devID, &runAddr, 0, nil, &rsize, &running) == noErr else { return nil }
        return running != 0
    }

    // Системные демоны, держащие микрофон ПОСТОЯННО (не реальные созвоны). Из-за них список
    // «других» никогда не пустел и авто-стоп не срабатывал. Доказано пробой: com.apple.CoreSpeech
    // (Siri/диктовка) держит вход всегда, даже когда никакого созвона нет.
    static let ignoredMicBundles: Set<String> = ["com.apple.CoreSpeech"]

    // Активен ли РЕАЛЬНЫЙ созвон: кто-то, КРОМЕ нас и системных демонов, держит вход микрофона.
    // macOS 14+ — точный per-process детект; ниже — грубый device-level (там фильтра демонов нет).
    // nil means unknown, never a confirmed "microphone released".
    static func realCallActive() -> Bool? { snapshot()?.active }

    // The same sampler is exercised without hardware by --selftest-call-detector.
    static func sampleProcesses(objects: [AudioObjectID]?, currentPID: pid_t,
                                pid: (AudioObjectID) -> pid_t?, running: (AudioObjectID) -> UInt32?,
                                bundle: (AudioObjectID) -> String?) -> Snapshot? {
        guard let objects else { return nil }
        var processes: [MicProcess] = []
        var unreadable = false
        for obj in objects {
            guard let process = pid(obj), process > 0 else { unreadable = true; continue }
            if process == currentPID { continue }
            guard let input = running(obj), input <= 1 else { unreadable = true; continue }
            if input == 0 { continue }
            let name = bundle(obj) ?? "?"
            if ignoredMicBundles.contains(name) { continue }
            processes.append(MicProcess(pid: process, bundle: name))
        }
        // One confirmed call is sufficient; absence requires every relevant read to succeed.
        if processes.isEmpty && unreadable { return nil }
        return Snapshot(active: !processes.isEmpty, processes: processes)
    }

    @available(macOS 14.0, *)
    private static func readBundle(_ obj: AudioObjectID) -> String? {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyBundleID,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var cf: CFString = "" as CFString
        var sz = UInt32(MemoryLayout<CFString>.size)
        guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &sz, &cf) == noErr else { return nil }
        let s = cf as String
        return s.isEmpty ? nil : s
    }

    @available(macOS 14.0, *)
    private static func processList() -> [AudioObjectID]? {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var sz: UInt32 = 0
        let sys = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(sys, &addr, 0, nil, &sz) == noErr else { return nil }
        if sz == 0 { return [] }
        let stride = UInt32(MemoryLayout<AudioObjectID>.size)
        guard sz % stride == 0 else { return nil }
        var ids = [AudioObjectID](repeating: AudioObjectID(kAudioObjectUnknown), count: Int(sz) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(sys, &addr, 0, nil, &sz, &ids) == noErr,
              sz % stride == 0, Int(sz / stride) <= ids.count else { return nil }
        return Array(ids.prefix(Int(sz / stride)))
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
