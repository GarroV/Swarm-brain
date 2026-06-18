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
protocol SystemAudioCapturer: AnyObject {
    func start(systemURL: URL) async throws
    func stop() async
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
    private let queue = DispatchQueue(label: "swarm.systemtap", qos: .userInitiated)

    func start(systemURL: URL) async throws {
        // 1. свой процесс → AudioObjectID, глобальный тап МИНУС себя
        let me = try AudioObjectID.translatePIDToProcessObject(getpid())
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [me])
        desc.uuid = UUID()
        desc.muteBehavior = .unmuted
        desc.isPrivate = true

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

        // 5. AAC m4a — тот же выход, что у SCK-ветки.
        // Битрейт 24 kbps (как у микрофона и SCK): Whisper всё равно ресемплит в 16 кГц,
        // а 25 МБ-лимит OpenAI при 24 kbps достигается лишь к ~2,4 ч (при 128 kbps — уже к ~27 мин,
        // из-за чего нормальные встречи ловили ложную «ошибку про 2,3 ч»).
        file = try AVAudioFile(
            forWriting: systemURL,
            settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: inFmt.sampleRate,
                AVNumberOfChannelsKey: inFmt.channelCount,
                AVEncoderBitRateKey: 24_000,
            ],
            commonFormat: .pcmFormatFloat32,
            interleaved: inFmt.isInterleaved)

        // 6. IOProc + старт
        var p: AudioDeviceIOProcID?
        let err = AudioDeviceCreateIOProcIDWithBlock(&p, aggID, queue) { [weak self] _, inData, _, _, _ in
            guard let self, let f = self.file,
                  let buf = AVAudioPCMBuffer(pcmFormat: inFmt, bufferListNoCopy: inData, deallocator: nil) else { return }
            try? f.write(from: buf)
        }
        guard err == noErr, let proc = p else { throw SwarmError.transport("AudioDeviceCreateIOProcIDWithBlock \(err)") }
        procID = proc
        guard AudioDeviceStart(aggID, proc) == noErr else { throw SwarmError.transport("AudioDeviceStart") }
    }

    func stop() async {
        // строгий LIFO; всё идемпотентно
        if aggID.isValid, let p = procID { AudioDeviceStop(aggID, p) }
        if aggID.isValid, let p = procID { AudioDeviceDestroyIOProcID(aggID, p); procID = nil }
        file = nil // финализирует m4a (moov-атом)
        if aggID.isValid { AudioHardwareDestroyAggregateDevice(aggID); aggID = AudioObjectID(kAudioObjectUnknown) }
        if tapID.isValid { AudioHardwareDestroyProcessTap(tapID); tapID = AudioObjectID(kAudioObjectUnknown) }
    }

    deinit {
        if aggID.isValid, let p = procID { AudioDeviceStop(aggID, p); AudioDeviceDestroyIOProcID(aggID, p) }
        if aggID.isValid { AudioHardwareDestroyAggregateDevice(aggID) }
        if tapID.isValid { AudioHardwareDestroyProcessTap(tapID) }
    }
}
