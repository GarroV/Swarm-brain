# bumblebee — macOS рекордер встреч

> **Имя.** Для человека приложение называется **bumblebee** (со строчной, латиницей): так оно
> подписано в `/Applications`, в Privacy & Security и во встречах. Внутри — код, папка `recorder/`,
> Swift-таргет `SwarmRecorder`, bundle id `io.dodobrands.swarmrecorder`, сертификат
> «SwarmRecorder Self-Signed», папка данных `~/Library/Application Support/SwarmRecorder/` и
> `source=desktop-agent` в базе — **остались прежними намеренно**: на bundle id и сертификате
> висит TCC-грант на запись системного звука, в папке лежат токен и неотправленные записи.
> Канон решения — [../docs/decisions/2026-08-28-recorder-renamed-bumblebee.md](../docs/decisions/2026-08-28-recorder-renamed-bumblebee.md).

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

## Идентичность встречи и авто-детект

**Локальным** macOS-Календарём (EventKit) не пользуемся — им в команде никто не пользуется. А вот
**Google Calendar используем — на сервере** (OAuth-интеграция, эдж-функция `meeting-current`): рекордер
спрашивает «какая встреча идёт сейчас» и получает её название, участников, начало и **плановый конец**
(`SwarmClient.currentMeeting()`). Приоритет идентичности: **календарь (Google) → комната из URL браузера
→ manual**. Требует, чтобы пользователь подключил Google Calendar в вебе (Настройки → Google-календарь).

**Дедуп — по комнате из ссылки звонка.** При старте записи рекордер читает URL активной вкладки
браузера (Meet / Контур.Толк) и берёт ключ комнаты (`identity_kind=room`, напр.
`meet:abc-defg-hij`). Ключ одинаков у всех по одной ссылке → сервер схлопывает записи участников
в **одну** встречу (транскрибирует один раз). Требует разрешения Automation (чтение URL браузера).
Не вышло → `manual:<uuid>` (без авто-дедупа). **Название встречи** берётся из заголовка вкладки
(тема созвона; чистится от шума платформы/кода комнаты), пусто → дата-дефолт «Встреча <юзер> · <дата>».

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
держит мик; требует, чтобы созвон хоть раз был замечен — «пустой» ручной старт не оборвётся);
(в) для браузерных созвонов — **вкладка комнаты (Meet/Контур) закрыта/ушла ~20с** (прямее и быстрее
«3 минут тишины»; тем же `recWatchTick` опрашиваются все вкладки запущенных браузеров, ключ комнаты
известен со старта; ошибка чтения вкладок = «не уверены» → не стопаем; закрытый браузер не будим).
Счётчик тишины (б) устойчив к одиночным «блипам» (уведомление/звук выхода): сброс только на 2 не-тихих
тиках подряд. **(г) Календарный конец больше НЕ рубит запись** (отменено fix `08da3d7`, 2026-07-29):
раньше по «плановому концу» (`endISO`) при тишине ~30с был стоп с потолком `end+30мин`, но живой звонок
часто идёт дольше слота (или слот — «заглушка»-событие, не связанное с этим звонком) → обрывать по часам
календаря неверно. Конец теперь определяется ТОЛЬКО по тишине (правила а/б/в); `endISO` из `meeting-current`
как стоп-триггер не используется.
Фолбэк: жёсткий стоп через 1ч15м без активного созвона. Авто-стоп **сохраняет** запись (не теряет).
Плавающий виджет показывает **два** живых уровня — мой микрофон и системный звук (видно, что
коллеги пишутся).

**Сон / закрытие крышки** (build 13+). Любой `Timer` (в т.ч. `recWatchTick`) **не тикает, пока Mac
спит** — значит во сне авто-стоп по концу созвона сработать не может, и без обработки запись «висела
бы открытой» весь сон (инцидент 2026-07-20: созвон 103 мин растянулся на 5.5ч wall-clock, стоп сработал
только при пробуждении). Рекордер ловит `NSWorkspace.willSleepNotification`: **закрыл крышку посреди
записи → встреча штатно закрывается и сохраняется** («закрыл ноут = закончил») тем же `autoStop`. На
`didWakeNotification` — дозагрузка бэкапов (замороженный во сне 15-мин `maintenanceTick` мог не подчистить
`done`-встречи) + heartbeat. Ловим **только реальный сон системы** (`willSleep`), а не гашение экрана
(`screensDidSleep`) — иначе долгий созвон без движения мыши оборвался бы на потухшем экране. В clamshell
(крышка закрыта, но внешний монитор + питание) Mac не спит → `willSleep` не приходит → запись идёт штатно.

