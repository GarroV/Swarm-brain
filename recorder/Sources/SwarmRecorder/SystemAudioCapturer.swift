import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreAudio
import AudioToolbox
import CoreMedia
import os

// Захват СИСТЕМНОГО звука одной встречи. Две реализации за единым протоколом:
//   • ProcessTapSystemRecorder (macOS 14.4+) — Core Audio process-tap. Мягкое разрешение
//     «System Audio Recording Only» (не «запись экрана»), не слетает от пересборок,
//     и даёт чистый per-process детект звонка (см. CallDetector).
//   • ScreenCaptureKitRecorder (13.0..<14.4) — прежний путь через ScreenCaptureKit.
// Выход обеих веток идентичен: AAC .m4a по systemURL. Микрофон пишется отдельно в AudioRecorder.
//
// Сегменты (только process-tap): при смене дефолтного устройства вывода или при «зависшей
// тишине» во время активного созвона тап пересоздаётся (полный LIFO-teardown → recreate) и
// дальнейший звук пишется в НОВЫЙ файл-сегмент. systemURL держит первый сегмент (offset 0),
// остальные — в extraSegments с offset = (старт сегмента − старт сессии) в секундах.
protocol SystemAudioCapturer: AnyObject {
    func start(systemURL: URL) async throws
    func stop() async

    // Монотонный (ProcessInfo.systemUptime) момент первого реального сэмпла системной дорожки.
    // nil, если ни одного буфера так и не пришло. Нужен AudioRecorder для micStartOffset.
    var firstSampleUptime: Double? { get }

    // Доп. сегменты сверх systemURL (см. выше). Пусто в обычном сценарии (без пересборок).
    var extraSegments: [(url: URL, offset: Double)] { get }

    // Текущий уровень СИСТЕМНОЙ дорожки (собеседники), нормализованный в 0…1, слегка сглажен.
    // Считается из тех же буферов, что пишутся в файл. Потокобезопасно (аудио-колбэк не на main).
    // 0, если захват не идёт или буферов ещё нет. Используется: (1) живой индикатор в виджете,
    // (2) детект конца браузерного звонка по затяжной тишине системной дорожки.
    func currentLevel() -> Float

    // Сигнал наружу: true — собеседник не пишется и авто-пересборки не помогли; false — звук
    // вернулся. Даёт честно предупредить пользователя (не терять собеседника молча). Опционально.
    var onSystemStalled: ((Bool) -> Void)? { get set }
}

extension SystemAudioCapturer {
    var extraSegments: [(url: URL, offset: Double)] { [] }
}

func makeSystemCapturer() -> SystemAudioCapturer {
    if #available(macOS 14.4, *) { return ProcessTapSystemRecorder() }
    return ScreenCaptureKitRecorder()
}

// ── Потокобезопасный трекер уровня системной дорожки ──────────────────────────
// Обновляется из аудио-колбэка (off-main), читается из main (виджет) и main-таймера
// (детект тишины). Доступ к значению под os_unfair_lock — дёшево, без аллокаций в колбэке.
// Сглаживание экспоненциальное: быстрый рост, плавный спад — полоса/детект не «дёргаются».
final class SystemLevelTracker {
    private var lock = os_unfair_lock()
    private var smoothed: Float = 0

    func update(rawPeak: Float) {
        let clamped = max(0, min(1, rawPeak))
        os_unfair_lock_lock(&lock)
        // Рост — мгновенно (видеть собеседника сразу), спад — плавно.
        smoothed = clamped > smoothed ? clamped : smoothed * 0.6 + clamped * 0.4
        os_unfair_lock_unlock(&lock)
    }

    func current() -> Float {
        os_unfair_lock_lock(&lock)
        let v = smoothed
        os_unfair_lock_unlock(&lock)
        return v
    }

    func reset() {
        os_unfair_lock_lock(&lock)
        smoothed = 0
        os_unfair_lock_unlock(&lock)
    }

    // Пиковая амплитуда float32-буфера (0.0 → буфер тишины). Дёшево, без выделений.
    static func bufferPeak(_ buf: AVAudioPCMBuffer) -> Float {
        guard let chans = buf.floatChannelData else { return 0 }
        let frames = Int(buf.frameLength)
        let channels = Int(buf.format.channelCount)
        var peak: Float = 0
        for c in 0..<channels {
            let data = chans[c]
            for i in 0..<frames {
                let v = abs(data[i])
                if v > peak { peak = v }
            }
        }
        return peak
    }

