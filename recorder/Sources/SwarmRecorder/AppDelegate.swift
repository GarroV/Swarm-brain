import AppKit
import AVFoundation
import Foundation
import RecorderKit
import UserNotifications

// Меню-бар приложение. Авто-предложение записи с СОГЛАСИЕМ из двух источников:
//   • Календарь (Google, через сервер meeting-current) — с упреждением «встреча через N мин».
//   • Микрофон (CoreAudio) — запасной детект звонка, если встречи нет в календаре.
// Запись стартует только по явному действию пользователя, никогда молча.
// Идентичность/дедуп: календарное событие → комната из URL браузера → manual.
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem!
    private let recorder = AudioRecorder()
    private let widget = RecorderWidget()

    private var config: SwarmConfig?
    private var configError: String?
    // Типизированные сбои вместо общего .error(String): каждый даёт точный текст «куда идти»
    // в System Settings + кнопку «Повторить». .error(String) остаётся только для по-настоящему
    // непредвиденного (не классифицировали) — чтобы не прятать причину.
    //   • noScreenRecording — нет «Screen Recording» (<14.4, путь ScreenCaptureKit);
    //   • noSystemAudio     — нет «System Audio Recording» (14.4+, Core Audio process-tap);
    //   • noMic             — отказан доступ к микрофону;
    //   • offline           — сеть недоступна (claim/upload не прошли по транспорту);
    //   • tokenExpired      — HTTP 401, токен протух/отозван (ведём в бот /recordertoken).
    private enum State {
        case idle, recording, sending
        case noScreenRecording, noSystemAudio, noMic, offline, tokenExpired
        case error(String)
    }
    private var state: State = .idle
    // Последнее действие записи — чтобы «Повторить» после сбоя разрешений повторило именно его
    // (встреча из календаря / звонок / ручной старт), а не угадывало контекст заново.
    private var lastRecordIdentity: MeetingIdentity.Info?
    private var sysURL: URL?
    private var micURL: URL?
    // Чекпоинты (crash-safe): durable-папка текущей записи, индекс след. sys-сегмента, тик-счётчик ротации.
    private var currentRecDir: URL?
    private var currentRecBase: String?
    private var nextSysIndex = 1
    private var recTickCount = 0
    private static let rotateEveryTicks = 60   // 60 × 5с = 5 мин между чекпоинт-ротациями системной дорожки
    private var recordStartedAt: Date?
    private var identity: MeetingIdentity.Info?
    // Сколько записей ждёт дозагрузки (UploadQueue) — показываем «N в очереди» в меню.
    private var queuedCount = 0
    // Записи, отклонённые сервером (decision=defer) и лежащие в карантине failed/ — их можно
    // дослать руками, пока не истёк трёхсуточный потолок. Меняется только на главном потоке.
    private var deferredMeetingIds: [String] = []

    // ── Сигнал «встреча в обработке» (виджет + уведомление) ──────────────────────
    // Встречи, отправленные на сервер и ещё не подтверждённые как done. Пока непусто —
    // виджет показывает капсулу «в обработке» (крутилка). Меняется только на главном потоке.
    private var processingIds = Set<String>()
    // Кому уже показали уведомление «принято в обработку» (не дублируем на ретраях дрейна).
    private var processingNotified = Set<String>()
    // Короткая вспышка зелёной галки «готово» после done, затем виджет прячется.
    private var processingDoneFlash = false

    // Снятая, но ещё не отправленная запись. Держим её, чтобы «Повторить» ПЕРЕ-ОТПРАВИЛ
    // именно её (claim+enqueue), а не начинал новую запись (раньше так терялось снятое аудио
    // при сбое после stop() до enqueue). Очищается только после успешного enqueue/решения сервера.
    private struct PendingSend {
        let res: AudioRecorder.Result
        let identity: MeetingIdentity.Info?
        let started: Date
        let ended: Date
        let manualKey: String   // стабильный ключ для manual-записи → повтор claim идемпотентен
    }
    private var pendingSend: PendingSend?
    // Поколение отправки: watchdog, взведённый для попытки N, не трогает UI попытки N+1.
    private var sendGeneration = 0
    // Потолок ожидания в «Отправка…»: финализация записи + claim-ретраи могут занять минуты.
    // Ложное срабатывание безопасно — pendingSend сохранён, «Повторить» пере-отправит без потерь.
    private let sendWatchdogSeconds: Double = 150

    // Календарное предложение.
    private var pendingMeeting: MeetingIdentity.Info?
    // Ключ встречи → докуда НЕ предлагать её снова. Раньше был Set без срока → однажды записанная
    // (даже 5-сек тест) встреча подавлялась НАВСЕГДА до перезапуска рекордера: тот же созвон потом
    // не предлагался и терял календарное название. Теперь у подавления есть срок (см. isMeetingDismissed).
    private var dismissedUntil: [String: Date] = [:]
    private let recordedSuppressSeconds: TimeInterval = 20 * 60   // «уже записал» — короткий кулдаун (дозапись/рестарт того же созвона снова предложатся)
    private let dismissMeetingSeconds: TimeInterval = 3 * 3600    // «Не записывать» без известного конца события — на несколько часов
    private var notifiedKeys: Set<String> = []     // по каким уже слали уведомление
    // Микрофонный запасной детект.
    private var callActive = false
    // Разрешены ли уведомления. nil — ещё не спросили систему (первые мгновения после старта):
    // на этом статусе меню молчит, чтобы не пугать человека ложной тревогой.
    private var notificationsAllowed: Bool?
    private var micWasActive = false
    // Маяк присутствия для панели «Встречи сегодня» (issue #218): что мы уже рассказали
    // серверу и когда. Логика «пора или нет» — RecorderKit.PresenceBeacon.
    private var presenceSent: PresenceBeacon.State?
    private var presenceSentAt: Date?
    private var callDismissedUntil: Date?
    private var watchTimer: Timer?
    private var maintTimer: Timer?
    // Авто-стоп по концу звонка (per-process детект во время записи).
    private var recWatchTimer: Timer?
    private var callSeenDuringRec = false
    private var silentTicks = 0
    // Тики подряд, когда НИКТО не звучит: ни системная дорожка (собеседники), ни СВОЙ микрофон.
    // Считается независимо от mic-детекта занятости: ловит конец БРАУЗЕРНОГО звонка (Google Meet /
    // Контур.Толк во вкладке), где браузер держит микрофон непрерывно даже после выхода.
    // Инцидент 2026-07-24: правило слушало ТОЛЬКО собеседников → монолог владельца (собеседники
    // молча слушают) выглядел как «тишина» и рубил запись посреди созвона. Теперь «тихий тик» =
    // тихи ОБЕ дорожки, и уровни берутся пиком за интервал (не точечным сэмплом раз в 5с).
    private var systemSilentTicks = 0
    // Порог «тишины» системной дорожки 0…1: ниже него считаем, что собеседников не слышно.
    private static let systemSilenceLevel: Float = 0.02
    // Порог «тишины» СВОЕГО микрофона 0…1 (currentMicLevel: averagePower, пол −50дБ). Выше
    // системного: мик физически рядом и ловит фоновый шум комнаты; калибровка — по dbg-логу
    // живого прогона (micPeak в тиках).
    private static let micSilenceLevel: Float = 0.12
    // Сколько тихих тиков (5с каждый) ОБЕИХ дорожек = конец звонка. 36 ≈ 3 мин непрерывной
    // тишины — в живом созвоне такое почти не встречается; компромисс ради фикса runaway-записей.
    private static let systemSilenceTicksToStop = 36
    // Бэкстоп от «шумного мика»: фоновый шум комнаты (улица/вентилятор/клавиатура) может держать
    // mic-пик выше порога и бесконечно отодвигать общий стоп по тишине. Отдельный счётчик ТОЛЬКО
    // по системной дорожке: 15 мин без ЕДИНОГО звука собеседников (пиками за интервал) → звонка
    // нет, мик не спасает. Сброс на ЛЮБОМ громком тике (без анти-блипа): тап пишет только процесс
    // встречи, случайный «блип» там = реальный звук с той стороны.
    private var systemOnlySilentTicks = 0
    private static let systemOnlySilenceTicksToStop = 180   // 180 × 5с = 15 мин
    // Пик своего микрофона между тиками recWatchTick: копится 1с-сэмплером micPeakTimer (у
    // AVAudioRecorder метринг pull-based — колбэка нет, аккумулируем опросом), читается и
    // сбрасывается в recWatchTick. Всё на main — без локов.
    private var micPeakTimer: Timer?
    private var micPeakSinceTick: Float = 0
    // Тики подряд с ПОДТВЕРЖДЁННО закрытой вкладкой встречи (Meet/Контур) → быстрый конец созвона.
    private var roomGoneTicks = 0
    private static let roomGoneTicksToStop = 4   // 4 × 5с ≈ 20с закрытой вкладки → авто-стоп
    // Не-тихие тики подряд: сброс счётчика тишины только при 2+ подряд (устойчивость к «блипам»).
    private var loudStreak = 0
    // Плановый конец встречи из Google Calendar (kind == .calendar) — сильный сигнал конца, как у
    // Granola. nil для room/manual. БОЛЬШЕ НЕ стоп-триггер (2026-07-29): календарный конец НЕ рубит
    // активный звонок (событие может быть заглушкой/не про этот созвон) — конец определяем только по
    // тишине дорожек (см. recWatchTick). Оставлен присвоенным для контекста/логов.
    private var scheduledEndAt: Date?
    // Тикает раз в 30 сек, пока идёт запись: обновляет ТОЛЬКО подпись у значка (счётчик
    // «49m left»). Полный rebuildMenu() тут не годится — он пересобирает всё меню целиком.
    private var statusTitleTimer: Timer?
    // Дефолтный стоп: если активный созвон не детектится, запись не идёт дольше этого лимита.
    // Бэкстоп от runaway-записи (когда детект созвона молчит — напр. ручной старт без звонка).
    private static let maxNoCallSeconds: TimeInterval = 75 * 60   // 1ч15м

    private let notifyCategory = "MEETING_START"
    // Та же встреча, но со ссылкой на звонок: набор кнопок задаёт КАТЕГОРИЯ, поэтому их две.
    private let notifyJoinCategory = "MEETING_START_JOIN"
    private let recordAction = "RECORD"
    private let joinAction = "JOIN"

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Переезд под новое имя (bumblebee) — до всего остального: если хелпер стартовал,
        // приложение обязано выйти, свой бандл под собой не переименуешь. Он вернёт нас сам.
        if Updater.runBundleRename() {
            NSApp.terminate(nil)
            return
        }

        do { config = try SwarmConfig.load() }
        catch { configError = "нужен токен — вставь через меню" }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        rebuildMenu()
        // НЕ дёргаем ensureScreenRecording() на старте: системный промпт показывается один раз
        // за процесс, и если «съесть» его молча здесь — по клику «Записать» он уже не появится.
        // Микрофон спросить заранее безопасно (отдельный промпт).
        Task { _ = await Permissions.requestMicrophone() }

        widget.onStop = { [weak self] in self?.stopTapped() }
        widget.onRecord = { [weak self] in self?.widgetRecord() }
        widget.onJoin = { [weak self] in self?.widgetJoin() }
        widget.onDismiss = { [weak self] in self?.widgetDismiss() }
        widget.onProcessingDismiss = { [weak self] in self?.dismissProcessing() }
        widget.onToggleNotes = { [weak self] in self?.expandNotes() }   // клик по марке на пилюле → блокнот
        // Сигналы из UploadQueue (постятся из актора, ловим на .main): принято в обработку / готово.
        NotificationCenter.default.addObserver(forName: .swarmMeetingUploaded, object: nil, queue: .main) { [weak self] note in
            if let id = note.userInfo?["id"] as? String { self?.handleMeetingUploaded(id) }
        }
        NotificationCenter.default.addObserver(forName: .swarmMeetingDone, object: nil, queue: .main) { [weak self] note in
            if let id = note.userInfo?["id"] as? String { self?.handleMeetingDone(id) }
        }
        // Живой уровень входа для полосы в виджете — читаем текущий уровень микрофона.
        widget.levelProvider = { [weak self] in self?.recorder.currentMicLevel() ?? 0 }
        // Вторая полоса — уровень системной дорожки (собеседники/коллеги), видно живой захват.
        widget.systemLevelProvider = { [weak self] in self?.recorder.currentSystemLevel() ?? 0 }
        // Честный сигнал «собеседник не пишется» из watchdog нулей (вызывается с control-queue →
        // прыгаем на main). Не терять собеседника молча (инцидент 2026-07-15), но и не спамить
        // (18.08.2026) — пассивная метка в панели (обе стороны, часто) отдельно от разового
        // уведомления (макс. один раз за запись, после длинного порога, без звука).
        recorder.onSystemStalled = { [weak self] stalled in
            DispatchQueue.main.async { self?.handleSystemAudioStalled(stalled) }
        }
        recorder.onSystemStalledPersistent = { [weak self] in
            DispatchQueue.main.async { self?.handleSystemAudioStalledPersistent() }
        }

        setupNotifications()
        setupPowerNotifications()
        startWatching()

        // Дозагрузка на старте: если в прошлый раз приложение закрыли/упало с висящими записями
        // в pending/, заливаем их сейчас (meetingId переиспользуется, claim не повторяем).
        if let cfg = config, configError == nil {
            Task { await UploadQueue.shared.drain(config: cfg); await refreshQueueBadge() }
            recoverInterruptedRecordings()   // подобрать записи, прерванные крашем/ребутом → дослать
        }
    }

    // ── Авто-детект (календарь + микрофон) ───────────────────────────────────────
    private func setupNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let record = UNNotificationAction(identifier: recordAction, title: "Записать", options: [.foreground])
        // Кнопка-referens Granola: один клик и заходит в звонок, и включает запись — чтобы не
        // бежать в календарь искать ссылку (решение владельца 02.09.2026, #193).
        let join = UNNotificationAction(identifier: joinAction, title: "Подключиться и записать", options: [.foreground])
        let cat = UNNotificationCategory(identifier: notifyCategory, actions: [record], intentIdentifiers: [], options: [])
        let joinCat = UNNotificationCategory(identifier: notifyJoinCategory, actions: [join, record],
                                             intentIdentifiers: [], options: [])
        center.setNotificationCategories([cat, joinCat])
        // Ответ на запрос ЧИТАЕМ. Раньше здесь стояло `{ _, _ in }`: человек отказывал (или
        // системный запрос вообще не появлялся), приложение об этом не узнавало никогда, и
        // каждое последующее уведомление молча уходило в никуда — а через них рекордер
        // сообщает то, о чём иначе не узнать: «звонок завершён, сохраняю», «нужен новый
        // токен», «системный звук не пишется» (issue #155).
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] _, _ in
            self?.refreshNotificationAuthorization()
        }
    }

    // Текущий статус разрешения на уведомления. nil — ещё не спрашивали систему.
    // Спрашиваем систему, а не запоминаем ответ на первый запрос: разрешение снимают и выдают
    // в System Settings в любой момент, мимо приложения.
    private func refreshNotificationAuthorization(then: (() -> Void)? = nil) {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
                let changed = self?.notificationsAllowed != allowed
                self?.notificationsAllowed = allowed
                if changed { self?.rebuildMenu() }
                then?()
            }
        }
    }

    // ── Сон/пробуждение ноутбука ──────────────────────────────────────────────────
    // macOS ЗАМОРАЖИВАЕТ таймеры (recWatchTick/maintenanceTick) на время сна. Закрыл крышку
    // посреди записи → авто-стоп по концу созвона и потолок «конец+30мин» не могут сработать:
    // запись висит открытой всё время сна и режется лишь при пробуждении (инцидент 2026-07-20 —
    // созвон 103 мин растянулся на 5.5ч wall-clock, стоп сработал только на wake). Поэтому:
    //   • на засыпании — штатно закрываем встречу («закрыл ноут = закончил»);
    //   • на пробуждении — дозагружаем бэкапы (во сне 15-мин maintenanceTick тоже стоял).
    // Наблюдатели — на NSWorkspace.shared.notificationCenter (НЕ .default: sleep/wake постятся
    // только сюда). Только willSleep (реальный сон системы) — screensDidSleep (гашение экрана при
    // простое) НЕ трогаем, иначе долгий созвон без движения мыши оборвётся на потухшем экране.
    private func setupPowerNotifications() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.handleWillSleep()
        }
        center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.handleDidWake()
        }
    }

    private func handleWillSleep() {
        guard case .recording = state else { return }
        dbg("WILL-SLEEP во время записи → авто-стоп")
        // Штатный авто-стоп: финализирует сегменты на диск + claim + отправка. macOS ЗАМОРАЖИВАЕТ
        // (не убивает) процесс, и мы НЕ держим сон (нет IOPMAssertion) → async-цепочка stopTapped не
        // успевает до сна, а резюмится и ДОигрывает на ПРОБУЖДЕНИИ: тап останавливается там же, claim+
        // upload идут на wake, handleDidWake дополнительно дренает. Метку конца (endedAt) фиксируем
        // СИНХРОННО в stopTapped до Task — иначе она уехала бы на время wake (см. там).
        // Нюансы (осознанный компромисс, не баги):
        //  • willSleep приходит и на idle-sleep, не только на крышку — но активный созвон обычно держит
        //    sleep-assertion (Zoom/Meet/Chrome), так что на практике это почти всегда закрытие крышки.
        //  • heartbeat recording=false до сна НЕ доходит (setState шлёт его с задержкой 3с, а сеть уже
        //    снимается) → сервер может кинуть ложное «запись прервалась» на снах >20 мин; на wake флаг
        //    чистится sendHeartbeat. Полное устранение ложной тревоги — на стороне сервера (см. BACKLOG).
        autoStop(reason: "ноутбук уснул — встреча сохранена")
    }

    private func handleDidWake() {
        guard let cfg = config, configError == nil else { return }
        dbg("DID-WAKE → дренаю бэкапы + heartbeat")
        // Дозагрузка недосланного (в т.ч. встречи, остановленной на засыпании) и подчистка бэкапов
        // done-встреч, которые не убрал замороженный во сне maintenanceTick. recoverInterruptedRecordings
        // тут НЕ зовём — резюмящийся Task из stopTapped уже финализирует текущую запись (иначе гонка);
        // орфаны от жёсткого выключения подберёт recovery на следующем старте.
        Task { await UploadQueue.shared.drain(config: cfg); await refreshQueueBadge() }
        sendHeartbeat()
        // Разрешение на уведомления могли выдать или снять в System Settings, пока ноут спал —
        // приложению об этом никто не сообщает. Пробуждение единственный момент, когда дёшево
        // переспросить систему, чтобы подсказка в меню не врала (issue #155).
        refreshNotificationAuthorization()
    }

    private func startWatching() {
        let t = Timer.scheduledTimer(timeInterval: 25, target: self, selector: #selector(watchTick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        watchTimer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.watchTick() }

        // Периодическое обслуживание бэкапов (раз в 15 мин): дозагрузка, опрос статуса (удаление на done),
        // 24ч-потолок. Нужно для долгоживущего меню-бара — иначе бэкапы чистятся только при старте/записи.
        let maint = Timer.scheduledTimer(timeInterval: 900, target: self, selector: #selector(maintenanceTick), userInfo: nil, repeats: true)
        RunLoop.main.add(maint, forMode: .common)
        maintTimer = maint

        // Проверка обновления вскоре после старта (даём приложению осесть и подняться сети).
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.checkForUpdate() }

        // Heartbeat вскоре после старта (сеть уже поднялась) — сервер знает, что рекордер жив.
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in self?.sendHeartbeat() }
    }

    @objc private func maintenanceTick() {
        guard let cfg = config, configError == nil else { return }
        Task { await UploadQueue.shared.drain(config: cfg); await refreshQueueBadge() }
        checkForUpdate()
        sendHeartbeat()
    }

    // Heartbeat серверу: «рекордер жив» + пишем ли сейчас + версия сборки. Best-effort. Шлётся из
    // maintenanceTick (15 мин), при смене статуса записи (setState — сервер сразу видит старт/стоп,
    // без этого была бы ложная тревога «запись прервалась») и разово на старте.
    //
    // Вместе с этим уходит присутствие (`on_call` + ключ встречи) — по нему панель «Встречи
    // сегодня» рисует `ON AIR`. Ключ берём у записи, если она идёт: там он точный, а календарный
    // детект в этот момент может уже смотреть на следующий слот.
    // `presence` — ЯВНОЕ состояние от маяка (в том числе «звонка нет» с пустым ключом); nil
    // означает «присутствие не знаю, наследуй прошлое». Двух опциональных полей здесь быть не
    // должно: с ними «не передали» и «передали nil» сливались, и heartbeat молотил каждый тик
    // (issue #242). Слияние — в RecorderKit.PresenceBeacon.stateForHeartbeat, оно под тестами.
    private func sendHeartbeat(presence: PresenceBeacon.State? = nil) {
        guard let cfg = config, configError == nil else { return }
        let recording = isRecording
        let state = PresenceBeacon.stateForHeartbeat(
            explicit: presence,
            previous: presenceSent,
            recordingKey: isRecording ? identity?.key : nil)
        presenceSent = state
        presenceSentAt = Date()
        Task {
            await SwarmClient(config: cfg).heartbeat(
                recording: recording, version: Updater.currentBuild,
                onCall: state.onCall, meetingKey: state.meetingKey)
        }
    }

    // Присутствие меняется чаще, чем всё остальное, поэтому у него свой троттл: смену состояния
    // отправляем сразу, а пока звонок идёт — повторяем не чаще PresenceBeacon.keepAlive.
    private func pulsePresence(onCall: Bool, calendarKey: String?) {
        let key = isRecording ? identity?.key : calendarKey
        let now = PresenceBeacon.State(onCall: onCall, meetingKey: onCall ? key : nil)
        guard PresenceBeacon.shouldSend(
            previous: presenceSent, current: now, lastSentAt: presenceSentAt, now: Date()) else { return }
        sendHeartbeat(presence: now)
    }

    // Тихий авто-апдейт: только в простое (запись/отправку не рвём) и один раз за сессию (после
    // апдейта приложение перезапустится). Сервер новее → запускаем отсоединённый хелпер
    // (скачивает готовый .app и переподписывает тем же cert → права не слетают). Подробности —
    // Updater.swift.
    private var updateSpawned = false
    private var lastUpdateCheckAt: Date?
    // Релизы редкие → проверять часто незачем. Чек на старте (lastUpdateCheckAt=nil) + не чаще
    // раза в 6ч. maintenanceTick (15 мин, нужен очереди загрузок) лишь предлагает чек — троттл режет.
    private let updateCheckMinInterval: TimeInterval = 6 * 3600
    private func checkForUpdate() {
        guard let cfg = config, configError == nil, !updateSpawned else { return }
        if case .idle = state {} else { return }   // не лезем во время записи/отправки/ошибки
        if let last = lastUpdateCheckAt, Date().timeIntervalSince(last) < updateCheckMinInterval { return }
        // Обновляем ТОЛЬКО установленную в /Applications копию — не трогаем запуск из dev/temp/DMG
        // (иначе своп снёс бы произвольный путь). build-app.sh/install.sh ставят именно туда.
        guard Bundle.main.bundlePath.hasPrefix("/Applications/") else { return }
        lastUpdateCheckAt = Date()
        Task {
            guard let latest = await Updater.latestRelease(config: cfg), latest.build > Updater.currentBuild else { return }
            // Перепроверяем простой и взводим флаг на ГЛАВНОМ потоке (state/updateSpawned — только там).
            let go: Bool = await MainActor.run {
                guard case .idle = self.state, !self.updateSpawned else { return false }
                self.updateSpawned = true
                return true
            }
            if go { Updater.runUpdater(currentBuild: Updater.currentBuild, targetBuild: latest.build, assetURL: latest.assetURL) }
        }
    }

    // Идёт ручная проверка обновления (пункт меню показывает это вместо кнопки).
    private var updateCheckInFlight = false

    // Пункт «Обновить bumblebee». Решение принимает Updater.decide — та же функция, что и в
    // самопроверке `--selftest-update`, поэтому поведение кнопки проверяемо без кликов.
    @objc private func checkUpdateTapped() {
        guard !updateCheckInFlight else { return }
        updateCheckInFlight = true
        rebuildMenu()
        let idle: Bool = { if case .idle = state, !updateSpawned { return true }; return false }()
        let cfg = config
        Task {
            let decision = await Updater.decide(config: cfg, isIdle: idle)
            await MainActor.run {
                self.updateCheckInFlight = false
                self.applyUpdateDecision(decision)
                self.rebuildMenu()
            }
        }
    }

    private func applyUpdateDecision(_ decision: Updater.Decision) {
        switch decision {
        case .noConfig:
            infoAlert("Нужен токен", "bumblebee пока не подключён — вставь токен из бота, потом обновляй.")
        case .notInstalled(let path):
            infoAlert("Обновление недоступно",
                      "Приложение запущено не из /Applications, а из \(path). Обновляется только копия в /Applications.")
        case .busy:
            infoAlert("Сейчас идёт запись",
                      "Обновлю после встречи — прерывать запись ради обновления нельзя. Можно вернуться к этому пункту, когда запись закончится.")
        case .unreachable:
            infoAlert("Не удалось проверить обновление",
                      "Сервер не ответил — похоже, нет сети. bumblebee проверяет обновления и сам, в простое, так что можно просто попробовать позже.")
        case .upToDate(let build):
            infoAlert("Установлена последняя версия", "Сборка \(build) — обновлять нечего.")
        case .available(let build, let from, let assetURL):
            updateSpawned = true
            Updater.runUpdater(currentBuild: from, targetBuild: build, assetURL: assetURL)
            infoAlert("Обновляю до сборки \(build)",
                      "Сейчас \(from). Скачаю и перезапущу — это займёт несколько секунд. Разрешение на запись звука не слетит, токен останется прежним.")
        }
    }

    private func infoAlert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    @objc private func watchTick() {
        guard let cfg = config, configError == nil else { return }
        Task {
            let lookup = try? await SwarmClient(config: cfg).currentMeeting()
            if lookup?.tokenDead == true {
                await MainActor.run { self.notifyGoogleReconnect() }
            } else if lookup != nil {
                await MainActor.run { self.googleReconnectWarned = false }   // связь ок → снова разрешаем предупредить
            }
            let meeting = lookup?.meeting ?? nil
            // Реальный созвон, а не просто занятый микрофон: фильтруем системные демоны
            // (CoreSpeech), иначе «звонок» виден всегда и сыпались бы ложные предложения записи.
            let micOn = CallDetector.realCallActive()
            DispatchQueue.main.async { [weak self] in
                self?.handleDetection(meeting: meeting, micActive: micOn)
                // Присутствие обновляем ОТДЕЛЬНО от handleDetection: тот выходит по
                // `guard case .idle`, а панели нужен сигнал и во время записи.
                self?.pulsePresence(onCall: micOn, calendarKey: meeting?.key)
            }
        }
    }

    // Подавлена ли встреча сейчас (с учётом срока). Истёкшие ключи чистим на месте, чтобы
    // множество не копилось и встреча снова предлагалась после кулдауна.
    private func isMeetingDismissed(_ key: String) -> Bool {
        guard let until = dismissedUntil[key] else { return false }
        if Date() < until { return true }
        dismissedUntil.removeValue(forKey: key)
        return false
    }

    private func handleDetection(meeting: MeetingIdentity.Info?, micActive: Bool) {
        let wasActive = micWasActive
        micWasActive = micActive
        guard case .idle = state else { return }

        // Календарь — приоритет (богаче: название, участники, упреждение).
        if let m = meeting, !isMeetingDismissed(m.key) {
            callActive = false
            if pendingMeeting?.key != m.key {
                pendingMeeting = m
                if !notifiedKeys.contains(m.key) { notifiedKeys.insert(m.key); notifyMeeting(m) }
                rebuildMenu()
            }
            return
        }
        if pendingMeeting != nil { pendingMeeting = nil; rebuildMenu() }

        // Нет события календаря → запасной детект звонка по микрофону.
        if micActive && !wasActive {
            if let until = callDismissedUntil, Date() < until { return }
            if !callActive { callActive = true; postCallNotification(); rebuildMenu() }
        } else if !micActive, callActive {
            callActive = false
            rebuildMenu()
        }
    }

    private func meetingWhen(_ m: MeetingIdentity.Info) -> String {
        guard let iso = m.startISO, let start = ISO8601DateFormatter().date(from: iso) else { return "идёт" }
        let mins = Int(start.timeIntervalSinceNow / 60)
        return mins <= 0 ? "идёт" : "через \(mins) мин"
    }

    // Один текст на две поверхности: баннер уведомления и капсулу. Разъехаться не могут.
    private func notice(for m: MeetingIdentity.Info) -> MeetingNotice {
        let iso = ISO8601DateFormatter()
        return MeetingNotice.compose(title: m.title,
                                     start: m.startISO.flatMap { iso.date(from: $0) },
                                     end: m.endISO.flatMap { iso.date(from: $0) },
                                     now: Date())
    }

    private func notifyMeeting(_ m: MeetingIdentity.Info) {
        let notice = notice(for: m)
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.subtitle = notice.subtitle
        content.categoryIdentifier = notifyCategory
        content.sound = .default
        // Ссылка на звонок есть → набор кнопок с «Подключиться и записать». Саму ссылку несём
        // в userInfo: обработчик действия получает только уведомление, не встречу.
        if let join = m.joinURL {
            content.categoryIdentifier = notifyJoinCategory
            content.userInfo = [Self.joinURLKey: join.absoluteString]
        }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "meeting-\(m.key)", content: content, trigger: nil))
    }

    private func postCallNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Идёт звонок"
        content.categoryIdentifier = notifyCategory
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "call-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil))
    }

    static let joinURLKey = "join_url"

    // Открыть звонок из уведомления. Схему проверяет JoinLink (только https) — ссылка
    // приехала из приглашения, которое мог создать кто угодно, а открываем её мы.
    private func openJoinURL(from userInfo: [AnyHashable: Any]) {
        guard let url = JoinLink.safeURL(userInfo[Self.joinURLKey] as? String) else { return }
        NSWorkspace.shared.open(url)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == joinAction {
            openJoinURL(from: response.notification.request.content.userInfo)
        }
        if response.actionIdentifier == recordAction || response.actionIdentifier == joinAction
            || response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            DispatchQueue.main.async { [weak self] in self?.acceptPrompt() }
        }
        completionHandler()
    }

    // ── UI ──────────────────────────────────────────────────────────────────────
    private var isRecording: Bool { if case .recording = state { return true }; return false }

    // Сетевой/транспортный сбой → состояние .offline (а не общая ошибка): URLError (нет связи,
    // таймаут) или SwarmError.transport (мы не дошли до HTTP-ответа).
    private func isOfflineError(_ error: Error) -> Bool {
        if error is URLError { return true }
        if case SwarmError.transport = error { return true }
        return false
    }

    // Состояния с собственным UI «путь в Settings/сеть + Повторить» (отдельно от idle/recording).
    private func isPermissionOrOfflineError(_ s: State) -> Bool {
        switch s {
        case .noScreenRecording, .noSystemAudio, .noMic, .offline, .error:
            return true
        default:
            return false
        }
    }

    private func statusText() -> String {
        if let e = configError { return "⚠️ \(e)" }
        switch state {
        case .idle:
            if let m = pendingMeeting { return "Встреча \(meetingWhen(m)): «\(m.title ?? "")»" }
            if callActive { return "Идёт звонок" }
            if queuedCount > 0 { return "bumblebee готов · \(queuedCount) в очереди" }
            return "bumblebee готов"
        case .recording: return "● Идёт запись"
        case .sending: return "Отправка…"
        case .noScreenRecording: return "🔴 Нет доступа «Screen Recording»"
        case .noSystemAudio: return "🔴 Нет доступа «System Audio Recording»"
        case .noMic: return "🔴 Нет доступа к микрофону"
        case .offline: return "🔴 Нет сети — повтори, когда появится"
        case .error(let m): return "Ошибка: \(m)"
        case .tokenExpired: return "🔴 Токен истёк/недействителен"
        }
    }

    // Подпись при наведении на значок в меню-баре. Значок маленький и без подписи — по нему
    // непонятно, чьё это приложение; тултип отвечает именем, а в непокойном состоянии ещё и
    // состоянием, чтобы не открывать меню ради «оно вообще пишет?».
    private func tooltipText() -> String {
        if configError != nil { return "bumblebee — нужен токен" }
        switch state {
        case .idle: return queuedCount > 0 ? "bumblebee — \(queuedCount) в очереди" : "bumblebee"
        case .recording: return "bumblebee — идёт запись"
        case .sending: return "bumblebee — отправка"
        default: return "bumblebee — \(statusText())"
        }
    }

    // Текст «куда идти» в System Settings для каждого типа сбоя разрешений (для пункта меню).
    private func settingsHint(for s: State) -> String? {
        switch s {
        case .noScreenRecording, .noSystemAudio:
            return Permissions.captureSettingsPath
        case .noMic:
            return "System Settings → Privacy & Security → Microphone → включить bumblebee"
        default:
            return nil
        }
    }

    // Подпись у значка: «что пишется прямо сейчас» (референс Granola, решение владельца
    // 2026-08-28 — docs/decisions/2026-08-28-status-bar-on-air.md). В покое подписи нет,
    // остаётся один глиф. Логика и её проверки — RecorderKit.StatusBarTitle.
    private func refreshStatusTitle() {
        guard let button = statusItem.button else { return }
        let text = titleSuppressed
            ? nil
            : StatusBarTitle.text(recording: isRecording, title: identity?.title, endsAt: scheduledEndAt)
        // Пустая строка, а не nil: nil у NSButton.title означает «оставить как было».
        button.title = text.map { " \($0)" } ?? ""
        if text != nil { scheduleMenuBarFitCheck() }
        syncStatusTitleTimer()
    }

    // ── Значок не должен исчезать из строки состояния (issue #232) ───────────────
    // macOS МОЛЧА прячет элементы, которым не хватило ширины: на 13" с вырезом подпись
    // «Название · 53m left» выдавила сам значок bumblebee — вместе с единственным способом
    // остановить запись и посмотреть статус (`NSStatusItem.isVisible` при этом остаётся true).
    // Поэтому после установки подписи проверяем геометрию и при нехватке места снимаем её.
    private var titleSuppressed = false

    private func scheduleMenuBarFitCheck() {
        // Ширина элемента пересчитывается не в тот же кадр — смотрим чуть позже.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.checkMenuBarFit() }
    }

    private func checkMenuBarFit() {
        guard !titleSuppressed, let button = statusItem.button, !button.title.isEmpty else { return }
        let zone = NSScreen.main?.auxiliaryTopRightArea
        guard !MenuBarFit.isVisible(itemFrame: button.window?.frame, menuBarZone: zone) else { return }
        // Обратно подпись НЕ возвращаем до конца записи: качели «влез / не влез» мигали бы
        // значком на каждом обновлении счётчика. Счётчик полезен, управление — необходимо.
        titleSuppressed = true
        button.title = ""
        dbg("menu bar: подпись снята, элемент не влезал (issue #232) frame=\(String(describing: button.window?.frame)) zone=\(String(describing: zone))")
    }

    // Счётчик тикает только во время записи: в покое таймер не нужен и будить машину незачем.
    private func syncStatusTitleTimer() {
        if isRecording, statusTitleTimer == nil {
            let t = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.refreshStatusTitle() }
            }
            RunLoop.main.add(t, forMode: .common)
            statusTitleTimer = t
        } else if !isRecording, let t = statusTitleTimer {
            t.invalidate()
            statusTitleTimer = nil
        }
    }

    private func rebuildMenu() {
        if let button = statusItem.button {
            button.image = RoyArt.menuBarImage(recording: isRecording)
            button.toolTip = tooltipText()
        }
        refreshStatusTitle()
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: statusText(), action: nil, keyEquivalent: ""))
        menu.addItem(.separator())

        // 401: токен протух — показываем явный путь «Получить новый токен» (ведёт в бот к
        // /recordertoken) + обычную вставку из буфера. Запись недоступна, пока токен невалиден.
        if case .tokenExpired = state {
            menu.addItem(NSMenuItem(title: "Получить новый токен", action: #selector(getNewTokenTapped), keyEquivalent: ""))
            menu.addItem(NSMenuItem(title: "Обновить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
            if queuedCount > 0 {
                menu.addItem(NSMenuItem(title: "⏳ \(queuedCount) в очереди (дозагрузим после токена)", action: nil, keyEquivalent: ""))
            }
        } else if isPermissionOrOfflineError(state) {
            // Типизированный сбой разрешений/сети: точный путь в Settings + «Повторить».
            if let hint = settingsHint(for: state) {
                let item = NSMenuItem(title: hint, action: nil, keyEquivalent: "")
                item.isEnabled = false
                menu.addItem(item)
            }
            switch state {
            case .noMic:
                menu.addItem(NSMenuItem(title: "Открыть настройки микрофона", action: #selector(openMicSettingsTapped), keyEquivalent: ""))
            case .noScreenRecording, .noSystemAudio:
                menu.addItem(NSMenuItem(title: "Открыть настройки записи", action: #selector(openRecordingSettingsTapped), keyEquivalent: ""))
            default:
                break
            }
            menu.addItem(NSMenuItem(title: "Повторить", action: #selector(retryTapped), keyEquivalent: "r"))
            if queuedCount > 0 {
                menu.addItem(NSMenuItem(title: "⏳ \(queuedCount) в очереди", action: #selector(drainQueueTapped), keyEquivalent: ""))
            }
        } else if configError == nil {
            switch state {
            case .recording:
                menu.addItem(NSMenuItem(title: "Остановить и отправить", action: #selector(stopTapped), keyEquivalent: "s"))
            case .sending:
                break
            default:
                if pendingMeeting != nil {
                    menu.addItem(NSMenuItem(title: "🔴 Записать встречу", action: #selector(recordMeetingTapped), keyEquivalent: "r"))
                    menu.addItem(NSMenuItem(title: "Не записывать", action: #selector(dismissMeetingTapped), keyEquivalent: ""))
                } else if callActive {
                    menu.addItem(NSMenuItem(title: "🔴 Записать звонок", action: #selector(recordCallTapped), keyEquivalent: "r"))
                    menu.addItem(NSMenuItem(title: "Не сейчас", action: #selector(dismissCallTapped), keyEquivalent: ""))
                } else {
                    menu.addItem(NSMenuItem(title: "Записать встречу", action: #selector(recordTapped), keyEquivalent: "r"))
                }
            }
            // Висящие дозагрузки видно всегда (даже во время записи): «N в очереди».
            if queuedCount > 0 {
                menu.addItem(NSMenuItem(title: "⏳ \(queuedCount) в очереди", action: #selector(drainQueueTapped), keyEquivalent: ""))
            }
            // Отклонённые сервером записи лежат в карантине 3 суток — даём дослать их руками.
            // Без этого пункта карантин был бы бесполезен: файлы есть, а достать их некому.
            if !deferredMeetingIds.isEmpty {
                let n = deferredMeetingIds.count
                menu.addItem(NSMenuItem(title: "📦 Дослать мою запись\(n > 1 ? " (\(n))" : "")", action: #selector(resendDeferredTapped), keyEquivalent: ""))
            }
            if let web = config?.webBaseURL, !web.isEmpty {
                menu.addItem(NSMenuItem(title: "Открыть Рой", action: #selector(openWeb), keyEquivalent: ""))
            }
            // Доступно всегда: перевставить токен (напр. если протух → 401). Раньше пункт
            // показывался только при отсутствии токена, и перевставить было неоткуда.
            menu.addItem(NSMenuItem(title: "Обновить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
        } else {
            menu.addItem(NSMenuItem(title: "Вставить токен из буфера", action: #selector(pasteTokenTapped), keyEquivalent: ""))
        }
        // Бэкстоп: macOS-разрешение на запись системного звука можно открыть вручную в любой
        // момент (Core Audio process-tap при отказе иногда даёт тишину без ошибки → catch не сработает).
        menu.addItem(NSMenuItem(title: "Открыть настройки записи", action: #selector(openRecordingSettingsTapped), keyEquivalent: ""))
        // Уведомления выключены — говорим об этом ЗДЕСЬ, потому что сказать больше негде:
        // единственный канал, которым рекордер зовёт человека, как раз и не работает. Строка
        // появляется только при точно известном отказе (notificationsAllowed == false), а не
        // на неизвестном статусе (issue #155).
        if notificationsAllowed == false {
            let hint = NSMenuItem(title: "Уведомления выключены — не смогу предупредить", action: nil, keyEquivalent: "")
            hint.isEnabled = false
            menu.addItem(hint)
        }
        // Проверка разрешения по требованию (владелец 2026-08-28: «система сама не спросила»).
        // Пункт есть всегда: если macOS не показала запрос при первом запуске, другого пути
        // включить уведомления у человека нет — а по статусу он видит, чем кончилось.
        menu.addItem(NSMenuItem(title: "Проверить уведомления", action: #selector(checkNotificationsTapped), keyEquivalent: ""))
        // Обновление по требованию. Авто-апдейт работает сам, но человеку нужен способ обновиться
        // СЕЙЧАС и увидеть результат: иначе единственный известный ему путь — перевыпуск токена
        // в боте, который гасит рабочую установку, если он не дойдёт до конца (issue #146).
        if updateCheckInFlight {
            let item = NSMenuItem(title: "Проверяю обновление…", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        } else {
            menu.addItem(NSMenuItem(title: "Обновить bumblebee · сборка \(Updater.currentBuild)",
                                    action: #selector(checkUpdateTapped), keyEquivalent: ""))
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Выйти", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        for item in menu.items where item.action != nil && item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
        statusItem.menu = menu
        syncWidget()
    }

    // Плавающий виджет следует за состоянием.
    private func syncWidget() {
        if configError != nil { widget.hide(); return }
        switch state {
        case .recording:
            // Развёрнут блокнот → показываем его (пилюлю прячем); свёрнуто → вертикальная пилюля рекордера.
            if notesExpanded { widget.hide() }
            else { widget.showRecording(startedAt: recordStartedAt ?? Date()) }
        case .sending:
            // Спиннер-капсулу НЕ показываем (она читалась как «зависла» и была лишним виджетом):
            // обработка идёт в фоне, «отправлено — тезисы придут в Telegram» приходит уведомлением.
            widget.hide()
        case .idle:
            if let m = pendingMeeting {
                widget.showPending(notice: notice(for: m), canJoin: m.joinURL != nil)
            } else if callActive {
                // Звонок без календаря: слота нет, а «подключиться» некуда — человек уже в нём.
                // Подзаголовок пустой: «Идёт звонок» + «идёт» — дубль, а не информация.
                widget.showPending(notice: MeetingNotice(title: "Идёт звонок", subtitle: ""),
                                   canJoin: false)
            } else {
                widget.hide()   // никакого «кружка»: пилюля только на детект встречи/звонка
            }
        case .error, .tokenExpired,
             .noScreenRecording, .noSystemAudio, .noMic, .offline:
            widget.hide()
        }
    }

    // ── Сигнал «встреча в обработке» ─────────────────────────────────────────────
    // Аудио принято сервером (ingest 202) → показываем уведомление и держим капсулу «в обработке».
    private func handleMeetingUploaded(_ id: String) {
        // Аудио принято сервером. Пользователю уже говорим «тезисы придут в Telegram» — поэтому
        // капсулу НЕ держим в спиннере до облачного done (это читалось как «зависла»): короткая
        // зелёная галка и прячем. Локальный бэкап чистится в фоне сам (UploadQueue.drain, на done).
        processingIds.remove(id)
        if processingNotified.insert(id).inserted {
            let content = UNMutableNotificationContent()
            content.title = "Запись отправлена"
            content.body = "Встреча пошла в обработку — тезисы придут в Telegram."
            content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(
                identifier: "processing-\(id)", content: content, trigger: nil))
        }
        flashProcessingDoneAndHide()
    }

    // Облачная обработка завершена (summary_status='done'): бэкап уже удалён в UploadQueue.drain,
    // капсула скрыта ещё на upload — здесь только подчищаем трекинг.
    private func handleMeetingDone(_ id: String) {
        processingIds.remove(id)
        processingNotified.remove(id)
        rebuildMenu()
    }

    // Короткая зелёная галка «отправлено», затем прячем капсулу.
    private func flashProcessingDoneAndHide() {
        processingDoneFlash = true
        rebuildMenu()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self else { return }
            self.processingDoneFlash = false
            self.rebuildMenu()
        }
    }

    // ✕ на капсуле «в обработке»: убрать индикатор (обработка продолжается в фоне сама).
    private func dismissProcessing() {
        processingIds.removeAll()
        processingDoneFlash = false
        rebuildMenu()
    }

    // Кнопка «Записать» в виджете — маршрутизируем по текущему контексту.
    @objc private func widgetRecord() {
        if pendingMeeting != nil { recordMeetingTapped() }
        else if callActive { recordCallTapped() }
        else { recordTapped() }
    }

    // ── Блокнот ⇄ пилюля во время записи ────────────────────────────────────────
    // Свёрнуто = вертикальная пилюля рекордера (widget.recRow); развёрнуто = блокнот (LiveNotesPanel).
    // Показываем строго одно из них. Оба рендера проверены по отдельности — без хрупкого морфа.
    private var notesExpanded = false
    private func expandNotes() {          // клик по марке на пилюле → развернуть блокнот
        guard isRecording else { return }
        notesExpanded = true
        widget.hide()
        Task { @MainActor in LiveNotesPanel.shared.expand() }
    }
    private func collapseNotes() {        // клик по марке в блокноте → свернуть (блокнот уже скрылся сам)
        notesExpanded = false
        rebuildMenu()                     // syncWidget покажет пилюлю рекордера
    }

    @objc private func widgetDismiss() {
        if pendingMeeting != nil { dismissMeetingTapped() }
        else if callActive { dismissCallTapped() }
    }

    private func setState(_ s: State) {
        state = s
        // Замок «идёт работа» для авто-апдейтера: пока пишем/отправляем — он не подменит приложение.
        switch s {
        case .recording, .sending: Updater.setRecordingLock(true)
        default: Updater.setRecordingLock(false)
        }
        // Вне записи подписи нет — снимаем запрет, чтобы следующая запись снова показала
        // название и счётчик (issue #232: запрет ставится только когда место кончилось).
        if case .recording = s {} else { titleSuppressed = false }
        // Heartbeat: сервер должен знать старт/стоп записи (recording=false при остановке снимает
        // ложное «прервалась»). Но в моменты .recording/.sending НЕ шлём синхронно — это самые
        // хрупкие точки жизненного цикла тапа (start/stop), не добавляем туда конкурентный сетевой
        // Task (инцидент 2026-07-15). Небольшая задержка выносит его из критического окна.
        switch s {
        case .recording, .sending:
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.sendHeartbeat() }
        default:
            sendHeartbeat()
        }
        DispatchQueue.main.async { self.rebuildMenu() }
    }

    @objc private func openRecordingSettingsTapped() {
        Permissions.openScreenRecordingSettings()
    }

    @objc private func openMicSettingsTapped() {
        Permissions.openMicrophoneSettings()
    }

    // Перепроверяет статус уведомлений и, если их нет, ведёт прямо в нужную панель настроек.
    // Сначала пробуем ЗАПРОСИТЬ: если система ещё не спрашивала (.notDetermined), человек
    // получит обычный системный запрос и включит всё в один клик, не уходя в Settings.
    @objc private func checkNotificationsTapped() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { [weak self] settings in
            if settings.authorizationStatus == .notDetermined {
                center.requestAuthorization(options: [.alert, .sound]) { _, _ in
                    self?.refreshNotificationAuthorization {
                        // Отказал в системном окне — показываем, где это переиграть.
                        if self?.notificationsAllowed == false { Permissions.openNotificationSettings() }
                    }
                }
                return
            }
            DispatchQueue.main.async {
                self?.refreshNotificationAuthorization {
                    if self?.notificationsAllowed == false { Permissions.openNotificationSettings() }
                }
            }
        }
    }

    // «Повторить» после типизированного сбоя: сбрасываем состояние и повторяем последнее
    // действие записи (тот же контекст: встреча/звонок/ручной старт). Сеть/разрешения к этому
    // моменту пользователь уже мог поправить через пункты выше.
    @objc private func retryTapped() {
        // Есть снятая, но не отправленная запись → пере-отправляем ИМЕННО её (не теряем аудио),
        // а не начинаем новую запись.
        if let p = pendingSend {
            armSending()
            Task { await performSend(p) }
            return
        }
        let id = lastRecordIdentity
        state = .idle
        rebuildMenu()
        beginRecording(identity: id)
    }

    @objc private func openWeb() {
        guard let web = config?.webBaseURL, let url = URL(string: web) else { return }
        NSWorkspace.shared.open(url)
    }

    // 401: подсказать получить новый токен из бота (команда /recordertoken), затем вставить.
    // Бот — Telegram, прямой deep-link в конфиге не хранится; ведём текстом к команде.
    @objc private func getNewTokenTapped() {
        let a = NSAlert()
        a.messageText = "Нужен новый токен"
        a.informativeText = "Токен истёк или отозван. Открой бота Swarm Brain в Telegram, набери /recordertoken, скопируй выданный smcp_-токен и нажми «Обновить токен из буфера»."
        a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    // Ручной запуск дозагрузки очереди (пункт «N в очереди»).
    @objc private func drainQueueTapped() {
        guard let cfg = config else { return }
        Task {
            await UploadQueue.shared.drain(config: cfg)
            await refreshQueueBadge()
        }
    }

    // Дослать записи, которым сервер отказал (decision=defer). Сервер примет их, только если наша
    // запись реально полнее (арбитраж по длительности в meeting-claim) — иначе отобьёт и папка
    // вернётся в карантин. Кнопка нужна для случая «я знаю, что моя запись полная, а в базе обрубок».
    @objc private func resendDeferredTapped() {
        guard let cfg = config else { return }
        let ids = deferredMeetingIds
        Task {
            var sent = 0
            var refused: String? = nil
            var error: String? = nil
            for id in ids {
                switch await UploadQueue.shared.resendDeferred(id, config: cfg) {
                case .sent: sent += 1
                case .stillDeferred(let holder): refused = holder ?? "другой участник"
                case .failed(let why): error = why
                }
            }
            await refreshQueueBadge()
            // Итог обязателен: «нажал и ничего не произошло» — та же молчаливая потеря,
            // из-за которой инцидент 17.08.2026 заметили только через сутки.
            // Снимок в let: захват var'ов в @Sendable-замыкании — ошибка в Swift 6 language mode
            // (CI-раннер собирает именно в нём, локальный 6.3 понижает до warning — issue #40).
            let sentCount = sent, refusedBy = refused, failReason = error
            await MainActor.run { self.notifyResendOutcome(sent: sentCount, refused: refusedBy, error: failReason) }
        }
    }

    private func notifyResendOutcome(sent: Int, refused: String?, error: String?) {
        let c = UNMutableNotificationContent()
        if sent > 0 {
            c.title = "Запись отправлена"
            c.body = "Твоя запись принята — она полнее той, что была в базе. Тезисы перегенерируются и придут в Telegram."
        } else if let refused {
            c.title = "Сервер снова отказал"
            c.body = "Право транскрибации держит \(refused.hasPrefix("@") ? refused : "@\(refused)"): его запись не короче твоей. Аудио осталось в бэкапе."
        } else {
            c.title = "Не удалось дослать запись"
            c.body = "\(error ?? "неизвестная ошибка"). Аудио на месте — попробуй позже."
        }
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "resend-\(Int(Date().timeIntervalSince1970))", content: c, trigger: nil))
    }

    @objc private func pasteTokenTapped() {
        func info(_ title: String, _ text: String = "") {
            let a = NSAlert(); a.messageText = title; a.informativeText = text
            NSApp.activate(ignoringOtherApps: true); a.runModal()
        }
        let clip = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !clip.isEmpty else {
            info("Буфер пуст", "Скопируй токен из бота: /mytoken (тапни по smcp_-блоку — скопируется целиком).")
            return
        }
        guard clip.hasPrefix("smcp_"), clip.count >= 12 else {
            info("Это не похоже на токен", "В буфере: «\(clip.prefix(24))…». Нужен токен из /mytoken — начинается с smcp_.")
            return
        }
        do {
            try SwarmConfig.saveToken(clip)
            config = try SwarmConfig.load()
            configError = nil
            state = .idle
            rebuildMenu()
            info("Токен сохранён ✅", "smcp_…\(clip.suffix(4))")
            // Свежий токен → пробуем дозалить всё, что копилось при протухшем (включая 401-висяки).
            if let cfg = config {
                Task { await UploadQueue.shared.drain(config: cfg); await refreshQueueBadge() }
            }
        } catch {
            setState(.error("не сохранить токен: \(error)"))
        }
    }

    // ── Запись ───────────────────────────────────────────────────────────────────
    @objc private func recordTapped() {
        beginRecording(identity: MeetingIdentity.currentRoom())
    }
    @objc private func recordMeetingTapped() { acceptPrompt() }
    @objc private func recordCallTapped() { acceptPrompt() }

    // «Подключиться» на баннере: открыть звонок и сразу включить запись (референс Granola,
    // #193) — один клик вместо «найти ссылку в календаре, зайти, потом вспомнить про запись».
    private func widgetJoin() {
        if let url = pendingMeeting?.joinURL { NSWorkspace.shared.open(url) }
        widgetRecord()
    }

    private func acceptPrompt() {
        if let m = pendingMeeting {
            pendingMeeting = nil
            beginRecording(identity: m)
        } else {
            callActive = false
            beginRecording(identity: MeetingIdentity.currentRoom())
        }
    }

    @objc private func dismissMeetingTapped() {
        if let m = pendingMeeting {
            // «Не записывать»: подавляем до конца события (если известен) + буфер, иначе на несколько часов.
            let end = m.endISO.flatMap { ISO8601DateFormatter().date(from: $0) }?.addingTimeInterval(30 * 60)
            dismissedUntil[m.key] = end ?? Date().addingTimeInterval(dismissMeetingSeconds)
        }
        pendingMeeting = nil
        rebuildMenu()
    }
    @objc private func dismissCallTapped() {
        callDismissedUntil = Date().addingTimeInterval(10 * 60)
        callActive = false
        rebuildMenu()
    }

    private func beginRecording(identity id: MeetingIdentity.Info?) {
        guard config != nil else { return }
        if case .recording = state { return }
        // Запоминаем контекст для «Повторить» (встреча/звонок/manual).
        lastRecordIdentity = id
        // macOS 14.4+: системный звук через Core Audio process-tap — нужно «System Audio
        // Recording», НЕ «запись экрана»; TCC-промпт всплывёт сам при старте тапа.
        // Ниже 14.4 — старый путь ScreenCaptureKit, требует «запись экрана».
        if #available(macOS 14.4, *) {
            // ничего не гейтим — промпт системного звука покажется при старте
        } else if !Permissions.ensureScreenRecording() {
            setState(.noScreenRecording)
            Permissions.openScreenRecordingSettings()
            return
        }
        pendingMeeting = nil
        callActive = false
        let startedAt = Date()
        let base = UUID().uuidString
        // Чекпоинты: пишем в DURABLE-папку (App Support переживает ребут), НЕ в temp (стирается).
        // Ротация системных сегментов по ходу + восстановление при запуске спасают собеседника при краше.
        let recDir = recordingDir(base)
        try? FileManager.default.createDirectory(at: recDir, withIntermediateDirectories: true)
        let sys = recDir.appendingPathComponent("sys0.m4a")
        let mic = recDir.appendingPathComponent("mic.m4a")
        Task {
            do {
                try await recorder.start(systemURL: sys, micURL: mic)
                sysURL = sys; micURL = mic
                recordStartedAt = startedAt
                identity = id
                currentRecDir = recDir; currentRecBase = base; nextSysIndex = 1; recTickCount = 0
                writeRecordingMeta(dir: recDir, base: base, startedAt: startedAt, identity: id)
                // Плановый конец из Google Calendar → авто-стоп по нему. Если старт уже календарный —
                // берём endISO сразу; иначе (ручной старт / по комнате) дозапрашиваем meeting-current,
                // чтобы стоп по концу работал при ЛЮБОМ способе старта, если идёт календарная встреча.
                if id?.kind == .calendar, let endISO = id?.endISO {
                    scheduledEndAt = ISO8601DateFormatter().date(from: endISO)
                } else {
                    scheduledEndAt = nil
                    if let cfg = self.config {
                        Task { [weak self] in
                            let cal = try? await SwarmClient(config: cfg).currentMeeting()
                            guard let info = cal?.meeting, let endISO = info.endISO,
                                  let end = ISO8601DateFormatter().date(from: endISO) else { return }
                            guard let self else { return }
                            await MainActor.run {
                                guard case .recording = self.state else { return }
                                self.scheduledEndAt = end
                            }
                        }
                    }
                }
                // notesExpanded ДО setState(.recording): иначе syncWidget сначала покажет виджет с
                // его level-таймером, а затем панель заведёт ВТОРОЙ 10-Гц таймер (дефект build 4 →
                // лишняя нагрузка на планировщик во время записи). Ставим флаг заранее — при наличии
                // панели виджет сразу скрыт, работает только один индикатор уровней.
                self.notesExpanded = (self.config != nil)
                setState(.recording)
                // Сторож конца звонка — ДО показа панели. Инцидент 2026-07-21: await show()
                // не вернулся → recWatchTick так и не заармился → ни авто-стопа, ни чекпоинт-
                // ротаций, ни dbg-лога на всю запись. Сторож не должен зависеть от UI-панели.
                startCallEndWatch()
                // Granola-режим: на старте — блокнот (LiveNotesPanel). Клик по марке сворачивает в
                // вертикальную пилюлю (виджет рекордера), клик по марке пилюли — обратно в блокнот.
                if let cfg = self.config {
                    await LiveNotesPanel.shared.show(
                        config: cfg,
                        initialTitle: id?.title,
                        micLevel: { [weak self] in self?.recorder.currentMicLevel() ?? 0 },
                        systemLevel: { [weak self] in self?.recorder.currentSystemLevel() ?? 0 },
                        onStop: { [weak self] in self?.stopTapped() },
                        onCollapse: { [weak self] in self?.collapseNotes() })
                    // «Что было в прошлый раз» (issue #226): тезисы последней встречи с этой
                    // стороной и висящие задачи. Запрос ФОНОВЫЙ и необязательный: не ответил —
                    // блока просто нет, запись от этого не страдает и не ждёт сети.
                    loadMeetingContext(title: id?.title)
                }
            } catch {
                // Сбой старта захвата системного звука = нет нужного TCC-разрешения. На 14.4+ это
                // «System Audio Recording», ниже — «Screen Recording»; ведём пользователя точно туда.
                setState(Permissions.usesSystemAudioCapture ? .noSystemAudio : .noScreenRecording)
                Permissions.openScreenRecordingSettings()
            }
        }
    }

    // Контекст созвона для панели заметок (issue #226). Ошибки глотаем намеренно: это
    // справка, а не часть записи — падать или ретраить из-за неё нельзя.
    private func loadMeetingContext(title: String?) {
        guard let cfg = config else { return }
        Task.detached { [weak self] in
            guard self != nil else { return }
            let client = SwarmClient(config: cfg)
            let ctx = try? await client.meetingContext(title: title)
            await MainActor.run { LiveNotesPanel.shared.setContext(ctx) }
        }
    }

    // ── Авто-стоп по концу звонка ────────────────────────────────────────────────
    // Во время записи раз в 5с смотрим, держит ли вход ДРУГОЕ приложение (CallDetector,
    // исключая нас). Как только конференц-приложение отпустило микрофон на ~15с подряд —
    // звонок завершён → останавливаем запись. Ловит и ранний конец (как Granola).
    private func startCallEndWatch() {
        callSeenDuringRec = false
        silentTicks = 0
        systemSilentTicks = 0
        systemOnlySilentTicks = 0
        roomGoneTicks = 0
        loudStreak = 0
        micPeakSinceTick = 0
        // Таймер планируем СТРОГО на main-run-loop. startCallEndWatch зовётся из Task без @MainActor
        // (после `await recorder.start()`) → на фоновом потоке. Timer.scheduledTimer там сел бы на
        // мёртвый фоновый run loop, а RunLoop.main.add уже-запланированного таймера его на main НЕ
        // перевешивает → recWatchTick не тикал (регресс build 14: авто-стоп/чекпоинт-ротации молчали).
        // Timer(timeInterval:) + RunLoop.main.add ВНУТРИ DispatchQueue.main.async = таймер всегда на main.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.recWatchTimer?.invalidate()
            let t = Timer(timeInterval: 5, target: self, selector: #selector(self.recWatchTick), userInfo: nil, repeats: true)
            RunLoop.main.add(t, forMode: .common)
            self.recWatchTimer = t
            // Мик-сэмплер (1с): AVAudioRecorder-метринг pull-based, колбэка нет — копим пик
            // своего микрофона между 5с-тиками опросом. Дёшево (updateMeters раз в секунду).
            self.micPeakTimer?.invalidate()
            let mt = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                guard let self else { return }
                let lvl = self.recorder.currentMicLevel()
                if lvl > self.micPeakSinceTick { self.micPeakSinceTick = lvl }
            }
            RunLoop.main.add(mt, forMode: .common)
            self.micPeakTimer = mt
        }
    }

    private func stopCallEndWatch() {
        recWatchTimer?.invalidate()
        recWatchTimer = nil
        micPeakTimer?.invalidate()
        micPeakTimer = nil
    }

    @objc private func recWatchTick() {
        guard case .recording = state else { stopCallEndWatch(); return }
        let elapsed = Date().timeIntervalSince(recordStartedAt ?? Date())

        // Чекпоинт: раз в ~5 мин финализируем текущий системный сегмент и продолжаем в новый файл →
        // при краше/ребуте готовые куски собеседника (суть встречи) переживают. Тап НЕ трогаем.
        // Микрофон пока не ротируем (клиентский upload шлёт mic одним файлом; mic_parts — отдельно).
        recTickCount += 1
        if recTickCount % Self.rotateEveryTicks == 0, let dir = currentRecDir, let base = currentRecBase {
            // Мета — СИНХРОННО на триггере (currentSystemSegments берёт ioLock, зависшая HAL-очередь
            // не мешает): подхватывает и segN-пересборки watchdog'а. Инцидент 2026-07-21: мета
            // писалась только ПОСЛЕ await rotateSystem → при клине тапа не обновлялась вовсе →
            // recovery видел один sys0. Пост-ротационная запись ниже остаётся (уточняет офсеты).
            writeRecordingMeta(dir: dir, base: base, startedAt: recordStartedAt ?? Date(), identity: identity)
            let segURL = dir.appendingPathComponent("sys\(nextSysIndex).m4a")
            nextSysIndex += 1
            Task { [weak self] in
                guard let self else { return }
                await self.recorder.rotateSystem(to: segURL)
                await MainActor.run {
                    guard case .recording = self.state else { return }
                    self.writeRecordingMeta(dir: dir, base: base, startedAt: self.recordStartedAt ?? Date(), identity: self.identity)
                }
            }
        }

        // «Кто-нибудь звучит?» — пик ОБЕИХ дорожек за интервал тика: системной (собеседники,
        // peakSinceLastRead из аудио-колбэков) и своего микрофона (micPeakSinceTick, 1с-сэмплер).
        // Тихие тики считаем ВСЕГДА, независимо от mic-детекта занятости: при браузерном звонке
        // браузер держит мик непрерывно, и mic-правило ниже не сработает — тишина дорожек тут
        // единственный сигнал конца. Пики за интервал (а не точечный сэмпл раз в 5с) — иначе
        // живая речь ловится с дырами и копит ложную «тишину» (инцидент 2026-07-24).
        let systemPeak = recorder.systemPeakSinceLastRead()
        let micPeak = micPeakSinceTick
        micPeakSinceTick = 0
        let anyoneAudible = systemPeak >= Self.systemSilenceLevel || micPeak >= Self.micSilenceLevel
        // Устойчивость к «блипам»: одиночный всплеск (уведомление, звук выхода из звонка) НЕ
        // сбрасывает счётчик тишины — сброс только на 2 не-тихих тиках подряд. В живой речи
        // пиковые тики идут подряд, так что сброс срабатывает надёжно.
        if !anyoneAudible {
            systemSilentTicks += 1; loudStreak = 0
        } else {
            loudStreak += 1
            if loudStreak >= 2 { systemSilentTicks = 0 }
        }
        // Бэкстоп только по собеседникам (мик не участвует) — см. объявление счётчика.
        if systemPeak < Self.systemSilenceLevel {
            systemOnlySilentTicks += 1
        } else {
            systemOnlySilentTicks = 0
        }

        // Реальный созвон = кто-то, КРОМЕ нас и системных демонов (CoreSpeech), держит мик.
        // На macOS <14 per-process детекта нет → realCall всегда false, работает только лимит ниже.
        var realCall = false
        if #available(macOS 14.0, *) {
            let info = CallDetector.othersUsingMicInfo()
            realCall = !info.isEmpty
            dbg("tick others=\(info.map { "\($0.pid):\($0.bundle)" }) seen=\(callSeenDuringRec) silent=\(silentTicks) sysPeak=\(String(format: "%.3f", systemPeak)) micPeak=\(String(format: "%.3f", micPeak)) sysSilent=\(systemSilentTicks) sysOnly=\(systemOnlySilentTicks) roomGone=\(roomGoneTicks) elapsed=\(Int(elapsed))s")
        }

        // (Сигнал вкладки) Быстрый конец БРАУЗЕРНОГО созвона: вкладка комнаты (Meet/Контур) закрыта
        // /ушла ~20с подряд → «ты вышел». Прямее и быстрее «3 минут тишины». Только для room-встреч
        // и когда созвон был замечен; ошибка чтения вкладок = «не уверены» (roomGone не копится, не стопаем).
        if callSeenDuringRec, let room = identity, room.kind == .room {
            switch MeetingIdentity.roomPresence(key: room.key) {
            case .open: roomGoneTicks = 0
            case .gone: roomGoneTicks += 1
            case .unknown: break
            }
            if roomGoneTicks >= Self.roomGoneTicksToStop {
                autoStop(reason: "встреча закрыта")
                return
            }
        } else {
            roomGoneTicks = 0
        }

        // (Календарь) Плановый конец из Google Calendar НЕ останавливает запись, пока идёт звук
        // (решение владельца 2026-07-29). Причина: календарное событие может быть заглушкой / не про
        // этот звонок (напр. личный созвон в другом браузере при рабочем событии в календаре), а живой
        // диалог важнее расписания. Был баг: активный звонок рубился на `плановый конец + 30 мин`
        // (scheduledOverrunCapSeconds) — ровно час записи вместо продолжения. Конец созвона определяем
        // ТОЛЬКО по тишине дорожек: правила ниже (3 мин тишины / 15 мин без собеседника / закрытая
        // вкладка / лимит без активного созвона). `scheduledEndAt` — больше не стоп-триггер.

        // (0) Конец БРАУЗЕРНОГО звонка по тишине ОБЕИХ дорожек. Срабатывает ДАЖЕ когда
        // mic-холдер (браузер) всё ещё держит мик — НЕ гейтим на realCall==false. Требуем, чтобы
        // звонок хоть раз был замечен (callSeenDuringRec), чтобы не стопать «пустой» ручной старт.
        if callSeenDuringRec && systemSilentTicks >= Self.systemSilenceTicksToStop {
            autoStop(reason: "звонок завершён (тишина)")
            return
        }
        // (0б) Бэкстоп: собеседников не слышно 15 мин подряд — стоп независимо от мика (шумный
        // мик не должен держать запись вечно). Любой звук с той стороны сбрасывает счётчик.
        if callSeenDuringRec && systemOnlySilentTicks >= Self.systemOnlySilenceTicksToStop {
            autoStop(reason: "собеседников не слышно 15 мин")
            return
        }

        if realCall {
            callSeenDuringRec = true
            silentTicks = 0
            return
        }

        // Реального созвона сейчас нет — копим «тихие» тики (5с каждый).
        silentTicks += 1
        // (а) Созвон был и смолк ~15с → закончился → стоп.
        if callSeenDuringRec && silentTicks >= 3 {
            autoStop(reason: "звонок завершён")
            return
        }
        // (б) Дефолтный стоп: за 1ч15м активный созвон так и не детектился (или давно смолк) →
        // запись не должна тянуться дальше. Защита от runaway, когда детект молчит.
        if elapsed >= Self.maxNoCallSeconds && silentTicks >= 3 {
            autoStop(reason: "лимит 1ч15м без активного созвона")
            return
        }
    }

    // Единая остановка по авто-детекту: лог + уведомление + штатный стоп/отправка.
    private func autoStop(reason: String) {
        dbg("AUTO-STOP: \(reason)")
        stopCallEndWatch()
        postCallEndedNotification(body: "\(reason) — сохраняю встречу.")
        stopTapped()
    }

    // Диагностика в файл (читается снаружи) — временно, для отладки авто-стопа.
    private func dbg(_ s: String) {
        let line = "\(Date()) \(s)\n"
        let url = URL(fileURLWithPath: "/tmp/swarm-calldetect.log")
        guard let data = line.data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(data); try? h.close()
        } else {
            try? data.write(to: url)
        }
    }

    // Разовое уведомление: Google-токен умер (был подключён, refresh не прошёл). Молчаливый отказ
    // прятал отвал календаря (авто-название/авто-стоп по расписанию тихо переставали работать).
    private var googleReconnectWarned = false
    private func notifyGoogleReconnect() {
        guard !googleReconnectWarned else { return }
        googleReconnectWarned = true
        let content = UNMutableNotificationContent()
        content.title = "Переподключи Google-календарь"
        content.body = "Доступ к Google-календарю отвалился — авто-название и авто-стоп встреч по расписанию не работают. Открой Swarm в вебе → Настройки → Google-календарь и подключи заново."
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "google-reconnect", content: content, trigger: nil))
    }

    private func postCallEndedNotification(body: String = "Звонок завершён — сохраняю встречу.") {
        let content = UNMutableNotificationContent()
        content.title = "Запись остановлена"
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "callend-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil))
    }

    // Watchdog нулей: пассивная метка в панели (LiveNotesPanel) — живая, обе стороны, ничего не
    // стоит пользователю. Активное уведомление сюда НЕ входит — см. handleSystemAudioStalledPersistent.
    private func handleSystemAudioStalled(_ stalled: Bool) {
        guard case .recording = state else { return }
        Task { @MainActor in LiveNotesPanel.shared.setSystemAudioWarning(stalled) }
    }

    // Разовое честное уведомление «собеседник не пишется» — максимум ОДИН РАЗ за запись, после
    // ~50с суммарной тишины на системной дорожке при активном созвоне (порог живёт в
    // SystemAudioCapturer.notifySilenceSeconds; несколько тихих само-пересборок уже были
    // попробованы к этому моменту). Без звука (владелец 18.08.2026: «со звуком... назойливо») —
    // баннер молча появится в Notification Center. Причину не называем конкретно (Bluetooth) —
    // ветка смены аудио-формата обрабатывается отдельно и тихо, сюда попадает только «реальной
    // тишины было слишком долго», Bluetooth тут почти никогда не при чём.
    private func handleSystemAudioStalledPersistent() {
        guard case .recording = state else { return }
        let content = UNMutableNotificationContent()
        content.title = "⚠️ Собеседник не пишется"
        content.body = "Звук собеседника не поступает уже больше минуты, хотя звонок идёт. Рекордер несколько раз пробовал переподключиться сам. Твой микрофон пишется нормально. Проверь вывод звука на компьютере — это сообщение не появится снова в этой записи."
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "sysstall-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil))
    }

    @objc private func stopTapped() {
        guard config != nil else { return }
        stopCallEndWatch()
        armSending()
        // Крестик = мгновенная реакция: убираем панель заметок СРАЗУ, не дожидаясь цепочки
        // stop→claim→flush (инцидент 2026-07-15: раньше панель висела, пока стоп зависал в HAL).
        // Буфер пометок сохраняется в LiveNotesPanel и уйдёт во flush(), когда появится meetingId.
        Task { @MainActor in LiveNotesPanel.shared.hide() }
        let info = identity
        let started = recordStartedAt ?? Date()
        // Метку конца фиксируем СИНХРОННО, до Task: в сон-кейсе (willSleep→autoStop) Task резюмится
        // на ПРОБУЖДЕНИИ, и Date() внутри него дал бы время wake → endedAt раздулся бы на весь сон
        // (для room/manual, где нет calEndISO и берётся p.ended). Здесь это момент нажатия/засыпания.
        let ended = Date()
        Task {
            // Финализация записи (внутри — best-effort stop системного тапа). Если зависнет —
            // её НЕ убить отменой, но watchdog (armSending) выведет UI из .sending сам.
            let res: AudioRecorder.Result
            do {
                res = try await recorder.stop()
            } catch {
                setState(.error("не завершить запись: \(error)"))
                await refreshQueueBadge()
                return
            }
            // Записанную встречу больше не предлагать; снятую запись сохраняем для возможного
            // повтора отправки (claim/enqueue ниже могут не пройти — аудио не должно потеряться).
            // Уже записанную встречу временно не предлагаем — короткий кулдаун, НЕ навсегда:
            // дозапись/рестарт того же созвона позже снова предложатся (раньше висело до перезапуска).
            if let info { dismissedUntil[info.key] = Date().addingTimeInterval(recordedSuppressSeconds) }
            identity = nil
            let captured = PendingSend(res: res, identity: info, started: started,
                                       ended: ended, manualKey: "manual:\(UUID().uuidString)")
            pendingSend = captured
            await performSend(captured)
        }
    }

    // Взвести «Отправка…» + watchdog: если через sendWatchdogSeconds всё ещё .sending (та же
    // попытка) — вывести в .error с «Повторить», чтобы не висеть в .sending вечно (зависшая
    // финализация натива отмене не поддаётся; просто разблокируем UI, pendingSend хранит запись).
    private func armSending() {
        sendGeneration += 1
        let gen = sendGeneration
        setState(.sending)
        Task {
            try? await Task.sleep(nanoseconds: UInt64(sendWatchdogSeconds * 1_000_000_000))
            // state/sendGeneration читаем и пишем на главном потоке (без гонки с setState/stopTapped).
            let fired: Bool = await MainActor.run {
                guard case .sending = self.state, self.sendGeneration == gen else { return false }
                self.setState(.error("отправка зависла — нажмите «Повторить»"))
                return true
            }
            if fired { await self.refreshQueueBadge() }
        }
    }

    // Отправка снятой записи: claim → перенос в pending/ → дозагрузка. При сбое НЕ теряем аудио —
    // pendingSend остаётся, «Повторить» пере-отправит. При успехе/отказе сервера очищаем pendingSend.
    // ── Чекпоинты записи: durable-папка, meta, восстановление после краша ────────
    private struct RecordingMeta: Codable {
        let base: String
        let startISO: String            // старт сессии (fallback для claim)
        let identityKind: String?       // "calendar"/"room"/"manual"
        let identityKey: String?
        let title: String?
        let calStartISO: String?        // identity.startISO (calendar)
        let calEndISO: String?          // identity.endISO (calendar)
        var systemSegments: [Seg]
        struct Seg: Codable { let path: String; let offset: Double }
    }

    private func recordingRootDir() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SwarmRecorder", isDirectory: true)
            .appendingPathComponent("recording", isDirectory: true)
    }
    private func recordingDir(_ base: String) -> URL { recordingRootDir().appendingPathComponent(base, isDirectory: true) }

    // Атомарно пишет meta.json папки записи: идентичность (для claim при восстановлении) + список
    // системных сегментов. Вызывается на старте и после каждой чекпоинт-ротации.
    private func writeRecordingMeta(dir: URL, base: String, startedAt: Date, identity id: MeetingIdentity.Info?) {
        let iso = ISO8601DateFormatter()
        let segs = recorder.currentSystemSegments().map {
            RecordingMeta.Seg(path: $0.url.lastPathComponent, offset: $0.offset)
        }
        let meta = RecordingMeta(base: base, startISO: iso.string(from: startedAt),
                                 identityKind: id?.kind.rawValue, identityKey: id?.key, title: id?.title,
                                 calStartISO: id?.startISO, calEndISO: id?.endISO, systemSegments: segs)
        if let data = try? JSONEncoder().encode(meta) {
            try? data.write(to: dir.appendingPathComponent("meta.json"), options: .atomic)
        }
    }

    // На старте: подобрать записи, прерванные крашем/ребутом, и дослать. Только системная дорожка
    // (собеседник) — микрофон без mic_parts пока не спасаем. Последний (по offset) сегмент отбрасываем:
    // он активный на момент краша → вероятно без moov (не финализирован).
    private func recoverInterruptedRecordings() {
        guard let cfg = config, configError == nil else { return }
        let root = recordingRootDir()
        guard let dirs = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey]) else { return }
        for dir in dirs where (try? dir.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            if dir.lastPathComponent == currentRecBase { continue }   // текущая живая сессия — не трогаем
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("meta.json")),
                  let meta = try? JSONDecoder().decode(RecordingMeta.self, from: data) else {
                quarantineOrRemove(dir: dir); continue   // битая meta: аудио есть → в failed/, мусор → удалить
            }
            Task { await self.recoverOne(dir: dir, meta: meta, config: cfg) }
        }
    }

    private func recoverOne(dir: URL, meta: RecordingMeta, config cfg: SwarmConfig) async {
        let iso = ISO8601DateFormatter()
        let sorted = meta.systemSegments.sorted { $0.offset < $1.offset }
        // НЕ dropLast вслепую (терял финализированный хвост — инцидент 2026-07-21, seg10 был цел):
        // берём все существующие сегменты, читаемость проверяет AVAudioFile — активный на момент
        // краша файл без moov просто не откроется и отпадёт сам.
        let segs: [(url: URL, offset: Double)] = sorted.map {
            (url: dir.appendingPathComponent($0.path), offset: $0.offset)
        }.filter { seg in
            guard FileManager.default.fileExists(atPath: seg.url.path),
                  ((try? seg.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 1024
            else { return false }
            return (try? AVAudioFile(forReading: seg.url)) != nil
        }
        // «Нечего спасать» по мете ≠ можно стирать: мета могла отстать от реальных файлов
        // (инцидент 2026-07-21 — в мете один sys0, на диске 11 валидных сегментов).
        guard !segs.isEmpty else { quarantineOrRemove(dir: dir); return }
        let client = SwarmClient(config: cfg)
        let kind = IdentityKind(rawValue: meta.identityKind ?? "manual") ?? .manual
        let req = ClaimRequest(
            identityKind: kind,
            identityKey: meta.identityKey ?? "manual:\(meta.base)",
            title: meta.title,   // пусто → сервер назовёт «участник — дата» (#184)
            startedAt: meta.calStartISO ?? meta.startISO,
            endedAt: meta.calEndISO ?? iso.string(from: Date()),
            agentVersion: "0.1.0")
        do {
            let claim = try await withRetry { try await client.claim(req) }
            if claim.shouldTranscribe {
                try await UploadQueue.shared.enqueue(
                    meetingId: claim.meetingId, systemSegments: segs, micURL: nil,
                    micStartOffset: nil, startISO: req.startedAt ?? meta.startISO,
                    endISO: req.endedAt ?? iso.string(from: Date()))
                await UploadQueue.shared.drain(config: cfg)
                await MainActor.run { self.notifyRecovered() }
            }
            try? FileManager.default.removeItem(at: dir)   // enqueue перенёс файлы → папка не нужна
        } catch {
            NSLog("SwarmRecorder: восстановление \(meta.base) не удалось (\(error)) — оставляю для ретрая")
        }
    }

    // Папка записи, которую recovery не смог разобрать. Есть аудио >1КБ → переносим в failed/
    // (ручной разбор возможен; диск чистит 3-суточный потолок sweepExpired), иначе мусор → удалить.
    // Появилось после инцидента 2026-07-21: ветка «нечего спасать» стирала папку с 26 МБ живого аудио.
    private func quarantineOrRemove(dir: URL) {
        let fm = FileManager.default
        let hasAudio = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? [])
            .contains { $0.pathExtension == "m4a" && (((try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 1024) }
        guard hasAudio else { try? fm.removeItem(at: dir); return }
        let failedRoot = recordingRootDir().deletingLastPathComponent()
            .appendingPathComponent("failed", isDirectory: true)
        try? fm.createDirectory(at: failedRoot, withIntermediateDirectories: true)
        let dst = failedRoot.appendingPathComponent("recovered-" + dir.lastPathComponent, isDirectory: true)
        try? fm.removeItem(at: dst)
        do {
            try fm.moveItem(at: dir, to: dst)
            NSLog("SwarmRecorder: recovery не разобрал \(dir.lastPathComponent) — аудио сохранено в failed/, НЕ удалено")
        } catch {
            NSLog("SwarmRecorder: карантин \(dir.lastPathComponent) не удался (\(error)) — папка оставлена на месте")
        }
    }

    // Запись отклонена сервером (транскрибирует другой участник). Раньше этот исход был НЕОТЛИЧИМ
    // от успеха: файлы стирались, индикатор гас, показывалось штатное «сохраняю встречу».
    // Теперь говорим прямо — пока аудио ещё живо в карантине и решение можно откатить.
    private func notifyDeferred(holder: String?, seconds: Double) {
        let who = holder.map { "@\($0)" } ?? "другой участник"
        let c = UNMutableNotificationContent()
        c.title = "Твоя запись не пошла в обработку"
        c.body = "Эту встречу транскрибирует \(who). Твоя запись (\(Self.humanDuration(seconds))) сохранена на 3 суток — если она полнее, дошли её через меню: «Дослать мою запись»."
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "deferred-\(Int(Date().timeIntervalSince1970))", content: c, trigger: nil))
    }

    // Длительность по-человечески: «2 ч 26 мин» / «3 мин 16 с». Нужна в тексте про отклонённую
    // запись — «2ч26м против 3 минут» сразу объясняет, почему это важно.
    static func humanDuration(_ seconds: Double) -> String {
        let total = Int(max(0, seconds.rounded()))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        if h > 0 { return "\(h) ч \(m) мин" }
        if m > 0 { return "\(m) мин \(s) с" }
        return "\(s) с"
    }

    private func notifyRecovered() {
        let c = UNMutableNotificationContent()
        c.title = "Восстановлена прерванная запись"
        c.body = "Нашла запись, прерванную сбоем/перезапуском — отправила в обработку. Тезисы придут в Telegram."
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "recovered-\(Int(Date().timeIntervalSince1970))", content: c, trigger: nil))
    }

    private func performSend(_ p: PendingSend) async {
        guard let cfg = config else { return }
        let client = SwarmClient(config: cfg)
        let iso = ISO8601DateFormatter()
        // Название, поправленное пользователем в панели на ходу, побеждает дефолт (календарь/«Запись …»).
        let titleOverride = await LiveNotesPanel.shared.currentTitleOverride()
        // Длительность НАШЕЙ записи — по фактическим границам сессии, а не по календарю: сервер
        // отдаёт транскрибацию более полной записи, и календарные startISO/endISO (плановые, у всех
        // участников одинаковые) для этого сравнения бесполезны.
        let recordedSeconds = max(0, p.ended.timeIntervalSince(p.started))
        let req: ClaimRequest
        if let info = p.identity {
            req = ClaimRequest(
                identityKind: info.kind,
                identityKey: info.key,
                title: titleOverride ?? info.title,   // пусто → сервер назовёт «участник — дата» (#184)
                startedAt: info.startISO ?? iso.string(from: p.started),
                endedAt: info.endISO ?? iso.string(from: p.ended),
                attendees: info.attendees.isEmpty ? nil : info.attendees,
                agentVersion: "0.1.0",
                micStartOffset: p.res.micStartOffset,
                recordedSeconds: recordedSeconds
            )
        } else {
            req = ClaimRequest(
                identityKind: .manual,
                identityKey: p.manualKey,   // стабильный ключ → повтор claim не плодит встречи
                // Заглушку названия больше не придумываем: имя человека знает сервер, а не мы
                // (у нас на диске только токен). Пусто → meeting-claim ставит «участник — дата» (#184).
                title: titleOverride,
                startedAt: iso.string(from: p.started),
                endedAt: iso.string(from: p.ended),
                agentVersion: "0.1.0",
                micStartOffset: p.res.micStartOffset,
                recordedSeconds: recordedSeconds
            )
        }
        // Переехали ли файлы в очередь (pending/ или карантин failed/). Пока false — durable-папку
        // записи трогать нельзя: в ней лежит единственная копия аудио.
        var staged = true
        do {
            // Claim (с ретраем). meetingId переиспользуется очередью при дозагрузке.
            let claim = try await withRetry { try await client.claim(req) }
            if claim.shouldTranscribe {
                // КРИТИЧНО против потери данных: ДО загрузки переносим записи в pending/<id>/
                // с сайдкаром. Файлы удалятся только после подтверждённого ingest (в drain).
                try await UploadQueue.shared.enqueue(
                    meetingId: claim.meetingId,
                    systemSegments: p.res.systemSegments,
                    micURL: p.res.mic,
                    micStartOffset: p.res.micStartOffset,
                    startISO: iso.string(from: p.started),
                    endISO: iso.string(from: p.ended)
                )
                // Принято в очередь → пойдёт в обработку. setState(.idle) ниже покажет капсулу
                // «в обработке» (processingIds непуст); 202 из дрейна добавит уведомление.
                let mid = claim.meetingId
                await MainActor.run { self.processingIds.insert(mid) }
                // Страховка от «вечной» капсулы, если done так и не придёт за 20 мин.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1200) { [weak self] in
                    if self?.processingIds.remove(mid) != nil { self?.rebuildMenu() }
                }
            } else {
                // decision=defer — транскрибирует другой участник. НЕ удаляем: наша запись может
                // оказаться единственной полной (инцидент 17.08.2026 — стёрли 2ч26м, потому что
                // коллега остановила свою на 3-й минуте и заявилась первой). Кладём в карантин
                // failed/ под общий трёхсуточный потолок и ГОВОРИМ об этом вслух: молчание тут
                // недопустимо — это единственный момент, когда потерю ещё можно откатить.
                do {
                    try await UploadQueue.shared.quarantineDeferred(
                        meetingId: claim.meetingId,
                        systemSegments: p.res.systemSegments,
                        micURL: p.res.mic,
                        micStartOffset: p.res.micStartOffset,
                        startISO: iso.string(from: p.started),
                        endISO: iso.string(from: p.ended),
                        claimRetry: PendingUpload.ClaimRetry(
                            identityKind: req.identityKind.rawValue,
                            identityKey: req.identityKey,
                            title: req.title,
                            startedAt: req.startedAt,
                            endedAt: req.endedAt,
                            recordedSeconds: recordedSeconds)
                    )
                    await MainActor.run {
                        self.notifyDeferred(holder: claim.heldByName, seconds: recordedSeconds)
                    }
                } catch {
                    staged = false
                    NSLog("SwarmRecorder: карантин отклонённой записи не удался (\(error)) — файлы оставлены в durable-папке")
                }
            }
            // Файлы перенесены в pending/ или в карантин failed/ → durable-папка ИМЕННО этой записи
            // больше не нужна (выводим из её же сегментов, не из глобального стейта — иначе
            // «Повторить» после старта новой записи снёс бы чужую папку).
            // ВАЖНО: только если перенос РЕАЛЬНО состоялся. Иначе здесь удалялось бы единственное
            // оставшееся аудио — ровно тот класс молчаливой потери, ради которого всё это чинится.
            if staged, let seg = p.res.systemSegments.first {
                try? FileManager.default.removeItem(at: seg.url.deletingLastPathComponent())
            }
            pendingSend = nil   // отправлено в очередь (или сервер отказался) — повторять нечего
            setState(.idle)
            // Live-пометки «Роя» из панели → к этой встрече (best-effort; панель сама скроется).
            await LiveNotesPanel.shared.flush(meetingId: claim.meetingId, config: cfg)
            // Дозагрузка (этой записи + всех висящих) — в фоне с бэкоффом.
            await UploadQueue.shared.drain(config: cfg)
            await refreshQueueBadge()
        } catch let err as SwarmError where err.isAuthExpired {
            // 401: токен истёк — pendingSend сохраняем: после нового токена «Повторить» дошлёт.
            setState(.tokenExpired)
            await refreshQueueBadge()
        } catch where isOfflineError(error) {
            // Сеть недоступна — pendingSend сохраняем, «Повторить» пере-отправит (claim идемпотентен).
            setState(.offline)
            await refreshQueueBadge()
        } catch {
            setState(.error("\(error)"))
            await refreshQueueBadge()
        }
    }

    // Подтянуть счётчик очереди и перерисовать меню (вызывать с любого потока).
    private func refreshQueueBadge() async {
        let n = await UploadQueue.shared.pendingCount()
        let deferred = await UploadQueue.shared.deferredIds()
        await MainActor.run { self.queuedCount = n; self.deferredMeetingIds = deferred; self.rebuildMenu() }
    }
}