**Надёжность захвата собеседника (build 5+).** Системный звук идёт через Core Audio process-tap,
который на Bluetooth-выходе способен зависать или тихо умирать (наушники меняют профиль A2DP↔HFP на
звонке → меняется формат устройства). Защита (`SystemAudioCapturer.swift` / `AudioRecorder.swift`):
1. **Стоп с потолком по времени + разделённые очереди.** IOProc-доставка буферов и управляющие
   HAL-вызовы (`AudioDeviceStop`/teardown) — на РАЗНЫХ очередях (раньше на одной → самодедлок HAL).
   Остановка тапа ограничена таймаутом; зависший HAL-teardown намеренно «утекает», но стоп всё равно
   завершается — крестик всегда срабатывает, микрофон финализируется, встреча не теряется.
2. **Watchdog «нулей».** Если тап отдаёт тишину при активном созвоне или сменился формат устройства
   (BT-профиль) — полная пересборка tap+aggregate. Не помогло за пару попыток → **честное уведомление
   «собеседник не пишется»** + красная метка системной полосы в панели (снимается, когда звук вернулся).
3. **Live-пометки пишутся на диск** (`live-notes-current.json`) по ходу — переживают краш/зависание.

**Фидбэк после «Стоп».** Виджет не пропадает молча: сразу показывает капсулу «в обработке»
(крутилка). Когда аудио принято сервером (ingest 202) — приходит уведомление «Запись отправлена —
встреча пошла в обработку». Когда сервер подтверждает `summary_status='done'` — короткая зелёная
галка, затем капсула прячется. Сигналы 202/done идут из `UploadQueue` через `NotificationCenter`
(`.swarmMeetingUploaded` / `.swarmMeetingDone`) в `AppDelegate`. ✕ на капсуле убирает индикатор
(обработка продолжается в фоне). Страховка: если `done` не пришёл за 20 мин — капсула гаснет сама.

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
2. Сборка `.app`-бандла руками: `bumblebee.app/Contents/MacOS/` + сгенерённый `Info.plist`
   (`io.dodobrands.swarmrecorder`, `LSMinimumSystemVersion=13.0`, `LSUIElement=YES`,
   `NSMicrophoneUsageDescription`, `NSAudioCaptureUsageDescription`, `NSAppleEventsUsageDescription`).
   Локальным macOS-Календарём **не пользуемся** (Google Calendar читаем на сервере, `meeting-current`) — TCC-ключей `NSCalendars*` нет (см.
   `Info-keys.plist`).
3. Подпись стабильным self-signed cert `SwarmRecorder Self-Signed` (создаётся один раз через
   `./setup-signing.sh`). TCC-разрешения держатся между пересборками. Ad-hoc подпись (`-s -`)
   **не используется** — она ронит грант.

```sh
./build-app.sh
open bumblebee.app
# логи: log stream --predicate 'process == "SwarmRecorder"'  (или Console.app)
```

При первом запуске macOS попросит доступ к записи экрана/системного звука
(System Settings → Privacy → Screen Recording) и к микрофону — выдать вручную.
После пересборки разрешения может понадобиться выдать заново — известное неудобство.

### Прогон без меню-бара

`bumblebee.app/Contents/MacOS/SwarmRecorder --selftest` — headless: пишет ~6 с (параллельно проигрывая клип через `afplay`),
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

## Авто-обновление (тихое, без переустановки)

Пользователи рекордера — нетехническая команда (маркетинг), поэтому обновление **полностью
автоматическое**: ни терминала, ни кнопок. Apple Developer ID у нас нет (готовый бинарь качать
нельзя — Gatekeeper карантинит ненотаризованное), поэтому рекордер **пересобирается из исходников
на машине пользователя тем же локальным cert** → designated requirement не меняется → **TCC-грант
на запись экрана НЕ слетает**. По сути это автоматизация `install.sh`, которую запускает само
приложение. Код — `Sources/SwarmRecorder/Updater.swift`.