    // Пик из CMSampleBuffer (путь ScreenCaptureKit): копируем сэмплы в AVAudioPCMBuffer.
    // На неподдержанном формате (не float/int16) безопасно возвращаем 0.
    static func samplePeak(_ sampleBuffer: CMSampleBuffer) -> Float {
        guard let fmtDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fmtDesc) else { return 0 }
        let asbd = asbdPtr.pointee
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frames > 0, asbd.mChannelsPerFrame > 0 else { return 0 }

        var blockBuffer: CMBlockBuffer?
        let listSize = MemoryLayout<AudioBufferList>.size + Int(asbd.mChannelsPerFrame) * MemoryLayout<AudioBuffer>.size
        let ablPtr = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { ablPtr.deallocate() }
        let abl = ablPtr.assumingMemoryBound(to: AudioBufferList.self)

        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: abl,
            bufferListSize: listSize,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            blockBufferOut: &blockBuffer)
        guard status == noErr else { return 0 }

        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let bytesPerSample = Int(asbd.mBitsPerChannel) / 8
        let buffers = UnsafeMutableAudioBufferListPointer(abl)
        var peak: Float = 0
        for buffer in buffers {
            guard let raw = buffer.mData else { continue }
            let byteCount = Int(buffer.mDataByteSize)
            if isFloat && bytesPerSample == 4 {
                let count = byteCount / 4
                let ptr = raw.assumingMemoryBound(to: Float.self)
                for i in 0..<count { let v = abs(ptr[i]); if v > peak { peak = v } }
            } else if !isFloat && bytesPerSample == 2 {
                let count = byteCount / 2
                let ptr = raw.assumingMemoryBound(to: Int16.self)
                for i in 0..<count {
                    let v = abs(Float(ptr[i]) / 32768.0)
                    if v > peak { peak = v }
                }
            }
        }
        return peak
    }
}

// ── ScreenCaptureKit (фолбэк) ────────────────────────────────────────────────
@available(macOS 13.0, *)
final class ScreenCaptureKitRecorder: NSObject, SystemAudioCapturer, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var audioInput: AVAssetWriterInput?
    private var sessionStarted = false
    private let queue = DispatchQueue(label: "swarm.recorder.sck")
    private var _firstSampleUptime: Double?
    private let levelTracker = SystemLevelTracker()
    var firstSampleUptime: Double? { queue.sync { _firstSampleUptime } }
    func currentLevel() -> Float { levelTracker.current() }
    // SCK-путь (fallback для <14.4) не имеет watchdog нулей — свойство для соответствия протоколу.
    var onSystemStalled: ((Bool) -> Void)?

    func start(systemURL url: URL) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw SwarmError.transport("no display for audio capture")
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48_000
        cfg.channelCount = 2
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let w = try AVAssetWriter(outputURL: url, fileType: .m4a)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 24_000,
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard w.canAdd(input) else { throw SwarmError.transport("cannot add audio input") }
        w.add(input)
        self.writer = w
        self.audioInput = input

        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        self.stream = s
        try await s.startCapture()
    }

    func stop() async {
        if let s = stream {
            do { try await s.stopCapture() }
            catch { NSLog("SwarmRecorder: stopCapture: \(error.localizedDescription) — финализирую дальше") }
        }
        audioInput?.markAsFinished()
        await writer?.finishWriting()
        levelTracker.reset()
        stream = nil; writer = nil; audioInput = nil; sessionStarted = false
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let w = writer, let input = audioInput else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        // Уровень системной дорожки (для виджета + детекта тишины) — из того же буфера.
        levelTracker.update(rawPeak: SystemLevelTracker.samplePeak(sampleBuffer))
        if !sessionStarted {
            if w.status == .unknown {
                w.startWriting()
                w.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
                sessionStarted = true
                // Якорь первого реального сэмпла системной дорожки (монотонные часы).
                if _firstSampleUptime == nil { _firstSampleUptime = ProcessInfo.processInfo.systemUptime }
            } else { return }
        }
        if input.isReadyForMoreMediaData { input.append(sampleBuffer) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        NSLog("SwarmRecorder: SCStream stopped with error: \(error.localizedDescription)")
    }
}

