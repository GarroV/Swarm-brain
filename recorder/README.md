# SwarmRecorder — macOS рекордер встреч

Лёгкое меню-бар приложение: записывает звук онлайн-звонка → отправляет аудио в Swarm Brain
(`meeting-claim` → `meeting-ingest`), где сервер транскрибирует (OpenAI) и делает тезисы.
Контракт — `../transcribator/02-API-CONTRACT.md`, дизайн — `../transcribator/10-REVISED-DESIGN.md`.

Агент **тупой**: запись → claim → загрузка аудио. Никакой LLM-логики на клиенте — транскрибация
и тезисы целиком на сервере.

## Две дорожки звука

Одна сессия пишет **две** независимые дорожки в AAC `.m4a`:

- **системный звук** (удалённые участники) — через `ScreenCaptureKit`;
- **микрофон** (локальный юзер) — через `AVAudioRecorder`.

Сведение **не на клиенте**: оба файла уходят на сервер, он транскрибирует каждую дорожку
(`whisper-1`, `verbose_json`) и сводит сегменты по таймстампам (общий старт сессии) с метками
«собеседник»/«я». Так надёжнее, чем real-time микшировать два потока в коде.

Микрофон — best-effort: если нет доступа или ошибка, запись продолжается **только** с системным
звуком (в результате `mic = nil`, на сервер уходит лишь `audio`).

## Идентичность встречи (дедуп нескольких записавших)

При старте записи рекордер ищет **идущее сейчас событие календаря** (EventKit) и отправляет его
в `claim` как `identity_kind=calendar`, `identity_key = <iCalUID>:<дата>`. Ключ одинаков у всех
участников → сервер схлопывает их записи в **одну** встречу (транскрибирует один раз). Вместе с
ключом уезжают название и участники события (`meetings.attendees`). Нет события календаря →
`manual:<uuid>` (своя встреча без авто-дедупа). Требует доступа к Календарю при первом запуске.

**Ad-hoc без календаря:** при ручном старте, если события нет, рекордер читает URL активной
вкладки браузера (Meet / Контур.Толк) и берёт ключ комнаты (`identity_kind=room`, напр.
`meet:abc-defg-hij`) — требует разрешения Automation. Не вышло → `manual`.

**Авто-детект (с согласием):** таймер опрашивает календарь; при идущей встрече показывает
уведомление «Встреча X идёт — записать?» и пункт меню «🔴 Записать эту встречу». Запись
стартует **только** по явному действию — никогда молча. Отклонённую/записанную встречу
повторно не предлагает.

## Статус

E2E доказан: `--selftest` прогоняет полный цикл (захват → `claim` → загрузка → тезисы на сервере).

| Модуль | Заметки |
|---|---|
| `SwarmTypes.swift` (Config, Codable-модели) | по контракту прода |
| `SwarmClient.swift` (claim + upload, ретраи) | контракт проверен на проде |
| `Permissions.swift` (Screen/Mic TCC) | стандартные API; микрофон запрашивается при запуске |
| `Calendar.swift` (EventKit: идентичность встречи) | календарный ключ дедупа + название + участники |
| `AudioRecorder.swift` (две дорожки: ScreenCaptureKit + AVAudioRecorder → m4a) | прогнан в `--selftest` |
| `AppDelegate.swift` / `main.swift` (меню-бар, `--selftest`) | AppKit `NSStatusItem`, `LSUIElement` |

## Сборка — `build-app.sh` (полный Xcode не нужен)

Основной путь — `./build-app.sh`. Скрипту достаточно **Command Line Tools** (SwiftPM):

1. `swift build -c release` — собирает бинарь.
2. Сборка `.app`-бандла руками: `SwarmRecorder.app/Contents/MacOS/` + сгенерённый `Info.plist`
   (`io.dodobrands.swarmrecorder`, `LSMinimumSystemVersion=13.0`, `LSUIElement=YES`,
   `NSMicrophoneUsageDescription`, `NSCalendarsUsageDescription`, `NSCalendarsFullAccessUsageDescription`).
3. Ad-hoc подпись: `codesign --force --deep -s - SwarmRecorder.app` — TCC-разрешения для
   локального теста при этом работают.

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
3. **Info.plist** — те же ключи, что генерит `build-app.sh`: `LSUIElement=YES`, `NSMicrophoneUsageDescription`, `NSCalendarsUsageDescription`. Запись экрана/системного звука TCC-строки не требует, но требует разрешения в System Settings при первом запуске.
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

## Распространение команде

Платный Apple Developer-аккаунт и нотаризацию не используем. Два пути:

**А. Сборка на машине (рекомендуется)** — локально собранное приложение Gatekeeper **не
карантинит**, TCC-разрешения стабильны между обновлениями:
```sh
cd swarm/recorder
./install.sh          # соберёт, поставит в /Applications, откроет
```
Нужны Command Line Tools (`xcode-select --install`). Дальше в меню — «Вставить токен…».

**Б. Получили `.zip` с собранным `.app`** — снять карантин и открыть:
```sh
xattr -dr com.apple.quarantine SwarmRecorder.app && open SwarmRecorder.app
```
Минус: ad-hoc подпись меняется при каждой пересборке → после обновления TCC-разрешения может
понадобиться выдать заново. Для частых обновлений путь А удобнее.

## Что дальше (итерации)
1. ~~Идентичность по календарю~~ ✅; ~~авто-старт с согласием~~ ✅; ~~room-id из URL (Meet/Контур)~~ ✅; ~~онбординг токена~~ ✅ («Вставить токен…»).
2. Нарезка длинных записей (>25 МБ/дорожку ≈ 2,3 ч): сейчас честная ошибка-заглушка; полная нарезка (сегментация на клиенте + multipart-контракт, т.к. edge без ffmpeg) — отдельная итерация.
3. Очередь/ретраи на диск (переживать перезапуск), как в `SwarmClient` заложено.
4. Индикатор статуса/«переотправить» в меню.
5. ~~Распространение команде~~ ✅ задокументировано (см. «Распространение»: `install.sh` — сборка на машине, без Gatekeeper-трения; либо `.zip` + de-quarantine). Платный Apple-аккаунт по-прежнему не нужен.
