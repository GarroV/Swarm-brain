# SwarmRecorder — macOS рекордер встреч

Лёгкое меню-бар приложение: записывает звук онлайн-звонка → отправляет аудио в Swarm Brain
(`meeting-claim` → `meeting-ingest`), где сервер транскрибирует (OpenAI) и делает тезисы.
Контракт — `../transcribator/02-API-CONTRACT.md`, дизайн — `../transcribator/10-REVISED-DESIGN.md`.

Агент **тупой**: запись → claim → загрузка аудио. Никакой LLM-логики на клиенте — транскрибация
и тезисы целиком на сервере.

## Две дорожки звука

Одна сессия пишет **две** независимые дорожки в AAC `.m4a`:

- **системный звук** (удалённые участники) — через `ScreenCaptureKit` (или Core Audio process-tap на macOS 14.4+);
- **микрофон** (локальный юзер) — через `AVAudioRecorder`.

Сведение **не на клиенте**: оба файла уходят на сервер, он транскрибирует каждую дорожку
(`whisper-1`, `verbose_json`) и сводит сегменты по таймстампам (общий старт сессии) с метками
«собеседник»/«я». Так надёжнее, чем real-time микшировать два потока в коде.

Микрофон — best-effort: если нет доступа или ошибка, запись продолжается **только** с системным
звуком (в результате `mic = nil`, на сервер уходит лишь `audio`).

## Идентичность встречи и авто-детект (без календаря)

Календарём (ни macOS, ни серверным) **не пользуемся** — им никто не пользуется в команде.

**Дедуп — по комнате из ссылки звонка.** При старте записи рекордер читает URL активной вкладки
браузера (Meet / Контур.Толк) и берёт ключ комнаты (`identity_kind=room`, напр.
`meet:abc-defg-hij`). Ключ одинаков у всех по одной ссылке → сервер схлопывает записи участников
в **одну** встречу (транскрибирует один раз). Требует разрешения Automation (чтение URL браузера).
Не вышло → `manual:<uuid>` (без авто-дедупа).

**Авто-детект звонка — по микрофону, с согласием.** `CallDetector` (CoreAudio) следит, занят ли
вход: как только любое приложение начинает использовать микрофон (идёт звонок) — рекордер шлёт
уведомление «Идёт звонок — записать?» и пункт меню «🔴 Записать звонок». Запись стартует **только**
по явному действию — никогда молча. «Не сейчас» → не предлагает 10 минут. Календарь не нужен,
работает для любого приложения звонков.

**Авто-стоп — по концу звонка** (`recWatchTick`, раз в 5с). Запись останавливается сама, когда:
(а) конференц-приложение **отпустило микрофон** на ~15с подряд — надёжно для нативных Zoom/Teams;
(б) **системная дорожка молчит ≥ 3 мин** — для звонков в **браузере** (Meet/Контур в табе) браузер
держит микрофон непрерывно и после выхода из звонка, поэтому mic-правило (а) не срабатывает →
тишина собеседников остаётся единственным надёжным сигналом конца (срабатывает, даже пока браузер
держит мик; требует, чтобы созвон хоть раз был замечен — «пустой» ручной старт не оборвётся).
Фолбэк: жёсткий стоп через 1ч15м без активного созвона. Авто-стоп **сохраняет** запись (не теряет).
Плавающий виджет показывает **два** живых уровня — мой микрофон и системный звук (видно, что
коллеги пишутся).

## Статус

E2E доказан: `--selftest` прогоняет полный цикл (захват → `claim` → загрузка → тезисы на сервере).

| Модуль | Заметки |
|---|---|
| `SwarmTypes.swift` (Config, Codable-модели) | по контракту прода |
| `SwarmClient.swift` (claim + upload, ретраи) | контракт проверен на проде |
| `Permissions.swift` (Screen/Mic TCC) | стандартные API; микрофон запрашивается при запуске |
| `CallDetector.swift` (CoreAudio: детект звонка по микрофону) | авто-предложение записи без календаря |
| `BrowserRoom.swift` / `MeetingIdentity.swift` (комната из URL → ключ дедупа) | Meet/Контур, иначе manual |
| `AudioRecorder.swift` (две дорожки: ScreenCaptureKit + AVAudioRecorder → m4a) | прогнан в `--selftest` |
| `AppDelegate.swift` / `main.swift` (меню-бар, `--selftest`) | AppKit `NSStatusItem`, `LSUIElement` |

## Сборка — `build-app.sh` (полный Xcode не нужен)

Основной путь — `./build-app.sh`. Скрипту достаточно **Command Line Tools** (SwiftPM):