// ── Core Audio helpers ───────────────────────────────────────────────────────
private extension AudioObjectID {
    static let system = AudioObjectID(kAudioObjectSystemObject)
    var isValid: Bool { self != AudioObjectID(kAudioObjectUnknown) }

    static func translatePIDToProcessObject(_ pid: pid_t) throws -> AudioObjectID {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var q = pid
        var obj = AudioObjectID(kAudioObjectUnknown)
        var sz = UInt32(MemoryLayout<AudioObjectID>.size)
        let err = withUnsafeMutablePointer(to: &q) {
            AudioObjectGetPropertyData(.system, &addr, UInt32(MemoryLayout<pid_t>.size), $0, &sz, &obj)
        }
        guard err == noErr, obj.isValid else { throw SwarmError.transport("translatePID \(err)") }
        return obj
    }

    static func defaultSystemOutputUID() throws -> String {
        var devAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var dev = AudioDeviceID(kAudioObjectUnknown)
        var dsz = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(.system, &devAddr, 0, nil, &dsz, &dev) == noErr else {
            throw SwarmError.transport("default output device")
        }
        var uidAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var cf: CFString = "" as CFString
        var usz = UInt32(MemoryLayout<CFString>.size)
        guard AudioObjectGetPropertyData(dev, &uidAddr, 0, nil, &usz, &cf) == noErr else {
            throw SwarmError.transport("output device UID")
        }
        return cf as String
    }

    // Номинальная частота дефолтного устройства вывода. Меняется, когда Bluetooth-гарнитура
    // переключает профиль на звонке (A2DP 44.1/48к → HFP 16к) — при этом UID устройства НЕ
    // меняется, поэтому смену ловим по частоте, а не по listener'у смены устройства.
    static func defaultOutputNominalSampleRate() throws -> Double {
        var devAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var dev = AudioDeviceID(kAudioObjectUnknown)
        var dsz = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(.system, &devAddr, 0, nil, &dsz, &dev) == noErr else {
            throw SwarmError.transport("default output device (sr)")
        }
        var srAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var sr: Float64 = 0
        var ssz = UInt32(MemoryLayout<Float64>.size)
        guard AudioObjectGetPropertyData(dev, &srAddr, 0, nil, &ssz, &sr) == noErr else {
            throw SwarmError.transport("output nominal sample rate")
        }
        return sr
    }

    func tapStreamASBD() throws -> AudioStreamBasicDescription {
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var f = AudioStreamBasicDescription()
        var sz = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        guard AudioObjectGetPropertyData(self, &addr, 0, nil, &sz, &f) == noErr else {
            throw SwarmError.transport("tap format")
        }
        return f
    }
}

// ── Core Audio process-tap (macOS 14.4+) ─────────────────────────────────────
@available(macOS 14.4, *)
final class ProcessTapSystemRecorder: SystemAudioCapturer {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var file: AVAudioFile?
    // Управляющая очередь: все блокирующие HAL-вызовы (create/destroy tap+aggregate, Start/Stop),
    // device-listener, silence-watchdog и мутация управляющего состояния — строго на ней.
    private let queue = DispatchQueue(label: "swarm.systemtap.control", qos: .userInitiated)
    // IOProc-доставка звука идёт на ОТДЕЛЬНОЙ очереди, НЕ на управляющей. Иначе AudioDeviceStop
    // (на queue) вешает in-flight IOProc в той же serial-очереди → самодедлок HAL (инцидент
    // 2026-07-15: __psynch_mutexwait). С раздельными очередями Stop дожидается колбэка без
    // взаимной блокировки: колбэк доигрывает на ioQueue, Stop ждёт его с queue.
    private let ioQueue = DispatchQueue(label: "swarm.systemtap.io", qos: .userInitiated)
    // Якоря, которые пишет IOProc (ioQueue) и читает управляющая сторона (queue) — под свой lock
    // (раньше синхронизация шла через общую очередь, теперь очередей две).
    private var ioLock = os_unfair_lock()

    // Целевой выходной файл сессии (первый сегмент) и его директория/база для доп.сегментов.
    private var baseURL: URL?
    private var sessionStartUptime: Double?
    private var _firstSampleUptime: Double?
    private var _extraSegments: [(url: URL, offset: Double)] = []
    private var segmentIndex = 0
    private var rebuilding = false
    private var stopped = false
    // Частота устройства вывода на момент сборки тапа. Если она меняется (BT-профиль A2DP↔HFP на
    // звонке) — тап начинает отдавать нули → превентивно пересобираем (см. watchdog). 0 = не собран.
    private var builtDeviceSampleRate: Double = 0