**Как работает (в простое, запись/отправку не рвём):**
1. При старте (через ~30с) и далее не чаще раза в 6ч рекордер дёргает `GET /swarm-recorder-version` → последний build (релизы редкие — чаще незачем).
2. Если сервер новее вшитого `CFBundleVersion` (из `recorder/VERSION`) **и** приложение в простое →
   запускается отсоединённый хелпер: клонирует **пинованный тег** `recorder-build-<N>` (НЕ HEAD
   дев-ветки — чтобы недоделанный код не уехал команде), `swift build`, подпись локальным cert.
3. Подмена `/Applications/bumblebee.app` + перезапуск — только когда нет записи (файл-замок
   `.recording`). Сборка упала / нет cert / нет тега → тихо остаёмся на рабочей версии, ретрай позже.

**Бутстрап:** само авто-обновление впервые появляется в **build 2**. Кто стоит на старой сборке —
**один раз** переустанавливается через `/recordertoken`; дальше обновляется само, навсегда.

### Как выкатить новую версию рекордера (runbook)

> Это рубильник раскатки на ВСЮ команду. Плохую сборку не пушим — сломает всех.

1. Внести изменения в `recorder/`, **поднять `recorder/VERSION`** (напр. `2` → `3`).
2. Закоммитить и смёржить в `main`. **Проверить, что собирается** (`./build-app.sh`).
3. Поставить тег на этот коммит и запушить: `git tag recorder-build-3 && git push origin recorder-build-3`.
4. **Залить готовый zip в Storage — раздача идёт ОТТУДА, не с GitHub** (репозиторий приватный
   с 20.08.2026, release asset анонимно отдаёт 404 — issue #91):
   ```sh
   KEY="$(supabase projects api-keys --project-ref vbqglndbxkpmreccpqmr -o json \
     | python3 -c 'import sys,json;d=json.load(sys.stdin);ks=d["keys"] if isinstance(d,dict) else d;print(next(k["api_key"] for k in ks if k.get("id")=="service_role"))')"
   curl -X POST "https://vbqglndbxkpmreccpqmr.supabase.co/storage/v1/object/swarm_drive/recorder/SwarmRecorder-3.zip" \
     -H "authorization: Bearer $KEY" -H "content-type: application/zip" -H "x-upsert: true" \
     --data-binary @SwarmRecorder-3.zip
   # проверить анонимно: curl -sS -o /dev/null -w '%{http_code}\n' \
   #   https://vbqglndbxkpmreccpqmr.supabase.co/storage/v1/object/public/swarm_drive/recorder/SwarmRecorder-3.zip
   ```
5. Поднять `LATEST_BUILD` в `supabase/functions/swarm-recorder-version/index.ts` до `3`, задеплоить:
   `supabase functions deploy swarm-recorder-version --no-verify-jwt`.
   ⚠️ **Только после шага 4** — `LATEST_BUILD` без залитого файла раздаёт 404 всем.
6. Готово — рекордеры тихо обновятся в простое. **Не за 15 минут:** чек версии троттлится `updateCheckMinInterval` = 6 часов (`AppDelegate`), а `maintenanceTick` раз в 15 минут лишь предлагает его. То есть свежую сборку человек получит при следующем запуске приложения либо в пределах ~6 часов простоя; кому надо сразу — пункт меню «Обновить bumblebee · сборка N». Лог у пользователя:
   `~/Library/Application Support/SwarmRecorder/self-update.log`.

### Обновление по требованию (пункт меню)

Кроме тихого авто-апдейта в меню есть пункт **«Обновить bumblebee · сборка N»**: спрашивает
сервер версий и, если там новее, запускает то же обновление сразу, с понятным ответом в диалоге
(«установлена последняя», «идёт запись — обновлю после встречи», «нет сети»). Нужен потому, что
иначе единственный известный пользователю способ обновиться вёл в бота за перевыпуском токена, а
перевыпуск гасит рабочую установку, если человек не дойдёт до конца ([#146](https://github.com/GarroV/Swarm-brain/issues/146)).

Решение принимает `Updater.decide(config:bundlePath:isIdle:)` — **одна функция на кнопку и на смоук**:

```sh
/Applications/bumblebee.app/Contents/MacOS/SwarmRecorder --selftest-update           # что решит кнопка
/Applications/bumblebee.app/Contents/MacOS/SwarmRecorder --selftest-update --apply   # и выполнить
```

⚠️ Флаг работает только на сборке ≥ 26. Более старый бинарь неизвестный аргумент **игнорирует** и
запускается вторым экземпляром меню-бара — выглядит как «команда зависла» (проверено на себе).

### Переходное имя бандла внутри архива (снять, когда у всех build ≥ 24)

Приложение называется `bumblebee.app`, но **внутри раздаваемого zip бандл пока лежит как
`SwarmRecorder.app`**: апдейтер сборок ≤ 23 ищет в архиве буквально это имя и при другом молча
остаётся на старой версии (`no SwarmRecorder.app inside archive; keep current`). Переименовывает
себя само приложение — `Updater.runBundleRename()` при первом запуске переносит
`/Applications/SwarmRecorder.app` → `/Applications/bumblebee.app` (вне записи, с возвратом на место
при любой осечке). Проверить, что переход закончен:

```sql
select recorder_last_version, count(*) from allowed_users where recorder_token_hash is not null group by 1;
```

Все ≥ 24 → в `build-app-ci.sh` можно поставить `APP="bumblebee.app"`, а ветку со старым именем
убрать из `Updater.swift` и из установщика.

### Иконка

Марка — схематичный шмель линиями: тело с четырьмя полосами, два крыла по бокам, усики, острый
низ (референс владельца, build 25). Иконка рисуется **кодом**, а не лежит картинкой: геометрия —
`Sources/SwarmRecorder/RoyArt.swift` (меню-бар, виджет), `.icns` собирает `./gen-icon.sh` тем же кодом (компилирует `gen-icon.swift`
вместе с `RoyArt.swift`, поэтому иконка приложения и меню-бара не разъезжаются). `build-app.sh` и
`build-app-ci.sh` зовут его сами. Правишь марку — правь `RoyArt.swift`, а не `.icns`.
   ⚠️ **Пока не починен апдейтер (issue #91), шаг 6 не работает:** `Updater.swift` собирает новую
   версию из `git clone` приватного репозитория → отказ авторизации → `keep current`, молча.
   До перевода апдейтера на скачивание zip обновление доезжает только переустановкой установщиком.

Источник версии — наш Supabase (`swarm-recorder-version`), **GitHub API не используется**.

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
xattr -dr com.apple.quarantine bumblebee.app && open bumblebee.app
```
(в этом случае подпись чужая/ad-hoc → разрешения придётся выдать на своей машине заново; путь А стабильнее).

## Что дальше (итерации)
1. ~~Дедуп по комнате из ссылки (Meet/Контур)~~ ✅; ~~авто-детект звонка по микрофону с согласием~~ ✅; ~~онбординг токена~~ ✅ («Вставить токен…»). Локальный macOS-Календарь сознательно не используется (Google Calendar — на сервере, `meeting-current`).
2. ~~Нарезка длинных записей~~ ✅ + ~~durable-обработка~~ ✅. `Segmenter` режет дорожку на части **≤24 МБ И ≤15 мин** (passthrough-trim m4a, без перекодирования), грузит манифестом `sys_parts`/`mic_parts` `[{name,offset}]`. Сервер больше НЕ транскрибирует всё в одном вызове (длинная встреча убивала воркер по wall-clock ~400s): `meeting-ingest` кладёт части в Storage (бакет `meeting-audio`) и делает короткий inline-проход; длинную **добивает по куску за тик** cron-функция `meeting-process` (pg_cron каждую минуту), переживая лимит воркера. Прогресс — в `meetings.process_state`; heartbeat `last_progress_at` (watchdog валит в `failed` только по застою, не убивает здоровую длинную встречу). Системный звук — 24 kbps. Лимит ≤15 мин/часть и нужен ровно для того, чтобы один whisper-вызов влезал в бюджет тика.
3. ~~Очередь/ретраи на диск (переживать перезапуск)~~ ✅ `UploadQueue` (`pending/`, ретраи с бэкоффом, dead-letter `failed/`). **+ Локальный бэкап аудио:** запись НЕ удаляется на 202 (приём ≠ обработка) — живёт как бэкап до подтверждения обработки (`summary_status='done'`, опрос `meeting-status`) или до **24ч-потолка** (`sweepExpired`). Защита от потери при сбое серверной обработки. Дрейн — старт + после записи + раз в 15 мин.
4. Индикатор статуса/«переотправить» в меню.
5. ~~Распространение команде~~ ✅ задокументировано (см. «Распространение»: `install.sh` — сборка на машине, без Gatekeeper-трения; либо `.zip` + de-quarantine). Платный Apple-аккаунт по-прежнему не нужен.
