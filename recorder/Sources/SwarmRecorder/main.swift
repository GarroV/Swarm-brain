import AppKit
import AVFoundation
import Foundation

// Режим --selftest: headless-проверка захвата системного звука без меню-бара.
// Пишет ~6с, параллельно проигрывая клип через afplay, печатает размер файла.
func runSelfTest() {
    let tmp = FileManager.default.temporaryDirectory
    let sysURL = tmp.appendingPathComponent("swarm-selftest-sys.m4a")
    let micURL = tmp.appendingPathComponent("swarm-selftest-mic.m4a")
    let rec = AudioRecorder()
    Task {
        do {
            NSLog("selftest: запускаю захват…")
            try await rec.start(systemURL: sysURL, micURL: micURL)

            // Источник системного звука для захвата.
            let clip = FileManager.default.fileExists(atPath: "/tmp/e2e.m4a")
                ? "/tmp/e2e.m4a" : "/System/Library/Sounds/Glass.aiff"
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
            p.arguments = [clip]
            try? p.run()

            try await Task.sleep(nanoseconds: 6_000_000_000)
            if p.isRunning { p.terminate() }

            let res = try await rec.stop()
            func sz(_ u: URL) -> Int { ((try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? Int) ?? 0 }
            print("SELFTEST_CAPTURE system=\(sz(res.system)) mic=\(res.mic.map { String(sz($0)) } ?? "none")")
            NSLog("selftest: захват готов, system=\(sz(res.system)) mic=\(res.mic != nil)")

            // Полный цикл (если есть config.json): claim + загрузка своим же SwarmClient.
            if let cfg = try? SwarmConfig.load() {
                let client = SwarmClient(config: cfg)
                let now = ISO8601DateFormatter().string(from: Date())
                let req = ClaimRequest(
                    identityKind: .manual,
                    identityKey: "manual:selftest-\(UUID().uuidString)",
                    title: "Selftest захват",
                    startedAt: now, endedAt: now, agentVersion: "0.1.0-selftest"
                )
                let claim = try await client.claim(req)
                print("SELFTEST_CLAIM meeting_id=\(claim.meetingId) decision=\(claim.decision)")
                if claim.shouldTranscribe {
                    let sysParts = try await Segmenter.segment(res.system)
                    var micParts: [AudioPart] = []
                    if let micURL = res.mic { micParts = try await Segmenter.segment(micURL, allowEmpty: true) }
                    let ing = try await client.uploadAudio(meetingID: claim.meetingId, system: sysParts, mic: micParts)
                    print("SELFTEST_UPLOAD meeting_id=\(claim.meetingId) status=\(ing.summaryStatus ?? "?")")
                }
            } else {
                print("SELFTEST_NOCONFIG (только захват, без отправки)")
            }
            exit(0)
        } catch {
            print("SELFTEST_ERROR \(error)")
            NSLog("selftest: ОШИБКА \(error)")
            exit(1)
        }
    }
    RunLoop.main.run()
}

// Режим --selftest-quarantine: смоук спасательного пути для ОТКЛОНЁННОЙ записи (decision=defer).
// До 17.08.2026 такая запись просто удалялась с диска (инцидент: испарилось 2ч26м), поэтому путь
// «отказ → карантин → дослать вручную» обязан быть проверяемым, а не «по коду должно работать».
// Гоняет НАСТОЯЩИЙ UploadQueue на синтетических файлах и убирает за собой.
func runQuarantineSelfTest() {
    Task {
        let fm = FileManager.default
        let meetingId = "selftest-\(UUID().uuidString)"
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SwarmRecorder", isDirectory: true)
        // Имитируем durable-папку записи: два системных сегмента + микрофон.
        let recDir = support.appendingPathComponent("recording", isDirectory: true)
            .appendingPathComponent(meetingId, isDirectory: true)
        try? fm.createDirectory(at: recDir, withIntermediateDirectories: true)
        let payload = Data(repeating: 0x41, count: 4096)
        let segs: [(url: URL, offset: Double)] = [
            (recDir.appendingPathComponent("sys0.m4a"), 0),
            (recDir.appendingPathComponent("sys1.m4a"), 300)
        ]
        for s in segs { try? payload.write(to: s.url) }
        let mic = recDir.appendingPathComponent("mic.m4a")
        try? payload.write(to: mic)

        let iso = ISO8601DateFormatter().string(from: Date())
        var failures = 0
        func check(_ cond: Bool, _ what: String) {
            print("\(cond ? "  ok  " : "  FAIL") \(what)")
            if !cond { failures += 1 }
        }

        do {
            try await UploadQueue.shared.quarantineDeferred(
                meetingId: meetingId, systemSegments: segs, micURL: mic,
                micStartOffset: 0.01, startISO: iso, endISO: iso,
                // Ключ встречи для перезаявки. SWARM_SELFTEST_KEY (календарный ключ, заранее
                // занятый короткой записью) даёт проверить именно ПЕРЕХВАТ; без него — manual,
                // который дедупа не знает и перехват не проверяет.
                claimRetry: PendingUpload.ClaimRetry(
                    identityKind: ProcessInfo.processInfo.environment["SWARM_SELFTEST_KEY"] != nil ? "calendar" : "manual",
                    identityKey: ProcessInfo.processInfo.environment["SWARM_SELFTEST_KEY"] ?? "manual:\(meetingId)",
                    title: "Selftest карантин", startedAt: iso, endedAt: iso, recordedSeconds: 8785))
        } catch {
            print("  FAIL карантин бросил: \(error)"); exit(1)
        }
        let failedDir = support.appendingPathComponent("failed", isDirectory: true)
            .appendingPathComponent(meetingId, isDirectory: true)
        check(fm.fileExists(atPath: failedDir.appendingPathComponent("sys0.m4a").path)
              && fm.fileExists(atPath: failedDir.appendingPathComponent("sys1.m4a").path)
              && fm.fileExists(atPath: failedDir.appendingPathComponent("mic.m4a").path),
              "аудио переехало в failed/<id>/ (а не удалено)")
        check(fm.fileExists(atPath: failedDir.appendingPathComponent("meta.json").path),
              "сайдкар meta.json на месте (иначе sweepExpired и дослать не смогут)")
        check(!fm.fileExists(atPath: segs[0].url.path), "исходники из durable-папки убраны (не дубль)")
        let listed = await UploadQueue.shared.deferredIds()
        check(listed.contains(meetingId), "запись видна в deferredIds() → пункт меню «Дослать мою запись»")

        // Дослать при мёртвой сети: перезаявка не проходит → аудио ОБЯЗАНО остаться в карантине.
        // Раньше файлы переезжали в pending/ до получения права — а ingest без claim отбивает 403,
        // и запись зависала в очереди навсегда.
        let deadCfg = SwarmConfig(token: "selftest", ingestBaseURL: "http://127.0.0.1:1", webBaseURL: "")
        let pendingDir = support.appendingPathComponent("pending", isDirectory: true)
            .appendingPathComponent(meetingId, isDirectory: true)
        switch await UploadQueue.shared.resendDeferred(meetingId, config: deadCfg) {
        case .failed: check(true, "сеть недоступна → честный .failed (не молчаливый успех)")
        case .sent: check(false, "заявила об отправке при мёртвой сети")
        case .stillDeferred: check(false, "перепутала отказ сервера с отказом сети")
        }
        check(fm.fileExists(atPath: failedDir.appendingPathComponent("sys0.m4a").path),
              "аудио осталось в карантине (не переехало в pending/ без полученного права)")
        check(await UploadQueue.shared.deferredIds().contains(meetingId),
              "флаг deferred на месте → пункт меню не исчез, можно повторить позже")

        // Полный путь «отказ → перехват → отправка» проверяется против ЖИВОГО сервера, когда он
        // задан: SWARM_SELFTEST_URL + SWARM_SELFTEST_TOKEN (локальный контур из test-claim.sh).
        let env = ProcessInfo.processInfo.environment
        if let liveURL = env["SWARM_SELFTEST_URL"], let liveToken = env["SWARM_SELFTEST_TOKEN"] {
            let liveCfg = SwarmConfig(token: liveToken, ingestBaseURL: liveURL, webBaseURL: "")
            let outcome = await UploadQueue.shared.resendDeferred(meetingId, config: liveCfg)
            switch outcome {
            case .sent, .failed:
                // .failed допустим: локально выключен storage, ingest падает на записи файлов.
                // Важно другое — что перезаявка ПРОШЛА и папка уехала из карантина.
                check(!(await UploadQueue.shared.deferredIds().contains(meetingId)),
                      "живой сервер: право получено, запись вышла из карантина")
            case .stillDeferred(let holder):
                check(false, "живой сервер отказал (держит \(holder ?? "?")) — перехват не сработал")
            }
        } else {
            print("  skip живой прогон перезаявки (нет SWARM_SELFTEST_URL/SWARM_SELFTEST_TOKEN)")
        }

        // Уборка за собой.
        try? fm.removeItem(at: pendingDir)
        try? fm.removeItem(at: failedDir)
        try? fm.removeItem(at: recDir)
        print(failures == 0 ? "SELFTEST_QUARANTINE OK" : "SELFTEST_QUARANTINE FAILED (\(failures))")
        exit(failures == 0 ? 0 : 1)
    }
    RunLoop.main.run()
}

// Режим --selftest-notes: показать панель заметок с ПОДСТАВНЫМ контекстом «С прошлого раза»
// (issue #226). Нужен, чтобы проверить вёрстку блока в узких 312 pt до того, как функция
// meeting-context раскатана: без него единственный способ увидеть блок — живая запись после
// раскатки, то есть проверка после факта.
//   --selftest-notes            свёрнутое превью
//   --selftest-notes --keep N   держать N секунд
func runNotesSelfTest(seconds: Double) {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)

    let cfg = SwarmConfig(token: "selftest", ingestBaseURL: "http://127.0.0.1:1", webBaseURL: "https://swarm-brain.pages.dev")
    Task { @MainActor in
        // Панель — main-actor: и берём, и трогаем её ТОЛЬКО отсюда, иначе Swift 6 это запретит.
        let panel = LiveNotesPanel.shared
        await panel.show(config: cfg, initialTitle: "Dodo Pizza Bulgaria",
                         micLevel: { 0.2 }, systemLevel: { 0.1 },
                         onStop: { exit(0) }, onCollapse: {})
        // Данные — как их отдаёт meeting-context для реального созвона с Болгарией
        // (проверено на проде: встреча 02.09, задачи «Посмотреть рейтинги Болгарии» и
        // «Трекер задач Болгарии»).
        panel.setContext(MeetingContext(
            country: "BG",
            meeting: .init(entry_id: "048f3a55-7f3f-431d-ad0e-7a88b51f60b4",
                           title: "Dodo Pizza Bulgaria",
                           date: "2026-09-02",
                           sections: ["Болгария", "Персонал", "Решения и договорённости"],
                           bullets: ["Бургас: не хватает курьеров, спрос выше мощностей",
                                     "Тематическая коробка: продажи планируются 35 дней",
                                     "Контакт-центр: предложено объединить страны региона"],
                           total_bullets: 12,
                           full_text: "### Болгария\n- Бургас: не хватает курьеров, спрос выше мощностей\n- Тематическая коробка: продажи планируются 35 дней\n### Персонал\n- Николь второй месяц в команде\n### Решения и договорённости\n- считаем P&L по новой схеме",
                           truncated: false),
            tasks: [
                .init(id: "t1", title: "Посмотреть рейтинги Болгарии", due_date: "2026-09-04", assignees: [], status: "open", source: "country"),
                .init(id: "t2", title: "Трекер задач Болгарии", due_date: nil, assignees: [], status: "in_progress", source: "country"),
            ],
            reason: nil))
        print("selftest-notes: панель показана с подставным контекстом (BG)")
        // Печатаем СОДЕРЖИМОЕ блока, а не только факт показа: свёрнутый вид, затем раскрытый.
        @MainActor func dump(_ tag: String) {
            print("  [\(tag)] высота окна \(Int(panel.panelHeightForTests)) pt, строк \(panel.contextRowsForTests.count):")
            for r in panel.contextRowsForTests { print("    · \(r.replacingOccurrences(of: "\n", with: " ⏎ ").prefix(88))") }
        }
        dump("свёрнуто")
        panel.expandForTests(tezisy: true, tasks: true)
        dump("раскрыто")
        panel.expandForTests(tezisy: false, tasks: false)
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { exit(0) }
    app.run()
}

// Режим --analyze <file.m4a…>: печатает речевые блоки SilenceTrimmer и % экономии Whisper-минут.
// Временный debug для калибровки на реальных записях (сверка со ссылочным ffmpeg-замером).
func runAnalyze(_ files: [String]) {
    Task {
        for path in files {
            let url = URL(fileURLWithPath: path)
            let asset = AVURLAsset(url: url)
            let full = (try? await asset.load(.duration).seconds) ?? 0
            guard let blocks = await SilenceTrimmer.speechBlocks(url) else {
                print("ANALYZE \(url.lastPathComponent): анализ не удался"); continue
            }
            let speech = blocks.reduce(0.0) { $0 + ($1.end - $1.start) }
            let pct = full > 0 ? (1 - speech / full) * 100 : 0
            print(String(format: "ANALYZE %@: полн %.0fс, речь %.0fс, блоков %d → экономия -%.0f%%",
                         url.lastPathComponent, full, speech, blocks.count, pct))
        }
        exit(0)
    }
    RunLoop.main.run()
}

// Режим --selftest-update: смоук пункта меню «Обновить bumblebee». Печатает решение, которое
// приняла бы кнопка (та же Updater.decide), и с флагом --apply реально запускает обновление.
// Без него кнопку нельзя проверить иначе как кликом на живой машине.
func runUpdateSelfTest(apply: Bool) {
    Task {
        let cfg = try? SwarmConfig.load()
        let decision = await Updater.decide(config: cfg, isIdle: true)
        switch decision {
        case .noConfig:            print("SELFTEST_UPDATE decision=no_config")
        case .notInstalled(let p): print("SELFTEST_UPDATE decision=not_installed path=\(p)")
        case .busy:                print("SELFTEST_UPDATE decision=busy")
        case .unreachable:         print("SELFTEST_UPDATE decision=unreachable")
        case .upToDate(let b):     print("SELFTEST_UPDATE decision=up_to_date build=\(b)")
        case .available(let b, let from, let url):
            print("SELFTEST_UPDATE decision=available from=\(from) to=\(b) url=\(url.lastPathComponent)")
            if apply {
                Updater.runUpdater(currentBuild: from, targetBuild: b, assetURL: url)
                print("SELFTEST_UPDATE applied=yes (хелпер запущен, приложение перезапустится)")
            }
        }
        exit(0)
    }
    RunLoop.main.run()
}

if CommandLine.arguments.contains("--selftest-notes") {
    let keep = CommandLine.arguments.firstIndex(of: "--keep").flatMap { i -> Double? in
        i + 1 < CommandLine.arguments.count ? Double(CommandLine.arguments[i + 1]) : nil
    }
    runNotesSelfTest(seconds: keep ?? 30)
} else if let ai = CommandLine.arguments.firstIndex(of: "--analyze") {
    runAnalyze(Array(CommandLine.arguments[(ai + 1)...]))
} else if CommandLine.arguments.contains("--selftest-update") {
    runUpdateSelfTest(apply: CommandLine.arguments.contains("--apply"))   // не возвращается до exit()
} else if CommandLine.arguments.contains("--selftest-quarantine") {
    runQuarantineSelfTest()   // не возвращается (RunLoop) до exit()
} else if CommandLine.arguments.contains("--selftest") {
    runSelfTest()   // не возвращается (RunLoop) до exit()
} else {
    // Меню-бар агент: без иконки в Dock, без главного окна.
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
