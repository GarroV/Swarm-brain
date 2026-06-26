import Foundation
import AVFoundation

// Захват ДВУХ дорожек одной сессии:
//   • системный звук (собеседники) — через SystemAudioCapturer:
//       macOS 14.4+ → Core Audio process-tap; ниже → ScreenCaptureKit. Оба → AAC .m4a.
//   • микрофон (локальный юзер)     — AVAudioRecorder → AAC .m4a
// Сведение НЕ на клиенте: оба файла уходят на сервер, он транскрибирует каждый и сводит
// сегменты по таймстампам с метками «собеседник»/«я».
@available(macOS 13.0, *)
final class AudioRecorder: NSObject {
    // micStartOffset — сдвиг первого реального сэмпла mic относительно system (сек):
    //   micFirst − systemFirst. nil, если одной из дорожек нет первого сэмпла (mic не писался,
    //   или система так и не выдала буфер). Сервер прибавит его к таймстампам mic при сведении.
    // systemSegments — доп. файлы системной дорожки сверх `system` (после пересборок тапа при
    //   смене устройства/зависшей тишине), каждый со своим offset (сек от старта сессии).
    //   В обычном сценарии пусто. system всегда имеет offset 0.
    struct Result {
        let system: URL
        let mic: URL?
        let micStartOffset: Double?
        let systemSegments: [(url: URL, offset: Double)]
    }

    private var systemCapturer: SystemAudioCapturer?
    private var micRecorder: AVAudioRecorder?
    private var systemURL: URL?
    private var micURL: URL?
    private var micActive = false

    // Текущий уровень входа микрофона, нормализованный в 0…1 (для живого индикатора в виджете).
    // 0, если запись не идёт / mic недоступен. averagePower даёт dBFS (≈ −160…0); −50 dB берём
    // за тишину, 0 dB — за максимум, между ними линейно по dB (достаточно для визуальной полосы).
    func currentMicLevel() -> Float {
        guard micActive, let rec = micRecorder, rec.isRecording else { return 0 }
        rec.updateMeters()
        let db = rec.averagePower(forChannel: 0)
        let floorDb: Float = -50
        if db <= floorDb { return 0 }
        if db >= 0 { return 1 }
        return (db - floorDb) / (0 - floorDb)
    }

    // Текущий уровень СИСТЕМНОЙ дорожки (собеседники/коллеги), нормализованный 0…1.
    // 0, если захват не идёт. Питает: (1) вторую полосу уровня в виджете,
    // (2) детект конца браузерного звонка по затяжной тишине системной дорожки (AppDelegate).
    func currentSystemLevel() -> Float {
        systemCapturer?.currentLevel() ?? 0
    }

    // Монотонные якоря первого РЕАЛЬНОГО сэмпла каждой дорожки (один источник времени —
    // ProcessInfo.systemUptime, не настенные часы; невосприимчив к коррекции NTP/сна).
    //   • mic   — берём сразу после успешного rec.record()==true (AVAudioRecorder начинает писать).
    //   • system— первый непустой буфер тапа / первый didOutputSampleBuffer SCK (см. SystemAudioCapturer).
    private var micFirstSampleUptime: Double?

    // Старт обеих дорожек. ВАЖНО: система СНАЧАЛА — если она не поднялась (нет доступа/HAL),
    // не запускаем микрофон, чтобы не остался «осиротевший» mic-файл без системного звука.
    // Микрофон — best-effort: его сбой не валит запись (mic = nil в результате).
    func start(systemURL: URL, micURL: URL) async throws {
        self.systemURL = systemURL
        self.micURL = micURL
        micFirstSampleUptime = nil
        try? FileManager.default.removeItem(at: systemURL)
        try? FileManager.default.removeItem(at: micURL)

        // 1) Система первой. Бросит → запись не началась, mic не трогали.
        let cap = makeSystemCapturer()
        try await cap.start(systemURL: systemURL)
        self.systemCapturer = cap

        // 2) Только теперь — микрофон (best-effort).
        try startMicBestEffort(to: micURL)
    }

    func stop() async throws -> Result {
        guard let sysURL = systemURL else {
            throw SwarmError.transport("recorder not started")
        }
        // Якорь первого системного сэмпла снимаем ДО stop() (capturer ещё жив).
        let systemFirst = systemCapturer?.firstSampleUptime
        // Системная дорожка — финализируется внутри capturer (best-effort, не бросает).
        await systemCapturer?.stop()
        // extraSegments читаем ПОСЛЕ stop() — финализация дописывает последний сегмент.
        let extraSegments = systemCapturer?.extraSegments ?? []
        systemCapturer = nil

        // микрофон
        var resultMic: URL? = nil
        if micActive, let rec = micRecorder, let mURL = micURL {
            rec.stop()
            micRecorder = nil
            micActive = false
            if let attrs = try? FileManager.default.attributesOfItem(atPath: mURL.path),
               let size = attrs[.size] as? Int, size > 1024 {
                resultMic = mURL
            }
        }

        // Сдвиг mic относительно system: оба якоря в одной шкале (ProcessInfo.systemUptime).
        // Считаем только если есть mic-файл И оба якоря известны — иначе сервер сведёт без сдвига.
        var offset: Double? = nil
        if resultMic != nil, let micFirst = micFirstSampleUptime, let sysFirst = systemFirst {
            offset = micFirst - sysFirst
        }

        systemURL = nil
        micURL = nil
        micFirstSampleUptime = nil
        // Первый сегмент = sysURL (offset 0), затем доп. сегменты в порядке появления.
        let segments = [(url: sysURL, offset: 0.0)] + extraSegments
        return Result(system: sysURL, mic: resultMic, micStartOffset: offset, systemSegments: segments)
    }

    // ── Микрофон через AVAudioRecorder (простой надёжный путь) ───────────────────
    private func startMicBestEffort(to url: URL) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,           // 16 кГц моно — достаточно для речи и Whisper
            AVNumberOfChannelsKey: 1,
            // 32 kbps вместо 24: на 16 кГц моно AAC@24k заметно «булькает» на тихой речи,
            // 32k даёт ощутимо чище разборчивость для транскрибации при том же 16 кГц/моно.
            AVEncoderBitRateKey: 32_000,
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            // Метеринг для живого индикатора уровня в виджете (averagePower(forChannel:)).
            rec.isMeteringEnabled = true
            if rec.record() {
                // Якорь: rec.record()==true → AVAudioRecorder начал писать прямо сейчас.
                micFirstSampleUptime = ProcessInfo.processInfo.systemUptime
                micRecorder = rec
                micActive = true
            } else {
                NSLog("SwarmRecorder: mic record() вернул false (нет доступа?) — пишем только систему")
            }
        } catch {
            NSLog("SwarmRecorder: микрофон недоступен (\(error)) — пишем только систему")
        }
    }
}