    // Слушатель смены дефолтного устройства вывода (наушники↔динамики↔гарнитура): на смену
    // надо пересоздать тап+агрегат вокруг нового устройства, иначе тап молча даёт тишину.
    private var deviceListenerBlock: AudioObjectPropertyListenerBlock?
    private var deviceAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)

    // Watchdog тишины: если входящие буферы строго 0.0 дольше этого порога, ПОКА идёт реальный
    // созвон, тап завис → форсируем полную пересборку (как при смене устройства).
    private var silenceTimer: DispatchSourceTimer?
    private var lastNonSilentUptime: Double = 0
    private static let silenceRebuildSeconds: Double = 8.0   // 0.0-сигнал дольше → пересборка

    // Honest-signal наружу (AppDelegate): true — собеседник не пишется и авто-пересборки не
    // помогли; false — звук вернулся. Чтобы «не терять собеседника молча» (инцидент 2026-07-15).
    var onSystemStalled: ((Bool) -> Void)?
    private var stalledSignaled = false
    private var consecutiveSilentRebuilds = 0
    private static let rebuildsBeforeStallSignal = 2   // столько пересборок без звука → сигнал
    private static let stallLevelEpsilon: Float = 0.001   // выше — считаем, что звук реально идёт

    // Уровень системной дорожки (собеседники). Обновляется в IOProc-блоке (off-main), читается
    // из main (виджет/детект тишины) под собственным lock — не блокирует аудио-очередь.
    private let levelTracker = SystemLevelTracker()

    var firstSampleUptime: Double? { withIOLock { _firstSampleUptime } }
    var extraSegments: [(url: URL, offset: Double)] { queue.sync { _extraSegments } }
    func currentLevel() -> Float { levelTracker.current() }

    // Доступ к якорям, разделяемым между IOProc (ioQueue) и управляющей стороной (queue).
    private func withIOLock<T>(_ body: () -> T) -> T {
        os_unfair_lock_lock(&ioLock); defer { os_unfair_lock_unlock(&ioLock) }
        return body()
    }

    func start(systemURL: URL) async throws {
        // Блокирующая инициализация HAL — на dedicated queue (не на вызывающем потоке).
        try await withQueue {
            self.baseURL = systemURL
            self.stopped = false
            self.sessionStartUptime = ProcessInfo.processInfo.systemUptime
            self.withIOLock { self.lastNonSilentUptime = self.sessionStartUptime ?? 0 }
            try self.buildTapLocked(outURL: systemURL)
        }
        installDeviceListener()
        startSilenceWatchdog()
    }

    func stop() async {
        stopSilenceWatchdog()
        removeDeviceListener()
        await withQueueNoThrow {
            self.stopped = true
            self.teardownLocked()
            self.baseURL = nil
        }
    }

    deinit {
        // Аварийный путь (объект уничтожен без stop()): синхронный teardown на queue.
        queue.sync { self.teardownLocked() }
    }

    // ── Построение/разрушение тапа (всё на queue) ─────────────────────────────
    // Создаёт tap+aggregate+IOProc и пишет в outURL. Должно вызываться только на `queue`.
    private func buildTapLocked(outURL: URL) throws {
        // 1. свой процесс → AudioObjectID, глобальный тап МИНУС себя
        let me = try AudioObjectID.translatePIDToProcessObject(getpid())
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [me])
        desc.uuid = UUID()
        desc.name = "SwarmRecorder"
        desc.muteBehavior = .unmuted
        // НЕ приватный: приватный тап виден только своему процессу → macOS не регистрирует
        // приложение в «System Audio Recording Only» и может не показать промпт. Не-приватный
        // (как у Granola) → система сама добавляет SwarmRecorder в список разрешений + спросит доступ.
        desc.isPrivate = false

        // 2. создать тап
        var t = AudioObjectID(kAudioObjectUnknown)
        guard AudioHardwareCreateProcessTap(desc, &t) == noErr, t.isValid else {
            throw SwarmError.transport("AudioHardwareCreateProcessTap")
        }
        tapID = t

        // 3. формат тапа ДО агрегата
        var asbd = try tapID.tapStreamASBD()
        guard let inFmt = AVAudioFormat(streamDescription: &asbd) else {
            throw SwarmError.transport("tap AVAudioFormat")
        }

        // 4. приватный агрегат вокруг дефолтного output + наш tap
        let outUID = try AudioObjectID.defaultSystemOutputUID()
        // Зафиксировать частоту устройства — watchdog сверяет с ней и пересобирает при смене (BT-профиль).
        builtDeviceSampleRate = (try? AudioObjectID.defaultOutputNominalSampleRate()) ?? 0
        let dict: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Swarm-Tap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapDriftCompensationKey: true,
                kAudioSubTapUIDKey: desc.uuid.uuidString,
            ]],
        ]
        var a = AudioObjectID(kAudioObjectUnknown)
        guard AudioHardwareCreateAggregateDevice(dict as CFDictionary, &a) == noErr, a.isValid else {
            throw SwarmError.transport("AudioHardwareCreateAggregateDevice")
        }
        aggID = a

        // 5. AAC m4a — тот же выход, что у SCK-ветки. Битрейт см. ниже.
        file = try AVAudioFile(
            forWriting: outURL,
            settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: inFmt.sampleRate,
                AVNumberOfChannelsKey: inFmt.channelCount,
                // AAC @ 48кГц требует ≥32 kbps/канал (см. историю): стерео@<32k роняло AVAudioFile.
                AVEncoderBitRateKey: max(32_000, Int(inFmt.channelCount) * 32_000),
            ],
            commonFormat: .pcmFormatFloat32,
            interleaved: inFmt.isInterleaved)

        // 6. IOProc + старт. Блок звука доставляется на ioQueue (НЕ на управляющей queue — иначе
        // Stop самодедлочится). Считаем peak (watchdog тишины) и пишем в файл.
        var p: AudioDeviceIOProcID?
        let err = AudioDeviceCreateIOProcIDWithBlock(&p, aggID, ioQueue) { [weak self] _, inData, _, _, _ in
            guard let self else { return }
            // Якорь первого сэмпла сессии (один раз за всю запись) — под ioLock (читает queue-сторона).
            self.withIOLock { if self._firstSampleUptime == nil { self._firstSampleUptime = ProcessInfo.processInfo.systemUptime } }
            // self.file ставится в buildTapLocked ДО AudioDeviceStart и обнуляется в teardownLocked
            // ПОСЛЕ AudioDeviceStop — Core Audio гарантирует, что IOProc не вызывается вне [Start, Stop],
            // поэтому доступ к file здесь безопасен без отдельного lock.
            guard let f = self.file,
                  let buf = AVAudioPCMBuffer(pcmFormat: inFmt, bufferListNoCopy: inData, deallocator: nil) else { return }
            let peak = SystemLevelTracker.bufferPeak(buf)
            self.levelTracker.update(rawPeak: peak)   // живой уровень собеседников
            if peak > 0 { self.withIOLock { self.lastNonSilentUptime = ProcessInfo.processInfo.systemUptime } }
            try? f.write(from: buf)
        }
        guard err == noErr, let proc = p else { throw SwarmError.transport("AudioDeviceCreateIOProcIDWithBlock \(err)") }
        procID = proc
        guard AudioDeviceStart(aggID, proc) == noErr else { throw SwarmError.transport("AudioDeviceStart") }
    }

    // Полный LIFO-teardown (идемпотентно). Только на `queue`.
    private func teardownLocked() {
        if aggID.isValid, let p = procID { AudioDeviceStop(aggID, p) }
        if aggID.isValid, let p = procID { AudioDeviceDestroyIOProcID(aggID, p) }
        procID = nil
        file = nil // финализирует m4a (moov-атом)
        if aggID.isValid { AudioHardwareDestroyAggregateDevice(aggID); aggID = AudioObjectID(kAudioObjectUnknown) }
        if tapID.isValid { AudioHardwareDestroyProcessTap(tapID); tapID = AudioObjectID(kAudioObjectUnknown) }
        levelTracker.reset()
    }

    // Полная пересборка: teardown текущего тапа + новый сегмент-файл + новый тап. На `queue`.
    // Триггеры: смена устройства вывода; зависшая тишина при активном созвоне.
    private func rebuildLocked(reason: String) {
        guard !stopped, !rebuilding, let base = baseURL, let start = sessionStartUptime else { return }
        rebuilding = true
        defer { rebuilding = false }
        NSLog("SwarmRecorder: системный тап — пересборка (\(reason))")
        teardownLocked()

        segmentIndex += 1
        let seg = base.deletingPathExtension()
            .appendingPathExtension("seg\(segmentIndex).m4a")
        let offset = ProcessInfo.processInfo.systemUptime - start
        do {
            try buildTapLocked(outURL: seg)
            _extraSegments.append((url: seg, offset: max(0, offset)))
            withIOLock { lastNonSilentUptime = ProcessInfo.processInfo.systemUptime }  // не пересобирать сразу снова
        } catch {
            NSLog("SwarmRecorder: пересборка тапа не удалась (\(error)) — сегмент \(segmentIndex) пропущен")
        }
    }

    // ── Слушатель смены устройства вывода ─────────────────────────────────────
    private func installDeviceListener() {
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            guard let self else { return }
            self.queue.async { self.rebuildLocked(reason: "сменилось устройство вывода") }
        }
        deviceListenerBlock = block
        AudioObjectAddPropertyListenerBlock(.system, &deviceAddr, queue, block)
    }

    private func removeDeviceListener() {
        if let block = deviceListenerBlock {
            AudioObjectRemovePropertyListenerBlock(.system, &deviceAddr, queue, block)
            deviceListenerBlock = nil
        }
    }

    // ── Watchdog тишины ───────────────────────────────────────────────────────
    private func startSilenceWatchdog() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 2, repeating: 2)
        t.setEventHandler { [weak self] in
            guard let self, !self.stopped, !self.rebuilding else { return }

            // (0) Реальный звук собеседника идёт → всё здорово: сбросить счётчики; если раньше
            // сигналили «не пишется» — снять сигнал (звук вернулся).
            if self.levelTracker.current() > Self.stallLevelEpsilon {
                self.consecutiveSilentRebuilds = 0
                if self.stalledSignaled { self.stalledSignaled = false; self.onSystemStalled?(false) }
                return
            }

            // (1) Смена формата устройства (BT-профиль A2DP↔HFP) → превентивная пересборка, не
            // дожидаясь нулей: тап на старом формате всё равно скоро отдаст тишину. UID при этом
            // не меняется, поэтому обычный device-listener это не ловит.
            if self.builtDeviceSampleRate > 0,
               let cur = try? AudioObjectID.defaultOutputNominalSampleRate(),
               abs(cur - self.builtDeviceSampleRate) > 1 {
                self.rebuildLocked(reason: "смена формата устройства \(Int(self.builtDeviceSampleRate))→\(Int(cur))Гц")
                return
            }

            // (2) Тишина дольше порога при РЕАЛЬНОМ созвоне (в простое тишина — норма) → тап,
            // вероятно, завис/умер → полная пересборка (попытка авто-восстановления).
            let last = self.withIOLock { self.lastNonSilentUptime }
            let silentFor = ProcessInfo.processInfo.systemUptime - last
            guard silentFor >= Self.silenceRebuildSeconds, CallDetector.realCallActive() else { return }
            self.rebuildLocked(reason: "тишина \(Int(silentFor))с при активном созвоне")
            self.consecutiveSilentRebuilds += 1

            // (3) Пересборки подряд не вернули звук → честно сигналим пользователю (один раз).
            if self.consecutiveSilentRebuilds >= Self.rebuildsBeforeStallSignal, !self.stalledSignaled {
                self.stalledSignaled = true
                self.onSystemStalled?(true)
            }
        }
        t.resume()
        silenceTimer = t
    }

    private func stopSilenceWatchdog() {
        silenceTimer?.cancel()
        silenceTimer = nil
    }

    // ── Утилиты ───────────────────────────────────────────────────────────────
    // (Пик буфера вынесен в SystemLevelTracker.bufferPeak — общий для обоих путей захвата.)

    // Выполнить блокирующую работу на `queue`, проброс throw наружу через continuation.
    private func withQueue(_ work: @escaping () throws -> Void) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            queue.async {
                do { try work(); cont.resume() }
                catch { cont.resume(throwing: error) }
            }
        }
    }

    private func withQueueNoThrow(_ work: @escaping () -> Void) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            queue.async { work(); cont.resume() }
        }
    }
}
