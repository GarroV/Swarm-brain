import Foundation

// Тихий авто-апдейт. Пользователи рекордера — нетехнари (маркетинг), поэтому без кнопок и
// терминала: фоном, в простое, сам.
//
// Схема — СКАЧИВАЕМ готовый .app и переподписываем локальным cert'ом (как это делает установщик,
// issue #19). Apple Developer ID у нас нет, поэтому скачанное нельзя оставлять как есть: снимаем
// карантин (иначе Gatekeeper заблокирует) и переподписываем тем же per-machine cert
// «SwarmRecorder Self-Signed» → designated requirement не меняется → TCC-грант на запись экрана
// НЕ слетает.
//
// ⚠️ Почему больше НЕ пересобираем из исходников (issue #91, 2026-08-25): старая схема клонировала
// тег `recorder-build-<N>` с GitHub и звала `swift build`. Репозиторий стал приватным 20.08.2026 —
// анонимный clone отказывает по авторизации, ветка обработки была `keep current`, и авто-апдейт
// у ВСЕЙ команды умер МОЛЧА (никто не заметил: сервер честно отдавал новый build, обновления не
// происходило). Скачивание zip снимает и вторую проблему старой схемы — требование Command Line
// Tools (git/swift) на машине нетехнаря.
enum Updater {
    // Идентичность локального cert'а. Обязана совпадать с установщиком (swarm-recorder-setup):
    // именно на её leaf завязан designated requirement, а на DR — выданное TCC-разрешение.
    static let signingIdentity = "SwarmRecorder Self-Signed"

    // Номер текущей сборки из CFBundleVersion (recorder/VERSION). Старый нечисловой («0.1.0») → 0.
    static var currentBuild: Int {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return Int(v) ?? 0
    }

    private static func supportDir() -> URL {
        SwarmConfig.configURL().deletingLastPathComponent()
    }