1. `swift build -c release` — собирает бинарь.
2. Сборка `.app`-бандла руками: `SwarmRecorder.app/Contents/MacOS/` + сгенерённый `Info.plist`
   (`io.dodobrands.swarmrecorder`, `LSMinimumSystemVersion=13.0`, `LSUIElement=YES`,
   `NSMicrophoneUsageDescription`, `NSAudioCaptureUsageDescription`, `NSAppleEventsUsageDescription`).
   Календарём (ни macOS, ни серверным) **не пользуемся** — TCC-ключей `NSCalendars*` нет (см.
   `Info-keys.plist`).
3. Подпись стабильным self-signed cert `SwarmRecorder Self-Signed` (создаётся один раз через
   `./setup-signing.sh`). TCC-разрешения держатся между пересборками. Ad-hoc подпись (`-s -`)
   **не используется** — она ронит грант.

```sh
./build-app.sh
open SwarmRecorder.app
# логи: log stream --predicate 'process == "SwarmRecorder"'  (или Console.app)
```

При первом запуске macOS попросит доступ к записи экрана/системного звука
(System Settings → Privacy → Screen Recording) и к микрофону — выдать вручную.
После пересборки разрешения может понадобиться выдать заново — известное неудобство.

### Прогон без меню-бара

`SwarmRecorder --selftest` — headless: пишет ~6 с (параллельно проигрывая клип через `afplay`),
печатает размеры дорожек и, если найден `config.json`, делает `claim` + загрузку своим же
`SwarmClient`. Маркеры в выводе: `SELFTEST_CAPTURE`, `SELFTEST_CLAIM`, `SELFTEST_UPLOAD`.

### Альтернатива — Xcode (опционально, удобнее для отладки)

`.xcodeproj` намеренно не версионируется (хрупко). Если нужен Xcode для отладки — создать проект руками:

1. **Xcode → File → New → Project → macOS → App.** Name: `SwarmRecorder`, Interface: **AppKit (не SwiftUI)**, Language: Swift. Minimum Deployments: **macOS 13.0**.
2. Удалить сгенерённые `AppDelegate.swift`/`main`/`MainMenu.xib`/`ViewController` и **перетащить файлы из `Sources/SwarmRecorder/`** в проект.
3. **Info.plist** — те же ключи, что генерит `build-app.sh`: `LSUIElement=YES`, `NSMicrophoneUsageDescription`, `NSAudioCaptureUsageDescription`, `NSAppleEventsUsageDescription` (календарь не используется — `NSCalendars*` нет). Запись экрана/системного звука TCC-строки не требует, но требует разрешения в System Settings при первом запуске.
4. **Signing & Capabilities:** для локального запуска хватит автоматической подписи Xcode (Team = твой Apple ID). App Sandbox можно **выключить** (ScreenCaptureKit + сеть проще без песочницы).
5. Прописать конфиг (токен + URL) — см. ниже.
6. **Run** (⌘R).

## Конфиг

`SwarmConfig` читается из `~/Library/Application Support/SwarmRecorder/config.json`:
```json
{
  "token": "smcp_...",
  "ingestBaseURL": "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1",
  "webBaseURL": ""
}
```
Токен — персональный `smcp_` из бота (`/mytoken`). Личность и `group_id` сервер берёт из токена
(SHA-256-хэш в `allowed_users`), не из payload — спуфинга нет. Файл можно положить руками **или**
вставить токен через меню рекордера («Вставить токен…») — URL прод-окружения зашиты, пользователю
нужен только токен.

## Установка из бота (`/recordertoken`)

Самый простой путь — одна команда, всё делает за тебя. В боте набери **`/recordertoken`**,
он пришлёт строку вида:

```sh
curl -fsSL https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-recorder-setup | SWARM_TOKEN='smcp_…' bash
```

Вставь её в Терминал. Скрипт сам:
1. поставит **Command Line Tools** (если их нет — один скачивание, может занять минуты);
2. склонирует публичный репозиторий;
3. создаст локальный cert подписи (`setup-signing.sh`) — **без доверия и без пароля** (codesign подписывает им и так);
4. соберёт, подпишет и поставит приложение в `/Applications`, откроет его;
5. сам пропишет токен в `config.json` (вручную «Вставить токен…» уже не нужно).

После этого остаётся **один** шаг — выдать разрешение «Screen & System Audio Recording»
(System Settings → Privacy & Security), затем **выйти из рекордера (⌘Q) и открыть заново**
(macOS применяет разрешение только после перезапуска). Честно: единственный возможный запрос
пароля — скачивание Command Line Tools (если их ещё нет); сертификат и сборка идут БЕЗ запросов.

Edge-функция: `supabase/functions/swarm-recorder-setup` (публичный GET, без секретов).

## Распространение команде

Платный Apple Developer-аккаунт и нотаризацию не используем. Два пути:

**А. Сборка на машине (рекомендуется):**
```sh
cd swarm/recorder
./setup-signing.sh    # один раз на машину: создаёт локальный cert подписи (без доверия/пароля)
./install.sh          # соберёт, подпишет, поставит в /Applications, откроет
```
Нужны Command Line Tools (`xcode-select --install`). Дальше в меню — «Вставить токен…»
(или используй one-liner из `/recordertoken`, который делает всё это сам, включая токен).

### Стабильная подпись (TCC) — один раз на машину
macOS привязывает выданные разрешения (Screen & System Audio Recording и пр.) к **designated
requirement** подписи = `identifier + certificate leaf`, **не** к cdhash. Со **стабильным
самоподписанным cert** разрешение выдаётся ОДИН раз и держится между пересборками. Ad-hoc-подпись
(`-s -`) cert не имеет → DR схлопывается в cdhash → грант слетает каждую сборку. `build-app.sh`
подписывает идентичностью `SwarmRecorder Self-Signed`; если её нет — **жёсткая ошибка** (ad-hoc
fallback убран, он ронял TCC). Cert **не требуется доверять** — codesign подписывает им и недоверенным.

Создать её **один раз** (CLI; либо Keychain Access → Certificate Assistant → Create a Certificate →
тип «Code Signing», self-signed root):
```sh
openssl req -x509 -newkey rsa:2048 -keyout /tmp/cs.key -out /tmp/cs.crt -days 3650 -nodes \
  -subj "/CN=SwarmRecorder Self-Signed" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"
# -legacy/-macalg sha1 — иначе macOS `security` не примет p12 от OpenSSL 3 («MAC verification failed»)
openssl pkcs12 -export -inkey /tmp/cs.key -in /tmp/cs.crt -out /tmp/cs.p12 \
  -passout pass:temp -name "SwarmRecorder Self-Signed" -legacy -macalg sha1
security import /tmp/cs.p12 -k ~/Library/Keychains/login.keychain-db -P temp -T /usr/bin/codesign
# Доверять cert НЕ нужно (codesign -s подписывает и недоверенным; локальный .app Gatekeeper не карантинит).
rm -f /tmp/cs.key /tmp/cs.crt /tmp/cs.p12
security find-identity -p codesigning    # должна появиться «SwarmRecorder Self-Signed» (без -v — доверие не нужно)
```
НЕ пересоздавать cert и НЕ переносить app из `/Applications` — и то, и другое меняет DR → грант сбросится.
Энтайтлмент для системного звука (Core Audio process-tap) НЕ нужен (приложение без sandbox и без
hardened runtime; в `build-app.sh` намеренно нет `--options runtime`). Хватает `NSAudioCaptureUsageDescription` + TCC-грант.

**Б. Получили `.zip` с собранным `.app`** — снять карантин и открыть:
```sh
xattr -dr com.apple.quarantine SwarmRecorder.app && open SwarmRecorder.app
```
(в этом случае подпись чужая/ad-hoc → разрешения придётся выдать на своей машине заново; путь А стабильнее).

## Что дальше (итерации)
1. ~~Дедуп по комнате из ссылки (Meet/Контур)~~ ✅; ~~авто-детект звонка по микрофону с согласием~~ ✅; ~~онбординг токена~~ ✅ («Вставить токен…»). Календарь сознательно не используется.
2. ~~Нарезка длинных записей~~ ✅ + ~~durable-обработка~~ ✅. `Segmenter` режет дорожку на части **≤24 МБ И ≤15 мин** (passthrough-trim m4a, без перекодирования), грузит манифестом `sys_parts`/`mic_parts` `[{name,offset}]`. Сервер больше НЕ транскрибирует всё в одном вызове (длинная встреча убивала воркер по wall-clock ~400s): `meeting-ingest` кладёт части в Storage (бакет `meeting-audio`) и делает короткий inline-проход; длинную **добивает по куску за тик** cron-функция `meeting-process` (pg_cron каждую минуту), переживая лимит воркера. Прогресс — в `meetings.process_state`; heartbeat `last_progress_at` (watchdog валит в `failed` только по застою, не убивает здоровую длинную встречу). Системный звук — 24 kbps. Лимит ≤15 мин/часть и нужен ровно для того, чтобы один whisper-вызов влезал в бюджет тика.
3. Очередь/ретраи на диск (переживать перезапуск), как в `SwarmClient` заложено.
4. Индикатор статуса/«переотправить» в меню.
5. ~~Распространение команде~~ ✅ задокументировано (см. «Распространение»: `install.sh` — сборка на машине, без Gatekeeper-трения; либо `.zip` + de-quarantine). Платный Apple-аккаунт по-прежнему не нужен.
