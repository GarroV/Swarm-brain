import Foundation

// Тихий авто-апдейт. Пользователи рекордера — нетехнари (маркетинг), поэтому без кнопок и
// терминала: фоном, в простое, сам. Apple Developer ID у нас нет → готовый бинарь качать нельзя
// (Gatekeeper карантинит ненотаризованное). Поэтому ПЕРЕСОБИРАЕМ из исходников тем же локальным
// cert «SwarmRecorder Self-Signed» → designated requirement не меняется → TCC-грант на запись
// экрана НЕ слетает. По сути — автоматизация install.sh, запускаемая самим приложением.
enum Updater {
    static let repoURL = "https://github.com/GarroV/Swarm-brain"
    // Обновляемся ТОЛЬКО на пинованный тег recorder-build-<N> (а не на HEAD дев-ветки sandbox_vas) —
    // иначе авто-апдейт мог бы притащить недоделанный код в простой коммит маркетологам. Тег = ровно
    // протестированная сборка. Нет тега → clone падает → тихо остаёмся на текущей версии.
    static func releaseTag(_ build: Int) -> String { "recorder-build-\(build)" }

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

    // Спросить сервер последний доступный build. nil при любой ошибке → не обновляемся.
    static func latestBuild(config: SwarmConfig) async -> Int? {
        let base = config.ingestBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + "/swarm-recorder-version") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 15
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let b = obj["build"] as? Int { return b }
        if let b = obj["build"] as? Double { return Int(b) }
        if let s = obj["build"] as? String { return Int(s) }
        return nil
    }

    // Запустить отсоединённый апдейтер. Сборка идёт при живом приложении (простоя на сборку нет);
    // подмена /Applications + перезапуск — только когда нет recording-lock. Сборку упала / cert
    // отсутствует / версия не новее → ничего не трогаем, остаёмся на рабочей версии.
    static func runUpdater(currentBuild cur: Int, targetBuild: Int) {
        let appPath = Bundle.main.bundlePath
        let pid = ProcessInfo.processInfo.processIdentifier
        let dir = supportDir()
        let scriptURL = dir.appendingPathComponent("self-update.sh")
        let logPath = dir.appendingPathComponent("self-update.log").path
        let lockPath = recordingLockURL.path
        let tag = releaseTag(targetBuild)

        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard (try? script(appPath: appPath).write(to: scriptURL, atomically: true, encoding: .utf8)) != nil else { return }

        // Полностью отсоединяем (nohup + &): хелпер должен пережить наш SIGTERM и перезапуск.
        // Аргументы: pid, текущий build, путь .app, lock, git-тег релиза.
        let cmd = "nohup bash \(shq(scriptURL.path)) \(pid) \(cur) \(shq(appPath)) \(shq(lockPath)) \(shq(tag)) >> \(shq(logPath)) 2>&1 &"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", cmd]
        try? p.run()
    }

    // Экранирование одиночными кавычками для безопасной подстановки путей в bash.
    private static func shq(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    // Текст хелпера. Принимает: $1=pid приложения, $2=текущий build, $3=путь .app, $4=lock.
    private static func script(appPath: String) -> String {
        """
        #!/bin/bash
        set -u
        REPO=\(shq(repoURL))
        APP_PID="$1"; CUR="$2"; APP_PATH="$3"; LOCK="$4"; TAG="$5"
        log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
        log "self-update: current build $CUR → tag $TAG, app $APP_PATH (pid $APP_PID)"
        command -v git >/dev/null 2>&1   || { log "no git; skip"; exit 0; }
        command -v swift >/dev/null 2>&1 || { log "no swift toolchain; skip"; exit 0; }
        TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
        # Клонируем ПИНОВАННЫЙ тег релиза (не HEAD дев-ветки). Нет тега → падаем → остаёмся как есть.
        if ! git clone --depth 1 --branch "$TAG" "$REPO" "$TMP/src" >/dev/null 2>&1; then log "clone tag $TAG failed (нет тега? нет сети?); keep current"; exit 0; fi
        cd "$TMP/src/recorder" || { log "no recorder/ dir"; exit 0; }
        # Робастно и set -u-safe: дефолт 0, читаем только если файл доступен, пустой → 0.
        # (Старый `$(... || echo 0)` не ловил ПУСТОЙ успех tr → под set -u падало «NEW: unbound».)
        NEW="0"; [ -r VERSION ] && NEW="$(tr -cd '0-9' < VERSION 2>/dev/null)"; [ -n "${NEW:-}" ] || NEW="0"
        if [ "$NEW" -le "$CUR" ]; then log "not newer (repo VERSION=$NEW <= $CUR); skip"; exit 0; fi
        # Стабильный cert обязателен — иначе подпись схлопнется в ad-hoc и грант на запись слетит.
        if ! security find-identity -p codesigning 2>/dev/null | grep -q "SwarmRecorder Self-Signed"; then log "no signing cert; skip (would break TCC)"; exit 0; fi
        log "building build $NEW…"
        if ! ./build-app.sh >/dev/null 2>&1; then log "build failed; keep current version"; exit 0; fi
        [ -d "SwarmRecorder.app" ] || { log "build produced no app; keep current"; exit 0; }
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
        [ -f "$LOCK" ] && { log "lock present after quit; abort"; exit 0; }
        # Безопасная подмена: НИКОГДА не оставляем слот пустым. Стейджим рядом → старое в .bak →
        # новое на место → если финальный шаг упал, возвращаем .bak. Сбой стейджа = старое не тронуто.
        STAGE="${APP_PATH}.new-$$"; BAK="${APP_PATH}.bak-$$"
        rm -rf "$STAGE" "$BAK"
        if ! cp -R SwarmRecorder.app "$STAGE"; then log "stage copy failed; current app untouched"; rm -rf "$STAGE"; open "$APP_PATH" 2>/dev/null || true; exit 0; fi
        xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true
        if ! mv "$APP_PATH" "$BAK" 2>/dev/null; then log "cannot move current aside; abort"; rm -rf "$STAGE"; open "$APP_PATH" 2>/dev/null || true; exit 0; fi
        if ! mv "$STAGE" "$APP_PATH" 2>/dev/null; then log "swap failed; restoring backup"; mv "$BAK" "$APP_PATH" 2>/dev/null || true; rm -rf "$STAGE"; open "$APP_PATH" 2>/dev/null || true; exit 1; fi
        rm -rf "$BAK"
        open "$APP_PATH"
        log "updated -> build $NEW; relaunched"
        """
    }
}
