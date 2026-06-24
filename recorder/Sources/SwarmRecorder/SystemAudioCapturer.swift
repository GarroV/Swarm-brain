import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreAudio
import AudioToolbox
import CoreMedia

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
}

extension SystemAudioCapturer {
    var extraSegments: [(url: URL, offset: Double)] { [] }
}

func makeSystemCapturer() -> SystemAudioCapturer {
    if #available(macOS 14.4, *) { return ProcessTapSystemRecorder() }
    return ScreenCaptureKitRecorder()
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
    var firstSampleUptime: Double? { queue.sync { _firstSampleUptime } }

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
        stream = nil; writer = nil; audioInput = nil; sessionStarted = false
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let w = writer, let input = audioInput else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
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
    // Все блокирующие HAL-вызовы (create/destroy tap+aggregate, IOProc start/stop) и доступ к
    // изменяемому состоянию — строго на этой очереди. IOProc-блок звука тоже шлёт на неё.
    private let queue = DispatchQueue(label: "swarm.systemtap", qos: .userInitiated)

    // Целевой выходной файл сессии (первый сегмент) и его директория/база для доп.сегментов.
    private var baseURL: URL?
    private var sessionStartUptime: Double?
    private var _firstSampleUptime: Double?
    private var _extraSegments: [(url: URL, offset: Double)] = []
    private var segmentIndex = 0
    private var rebuilding = false
    private var stopped = false

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

    var firstSampleUptime: Double? { queue.sync { _firstSampleUptime } }
    var extraSegments: [(url: URL, offset: Double)] { queue.sync { _extraSegments } }

    func start(systemURL: URL) async throws {
        // Блокирующая инициализация HAL — на dedicated queue (не на вызывающем потоке).
        try await withQueue {
            self.baseURL = systemURL
            self.stopped = false
            self.sessionStartUptime = ProcessInfo.processInfo.systemUptime
            self.lastNonSilentUptime = self.sessionStartUptime ?? 0
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

        // 6. IOProc + старт. Блок звука: считаем RMS/peak (watchdog тишины) и пишем в файл.
        var p: AudioDeviceIOProcID?
        let err = AudioDeviceCreateIOProcIDWithBlock(&p, aggID, queue) { [weak self] _, inData, _, _, _ in
            guard let self else { return }
            // Якорь первого сэмпла сессии (один раз за всю запись).
            if self._firstSampleUptime == nil { self._firstSampleUptime = ProcessInfo.processInfo.systemUptime }
            guard let f = self.file,
                  let buf = AVAudioPCMBuffer(pcmFormat: inFmt, bufferListNoCopy: inData, deallocator: nil) else { return }
            if Self.bufferPeak(buf) > 0 { self.lastNonSilentUptime = ProcessInfo.processInfo.systemUptime }
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
            lastNonSilentUptime = ProcessInfo.processInfo.systemUptime  // не пересобирать сразу снова
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
            let silentFor = ProcessInfo.processInfo.systemUptime - self.lastNonSilentUptime
            // Только при РЕАЛЬНОМ созвоне: тишина в простое — норма, пересобирать не надо.
            guard silentFor >= Self.silenceRebuildSeconds, CallDetector.realCallActive() else { return }
            self.rebuildLocked(reason: "тишина \(Int(silentFor))с при активном созвоне")
        }
        t.resume()
        silenceTimer = t
    }

    private func stopSilenceWatchdog() {
        silenceTimer?.cancel()
        silenceTimer = nil
    }

    // ── Утилиты ───────────────────────────────────────────────────────────────
    // Пиковая амплитуда float32-буфера (0.0 → буфер тишины). Дёшево, без выделений.
    private static func bufferPeak(_ buf: AVAudioPCMBuffer) -> Float {
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