    // Файл-замок «идёт запись»: апдейтер не подменяет приложение, пока он есть (не рвём запись).
    static var recordingLockURL: URL { supportDir().appendingPathComponent(".recording") }
    static func setRecordingLock(_ active: Bool) {
        let url = recordingLockURL
        if active {
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: url.path, contents: Data())
        } else {
            try? FileManager.default.removeItem(at: url)
        }
    }

    // ── Решение «обновляться ли сейчас» ───────────────────────────────────────────────────────
    // Отделено от показа, чтобы одну и ту же логику дёргали и пункт меню, и самопроверка
    // (--selftest-update): иначе кнопку нельзя проверить иначе как руками на живой машине.
    enum Decision {
        case noConfig                       // токен не прописан — обновлять нечем
        case notInstalled(String)           // запущено не из /Applications: своп чужого пути опасен
        case busy                           // идёт запись/отправка — не трогаем
        case unreachable                    // сервер версий не ответил
        case upToDate(build: Int)           // уже последняя
        case available(build: Int, from: Int, assetURL: URL)
    }

    static func decide(config: SwarmConfig?, bundlePath: String = Bundle.main.bundlePath,
                       isIdle: Bool) async -> Decision {
        guard let config else { return .noConfig }
        guard bundlePath.hasPrefix("/Applications/") else { return .notInstalled(bundlePath) }
        guard isIdle else { return .busy }
        guard let latest = await latestRelease(config: config) else { return .unreachable }
        let cur = currentBuild
        guard latest.build > cur else { return .upToDate(build: cur) }
        return .available(build: latest.build, from: cur, assetURL: latest.assetURL)
    }

    // Спросить сервер последний доступный build и URL артефакта. nil при любой ошибке → не обновляемся.
    // Источник истины — `swarm-recorder-version` (наш Supabase), GitHub в схеме больше не участвует.
    static func latestRelease(config: SwarmConfig) async -> (build: Int, assetURL: URL)? {
        let base = config.ingestBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + "/swarm-recorder-version") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 15
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        var build: Int?
        if let b = obj["build"] as? Int { build = b }
        else if let b = obj["build"] as? Double { build = Int(b) }
        else if let s = obj["build"] as? String { build = Int(s) }
        guard let build else { return nil }
        guard let asset = assetURL(from: obj["url"] as? String, build: build, apiBase: base) else { return nil }
        return (build, asset)
    }

    // URL артефакта: берём из ответа сервера, а при его отсутствии выводим из адреса API
    // (тот же проект Supabase, публичный бакет). Домен НЕ хардкодим — он живёт в config.json.
    //
    // Артефакт обязан лежать на ТОМ ЖЕ хосте, что и API: скачанное мы переподписываем своим
    // cert'ом и подставляем в /Applications, поэтому источник бинарника не должен уводиться
    // куда-то ещё одним лишь ответом сервера.
    static func assetURL(from raw: String?, build: Int, apiBase: String) -> URL? {
        guard let apiURL = URL(string: apiBase), let apiHost = apiURL.host else { return nil }
        let fallback = apiBase.replacingOccurrences(of: "/functions/v1", with: "")
            + "/storage/v1/object/public/swarm_drive/recorder/SwarmRecorder-\(build).zip"
        let candidate = (raw?.isEmpty == false) ? raw! : fallback
        guard let url = URL(string: candidate),
              url.scheme == "https",
              url.host == apiHost else { return nil }
        return url
    }

    // ── Переезд под новое имя (bumblebee) ────────────────────────────────────────────────────
    // Приложение называется bumblebee, но на машинах людей оно лежит как /Applications/SwarmRecorder.app:
    // апдейтер прошлых сборок ставит новый бандл ровно в свой прежний путь, а имя внутри архива
    // обязано оставаться старым, иначе обновление молча не доедет. Поэтому имя меняет само
    // приложение — один раз, после первого запуска новой сборки.
    //
    // Разрешение «Screen & System Audio Recording» переезд переживает: TCC держит грант на
    // designated requirement (identifier + certificate leaf), путь и имя файла в него не входят —
    // проверено на установленной копии: identifier "io.dodobrands.swarmrecorder" and certificate leaf …
    static let legacyBundlePath = "/Applications/SwarmRecorder.app"
    static let currentBundlePath = "/Applications/bumblebee.app"

    // Нужен ли переезд: мы запущены именно из старого пути в /Applications.
    static func needsBundleRename(bundlePath: String = Bundle.main.bundlePath) -> Bool {
        bundlePath == legacyBundlePath
    }

    // Запускает отсоединённый хелпер и возвращает true, если он стартовал (тогда зовущий обязан
    // завершить приложение — переименовать бандл под работающим процессом нельзя).
    // Во время записи не трогаем ничего: переезд подождёт следующего запуска.
    @discardableResult
    static func runBundleRename() -> Bool {
        guard needsBundleRename() else { return false }
        if FileManager.default.fileExists(atPath: recordingLockURL.path) { return false }
        let dir = supportDir()
        let scriptURL = dir.appendingPathComponent("rename-bundle.sh")
        let logPath = dir.appendingPathComponent("self-update.log").path
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard (try? renameScript().write(to: scriptURL, atomically: true, encoding: .utf8)) != nil else { return false }
        let pid = ProcessInfo.processInfo.processIdentifier
        let cmd = "nohup bash \(shq(scriptURL.path)) \(pid) \(shq(legacyBundlePath)) \(shq(currentBundlePath)) \(shq(recordingLockURL.path)) >> \(shq(logPath)) 2>&1 &"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", cmd]
        guard (try? p.run()) != nil else { return false }
        return true
    }

    // $1=pid, $2=старый путь, $3=новый путь, $4=lock записи.
    private static func renameScript() -> String {
        """
        #!/bin/bash
        set -u
        APP_PID="$1"; OLD="$2"; NEW="$3"; LOCK="$4"
        log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] rename: $*"; }
        # Санити: переименовываем только .app внутри /Applications — не произвольный путь.
        case "$OLD" in /Applications/*.app) : ;; *) log "refusing: OLD не /Applications/*.app ($OLD)"; exit 0 ;; esac
        case "$NEW" in /Applications/*.app) : ;; *) log "refusing: NEW не /Applications/*.app ($NEW)"; exit 0 ;; esac
        # Ждём, пока приложение договорит и умрёт: под работающим процессом бандл не двигаем.
        for _ in $(seq 1 30); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 1; done
        if kill -0 "$APP_PID" 2>/dev/null; then log "app pid $APP_PID жив после 30с; отложено"; exit 0; fi
        # Гонка: запись могла стартовать в момент выхода — тогда не трогаем бандл, но приложение
        # обязаны вернуть (иначе оно просто исчезнет, а встреча из календаря будет пропущена).
        if [ -f "$LOCK" ]; then log "идёт запись; переезд отложен"; open "$OLD" 2>/dev/null || true; exit 0; fi
        if [ -d "$NEW" ]; then
          # Новое уже стоит (переустановили установщиком) — старая копия лишняя, иначе два
          # рекордера пишут одну встречу.
          log "$NEW уже на месте; убираю прежний $OLD"
          rm -rf "$OLD"
        elif ! mv "$OLD" "$NEW" 2>/dev/null; then
          log "mv не удался; остаёмся на прежнем имени"
          open "$OLD" 2>/dev/null || true
          exit 0
        fi
        open "$NEW" 2>/dev/null || true
        log "переехали: $OLD -> $NEW"
        """
    }

    // Запустить отсоединённый апдейтер. Скачивание идёт при живом приложении (простоя нет);
    // подмена /Applications + перезапуск — только когда нет recording-lock. Скачивание упало /
    // cert отсутствует / версия не новее → ничего не трогаем, остаёмся на рабочей версии.
    static func runUpdater(currentBuild cur: Int, targetBuild: Int, assetURL: URL) {
        let appPath = Bundle.main.bundlePath
        let pid = ProcessInfo.processInfo.processIdentifier
        let dir = supportDir()
        let scriptURL = dir.appendingPathComponent("self-update.sh")
        let logPath = dir.appendingPathComponent("self-update.log").path
        let lockPath = recordingLockURL.path

        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard (try? script().write(to: scriptURL, atomically: true, encoding: .utf8)) != nil else { return }

        // Полностью отсоединяем (nohup + &): хелпер должен пережить наш SIGTERM и перезапуск.
        // Аргументы: pid, текущий build, путь .app, lock, целевой build, URL артефакта.
        let cmd = "nohup bash \(shq(scriptURL.path)) \(pid) \(cur) \(shq(appPath)) \(shq(lockPath)) \(targetBuild) \(shq(assetURL.absoluteString)) >> \(shq(logPath)) 2>&1 &"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", cmd]
        try? p.run()
    }

    // Экранирование одиночными кавычками для безопасной подстановки путей в bash.
    private static func shq(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    // Текст хелпера. Принимает: $1=pid приложения, $2=текущий build, $3=путь .app, $4=lock,
    // $5=целевой build, $6=URL артефакта.
    private static func script() -> String {
        """
        #!/bin/bash
        set -u
        IDENTITY=\(shq(signingIdentity))
        APP_PID="$1"; CUR="$2"; APP_PATH="$3"; LOCK="$4"; TARGET="$5"; URL="$6"
        log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
        log "self-update: current build $CUR → build $TARGET, app $APP_PATH (pid $APP_PID)"
        # Стабильный cert обязателен — иначе подпись схлопнется в ad-hoc и грант на запись слетит.
        if ! security find-identity -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then log "no signing cert; skip (would break TCC)"; exit 0; fi
        TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
        # Качаем ГОТОВЫЙ .app (сборки из исходников больше нет — issue #91). Диагностика честная:
        # различаем «файла нет по ссылке» и «сети нет», иначе следующий сбой снова уведёт разбор.
        # `--retry` печатает %{http_code} за КАЖДУЮ попытку («000000» при обрыве сети), поэтому
        # берём последние 3 символа — иначе ветка «нет сети» не срабатывает и лог врёт про артефакт.
        CODE="$(curl -sL --retry 3 --max-time 300 -o "$TMP/app.zip" -w '%{http_code}' "$URL" 2>/dev/null || echo 000)"
        CODE="${CODE: -3}"
        case "$CODE" in
          200) : ;;
          000) log "download failed (нет сети?); keep current"; exit 0 ;;
          *)   log "download failed (HTTP $CODE от $URL — артефакт не опубликован?); keep current"; exit 0 ;;
        esac
        if ! ditto -x -k "$TMP/app.zip" "$TMP/unz" >/dev/null 2>&1; then log "unzip failed; keep current"; exit 0; fi
        # Имя бандла в архиве переходное: сейчас там SwarmRecorder.app (иначе апдейтер сборок ≤23
        # не найдёт его и молча не обновится), позже — bumblebee.app. Принимаем оба.
        SRC=""
        for CAND in "$TMP/unz/bumblebee.app" "$TMP/unz/SwarmRecorder.app"; do
          [ -d "$CAND" ] && { SRC="$CAND"; break; }
        done
        [ -n "$SRC" ] || SRC="$(/usr/bin/find "$TMP/unz" -maxdepth 2 -name 'bumblebee.app' -print -quit 2>/dev/null)"
        [ -n "$SRC" ] || SRC="$(/usr/bin/find "$TMP/unz" -maxdepth 2 -name 'SwarmRecorder.app' -print -quit 2>/dev/null)"
        if [ -z "${SRC:-}" ] || [ ! -d "$SRC" ]; then log "no app bundle inside archive; keep current"; exit 0; fi
        # Версию берём из САМОГО бандла, а не из ответа сервера: подменять приложение можно только
        # на заведомо более новое (иначе битая раздача откатила бы всех назад).
        NEW="0"; NEW="$(plutil -extract CFBundleVersion raw "$SRC/Contents/Info.plist" 2>/dev/null | tr -cd '0-9')"; [ -n "${NEW:-}" ] || NEW="0"
        if [ "$NEW" -le "$CUR" ]; then log "not newer (downloaded CFBundleVersion=$NEW <= $CUR); skip"; exit 0; fi
        # Скачанное карантинится Gatekeeper'ом — снимаем ДО подписи.
        xattr -dr com.apple.quarantine "$SRC" 2>/dev/null || true
        if ! codesign --force --timestamp=none -s "$IDENTITY" "$SRC" >/dev/null 2>&1; then log "codesign failed; keep current"; exit 0; fi
        if ! codesign -d --requirements - "$SRC" 2>&1 | grep -q 'certificate leaf'; then log "unstable DR after signing (TCC would break); keep current"; exit 0; fi
        # Санити: APP_PATH обязан быть .app-бандлом — не сносим произвольный путь.
        case "$APP_PATH" in *.app) : ;; *) log "refusing: APP_PATH не .app ($APP_PATH)"; exit 0 ;; esac
        # Не прерывать запись: ждём снятия lock (до 30 мин). Всё ещё пишет — отложим до следующего раза.
        for _ in $(seq 1 1800); do [ -f "$LOCK" ] || break; sleep 1; done
        if [ -f "$LOCK" ]; then log "still recording after wait; abort swap (retry next cycle)"; exit 0; fi
        log "quitting app pid $APP_PID for swap…"
        kill -TERM "$APP_PID" 2>/dev/null || true
        for _ in $(seq 1 30); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 1; done
        # Если процесс ещё жив — НЕ трогаем бандл работающего приложения (иначе своп под ногами).
        if kill -0 "$APP_PID" 2>/dev/null; then log "app pid $APP_PID жив после 30с; abort swap"; exit 0; fi
        # Гонка: запись могла стартовать МЕЖДУ проверкой лока (строка выше, до kill) и самим kill —
        # проверка тут не атомарна с kill. Раньше в этой ветке скрипт молча выходил БЕЗ open —
        # процесс к этому моменту уже мёртв (мы прошли проверку "ещё жив" выше), и рекордер
        # оставался закрытым до ручного перезапуска юзером, а не пойманная календарём встреча
        # молча пропадала (баг, репорт 2026-08-18: «периодически закрывается и не ловит
        # встречи из календаря»). Своп бинарника в этом цикле всё равно пропускаем (не хотим
        # подменить .app под незавершённой записью), но открыть УЖЕ УБИТОЕ приложение обязаны —
        # иначе оно просто исчезает без следа.
        if [ -f "$LOCK" ]; then
          log "lock present after quit (гонка: запись стартовала в момент kill) — своп пропущен, но перезапускаю приложение"
          open "$APP_PATH" 2>/dev/null || true
          exit 0
        fi
        # Безопасная подмена: НИКОГДА не оставляем слот пустым. Стейджим рядом → старое в .bak →
        # новое на место → если финальный шаг упал, возвращаем .bak. Сбой стейджа = старое не тронуто.
        STAGE="${APP_PATH}.new-$$"; BAK="${APP_PATH}.bak-$$"
        rm -rf "$STAGE" "$BAK"
        if ! cp -R "$SRC" "$STAGE"; then log "stage copy failed; current app untouched"; rm -rf "$STAGE"; open "$APP_PATH" 2>/dev/null || true; exit 0; fi
        if ! mv "$APP_PATH" "$BAK" 2>/dev/null; then log "cannot move current aside; abort"; rm -rf "$STAGE"; open "$APP_PATH" 2>/dev/null || true; exit 0; fi
        if ! mv "$STAGE" "$APP_PATH" 2>/dev/null; then log "swap failed; restoring backup"; mv "$BAK" "$APP_PATH" 2>/dev/null || true; rm -rf "$STAGE"; open "$APP_PATH" 2>/dev/null || true; exit 1; fi
        rm -rf "$BAK"
        open "$APP_PATH"
        log "updated -> build $NEW; relaunched"
        """
    }
}
