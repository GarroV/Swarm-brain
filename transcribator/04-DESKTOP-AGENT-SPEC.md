# 04 — Рекордер: своё лёгкое macOS-приложение

> **Разворот.** Прежняя версия этого документа описывала форк `fastrepl/anarlog` (Tauri/Rust, плагин `plugin-swarm`, локальный Whisper `large-v3-turbo`). Этот план снят целиком. Рекордер — **своё** нативное macOS-приложение на Swift/AppKit (`recorder/` в репо), транскрибация — **в облаке** на сервере (OpenAI), а не на клиенте. Ниже — спецификация по факту кода.

Рекордер — это тонкий клиент. Его единственная работа: записать звук онлайн-звонка двумя дорожками и отдать аудио серверу. **Ноль LLM-логики на клиенте**: ни транскрибации, ни тезисов, ни шаблонов, ни поиска — всё это делает бэкенд (`meeting-ingest`) и веб. Контракт — `10-REVISED-DESIGN.md`.

Папка: `recorder/`. Bundle id: `io.dodobrands.swarmrecorder`. Минимальная macOS — 13.0.

---

## 1. Что это и чем не является

| Это | Это НЕ |
|---|---|
| Нативное Swift/AppKit меню-бар приложение | Tauri / Rust / Electron / форк anarlog |
| ScreenCaptureKit + AVAudioRecorder → две дорожки AAC m4a | Локальный Whisper / whisper.cpp / GGUF-модели |
| Запись → claim → загрузка аудио на сервер | Транскрибация и генерация тезисов на клиенте |
| Сборка SwiftPM + ручной .app-бандл + ad-hoc подпись | Полный Xcode-проект как обязательное условие |
| Тупой агент без бизнес-логики | Редактор сессий, чат, шаблоны, поиск (всё в вебе/рое) |

Транскрибация и тезисы живут на сервере. Шаг транскрибации сменный: если в команде появится машина с NVIDIA-GPU, теоретически можно переехать на локальный Whisper без смены контракта рекордера — но это не текущий план, а лишь свойство архитектуры (рекордер шлёт аудио, ему всё равно, чем оно транскрибируется).

---

## 2. Структура `recorder/`

```
recorder/
├── Package.swift             # SwiftPM-обёртка (swift build), platforms: macOS 13
├── build-app.sh              # сборка .app-бандла + ad-hoc подпись (без полного Xcode)
├── Info-keys.plist           # ключи Info.plist (LSUIElement, TCC usage strings)
├── README.md                 # статус модулей, конфиг, итерации
└── Sources/SwarmRecorder/
    ├── main.swift            # точка входа: --selftest или меню-бар (NSApplication.accessory)
    ├── AppDelegate.swift     # меню-бар: статус-икона, меню, ручной старт/стоп записи
    ├── AudioRecorder.swift   # две дорожки: ScreenCaptureKit (система) + AVAudioRecorder (микрофон)
    ├── SwarmClient.swift     # claim + upload (multipart), ретрай с бэкоффом
    ├── SwarmTypes.swift      # SwarmConfig + Codable-модели контракта (Claim/Ingest)
    └── Permissions.swift     # TCC: запись экрана/системного звука + микрофон
```

Агрегатора `Sources/SwarmRecorder/` достаточно для `swift build`. Файлы `AppDelegate`/`main`/`MainMenu.xib` Xcode не нужны — точка входа собственная (`main.swift`).

---

## 3. Сборка и подпись (без полного Xcode)

Распространяемый `.app` собирается скриптом `build-app.sh`, которому хватает Command Line Tools (полный Xcode не обязателен, он лишь удобнее для отладки):

1. `swift build -c release` — собирает исполняемый бинарь.
2. Складывает `.app`-бандл руками: `Contents/MacOS/SwarmRecorder` + сгенерированный `Contents/Info.plist`.
3. **Ad-hoc подпись:** `codesign --force --deep -s - SwarmRecorder.app` (подпись пустым identity, без сертификата).
4. Проверка подписи `codesign -v`.

Info.plist бандла (генерируется скриптом, ключи зеркалят `Info-keys.plist`):
- `CFBundleIdentifier = io.dodobrands.swarmrecorder`
- `LSMinimumSystemVersion = 13.0`
- `LSUIElement = true` — меню-бар без иконки в Dock и без главного окна
- `NSMicrophoneUsageDescription` — текст для системного запроса доступа к микрофону
- `NSCalendarsUsageDescription` — текст для будущего авто-старта по календарю

Запуск: `open SwarmRecorder.app`. Логи: `log stream --predicate 'process == "SwarmRecorder"'` или Console.app.

> **Распространение бинаря — открытый вопрос.** Платный Apple Developer Program и нотаризация в проекте не используются. Подпись — ad-hoc. Как именно раздавать `.app` остальной команде без платного аккаунта — пока не решено (см. §10). TCC-разрешения пользователь выдаёт вручную при первом запуске; после пересборки бандла macOS может потребовать выдать их заново — известное неудобство переходного периода.

---

## 4. Запись аудио — две дорожки (`AudioRecorder.swift`)

Одна сессия записи пишет **две независимые дорожки** AAC `.m4a`:

| Дорожка | Источник | API | Метка на сервере |
|---|---|---|---|
| `audio` (системный звук) | удалённые участники звонка | ScreenCaptureKit → `AVAssetWriter` | `собеседник` |
| `audio_mic` (микрофон) | владелец записи | `AVAudioRecorder` | `я` |

Сведение **не на клиенте**: оба файла уходят на сервер, он транскрибирует каждый отдельно и сводит сегменты по таймстампам (общий старт сессии), проставляя метки `собеседник`/`я`. Так надёжнее, чем real-time микшировать два потока в коде клиента.

**Системный звук (ScreenCaptureKit):**
- `SCStream` поверх первого дисплея, фильтр без исключений окон.
- `SCStreamConfiguration`: `capturesAudio = true`, `excludesCurrentProcessAudio = true` (не писать собственный звук приложения), `sampleRate = 48000`, `channelCount = 2`. Кадр видео фиктивный 2×2 (нужен формально, контент не используется).
- Сэмплы из `didOutputSampleBuffer` пишутся в `AVAssetWriterInput` (тип `.audio`), кодек MPEG-4 AAC, 16 кГц / моно / 24 kbps на выходе.

**Микрофон (AVAudioRecorder):**
- `kAudioFormatMPEG4AAC`, 16 кГц, 1 канал, 24 kbps — компактный m4a (укладываемся в лимит OpenAI 25 МБ; ~10 МБ на час).
- **Best-effort:** если доступа к микрофону нет или `record()` вернул `false` — продолжаем только с системным звуком, `mic = nil` в результате. Запись звонка не срывается из-за микрофона.
- На остановке: если файл микрофона меньше ~1 КБ — считаем пустым и не отправляем.

`stop()` корректно финализирует обе дорожки (`markAsFinished` + `finishWriting` для системной, `stop()` для микрофонной) и возвращает `Result { system: URL, mic: URL? }`. Файлы пишутся во временную директорию и удаляются после успешной загрузки.

> **Лимит файла OpenAI — 25 МБ на дорожку.** Длинные встречи: нарезка/сжатие на стороне рекордера — TODO (см. §10). Сервер отвечает `413`, если дорожка превышает лимит.

---

## 5. Сетевой клиент (`SwarmClient.swift`)

Два запроса к Edge Functions Swarm Brain. База — `config.ingestBaseURL` (`https://<ref>.supabase.co/functions/v1`). Аутентификация — `Authorization: Bearer <token>` на каждом запросе.

### 5.1 `POST /meeting-claim` — застолбить транскрибацию

Тело JSON (snake_case через `keyEncodingStrategy = .convertToSnakeCase`):
```jsonc
{
  "identity_kind": "manual",      // calendar | room | manual
  "identity_key": "manual:<uuid>",
  "title": "Запись 13.06 14:30",
  "started_at": "<ISO 8601>",
  "ended_at":   "<ISO 8601>",
  "agent_version": "0.1.0"
  // user_notes — поле контракта; в текущем клиенте опускается (окно пометок — итерация)
}
```

Ответ:
```jsonc
{ "meeting_id": "<uuid>", "decision": "transcribe" | "defer", "lease_ttl_sec": 1800 }
```

Сервер регистрирует записавшего в `meetings.recorders` и выдаёт право транскрибации **первому** (`decision=transcribe`), остальным — `defer`. Lease с TTL (сейчас 1800 с); если держатель сорвался, право перехватывает следующий по истечении lease. Клиент грузит аудио только при `decision == "transcribe"` (хелпер `ClaimResponse.shouldTranscribe`).

### 5.2 `POST /meeting-ingest` — загрузить аудио (только держатель права)

`multipart/form-data`:
- `meeting_id` (text) — из ответа claim;
- `audio` (file, обязателен) — системный звук, `Content-Type: audio/mp4`, ≤ 25 МБ;
- `audio_mic` (file, опционален) — микрофон, ≤ 25 МБ.

Ответ `202` сразу; транскрибация и тезисы досчитываются в фоне (`EdgeRuntime.waitUntil`):
```jsonc
{ "ok": true, "meeting_id": "<uuid>", "web_url": "...", "summary_status": "processing" | "skipped_human_edit" }
```
Заливка не от держателя права (`claim_owner`) → `403`. Если тезисы уже правил человек (`notes_edited_at != null`) → сервер пропускает перетранскрибацию (`summary_status: skipped_human_edit`).

### 5.3 Ретраи (`withRetry`)

Экспоненциальный бэкофф (1, 2, 4, 8 с, до 4 попыток) на сетевые сбои и `5xx`/`429`. `4xx` (кроме `429`) не ретраятся — это не временный сбой.

> **Очередь на диск** (переживать перезапуск приложения, отложенная отправка после восстановления сети) — пока в памяти процесса, вынос на диск — итерация (см. §10).

---

## 6. Конфиг (`SwarmTypes.swift` → `SwarmConfig`)

Читается из `~/Library/Application Support/SwarmRecorder/config.json`:
```json
{
  "token": "smcp_...",
  "ingestBaseURL": "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1",
  "webBaseURL": "https://swarm-brain.pages.dev"
}
```

- `token` — **персональный** `smcp_`-токен из бота (`/mytoken`). Не общий статический секрет. Сервер хэширует его в SHA-256 и матчит с `allowed_users.claude_mcp_token_hash` (`_shared/agent-auth.ts → verifyAgentToken`). Личность (`telegram_id`) и `group_id` сервер берёт **из токена**, не из payload — спуфинг невозможен.
- `webBaseURL` — для пункта меню «Открыть Рой».

Для MVP файл кладётся руками. Онбординг-ввод токена в UI — итерация. Хранение токена в Keychain вместо plaintext-файла — TODO (см. §10).

---

## 7. Меню-бар (`AppDelegate.swift`, `main.swift`)

`main.swift` при старте: если есть флаг `--selftest` → `runSelfTest()` (см. §8), иначе — меню-бар приложение (`NSApplication.setActivationPolicy(.accessory)` — без Dock).

`AppDelegate` ставит `NSStatusItem` с SF Symbols-иконкой по состоянию и собирает меню:

| Состояние | Иконка | Текст | Действие в меню |
|---|---|---|---|
| `idle` | `mic` | Готов | «Записать встречу» |
| `recording` | `record.circle` | ● Идёт запись | «Остановить и отправить» |
| `sending` | `arrow.up.circle` | Отправка… | — |
| `error(msg)` | `exclamationmark.triangle` | Ошибка: … | (возврат к старту) |

Если `config.json` не прочитан — в меню только предупреждение и «Выйти». Пункт «Открыть Рой» появляется, если задан `webBaseURL`.

**Ручной поток (MVP):** «Записать встречу» → проверка разрешения на запись экрана → старт обеих дорожек во временные файлы → состояние `recording`. «Остановить и отправить» → `stop()` → `claim(identity_kind=manual)` с ретраем → при `decision=transcribe` загрузка аудио с ретраем → удаление временных файлов → `idle`.

---

## 8. Самопроверка (`--selftest`)

`runSelfTest()` прогоняет полный цикл headless, без меню-бара (доказывает e2e):
1. Стартует захват, параллельно проигрывает клип через `afplay` (`/tmp/e2e.m4a` или системный `Glass.aiff`) как источник системного звука.
2. ~6 с записи → `stop()` → печатает размеры дорожек (`SELFTEST_CAPTURE system=… mic=…`).
3. Если есть `config.json` — делает `claim(manual)` (`SELFTEST_CLAIM`), и при `decision=transcribe` загружает аудио (`SELFTEST_UPLOAD`) своим же `SwarmClient`.
4. Без конфига — только захват (`SELFTEST_NOCONFIG`).

Это основной способ проверить, что захват и контракт живы, без участия Telegram-звонка или реальной встречи.

---

## 9. Разрешения macOS (`Permissions.swift`, TCC)

- **Запись экрана и системного звука** (для ScreenCaptureKit): отдельной Info.plist-строки не требует; macOS сама запросит «Screen & System Audio Recording» в System Settings → Privacy при первом реальном `SCStream`. `CGPreflightScreenCaptureAccess()` / `CGRequestScreenCaptureAccess()` проверяют/запрашивают доступ.
- **Микрофон:** `NSMicrophoneUsageDescription` в Info.plist + `AVCaptureDevice.requestAccess(for: .audio)`.
- **Календарь:** `NSCalendarsUsageDescription` — заготовлено под будущий авто-старт по календарю (EventKit), в текущем потоке не используется.

Без доступа к записи экрана старт записи возвращает ошибку с подсказкой выдать его в System Settings → Privacy. После пересборки `.app`-бандла macOS может сбросить выданные разрешения — пользователь выдаёт заново.

---

## 10. Триггеры записи: что есть и что планируется

Скоуп захвата — **только онлайн-звонки**: Google Meet и Контур.Толк (браузерные, id комнаты из URL вкладки), Telegram-звонок (кнопка резкого старта; сюда же редкие офлайн-записи одним человеком), редко Zoom, почти никогда Teams. Переговорки/диктофон для комнат не проектируем.

| Триггер | Идентичность | Статус |
|---|---|---|
| **Ручная кнопка** в меню-баре («Записать встречу») | `manual:<uuid>` | ✅ есть |
| **Telegram-кнопка резкого старта** (тот же manual-путь) | `manual:<uuid>` | путь готов в контракте; UI-интеграция — итерация |
| **Авто-старт по календарю** (EventKit) | `calendar` (iCalUID + дата экземпляра) | планируется |
| **Авто-детект браузерного звонка** (Meet / Контур.Толк по URL вкладки) | `room` (Meet-код / Контур-room) | планируется |

Сейчас рекордер пишет от старта/стопа вручную и шлёт `identity_kind=manual` (без авто-дедупа). Авто-схлоп дублей возможен только по точным ключам `calendar`/`room`; `manual` и кросс-источник объединяются вручную в вебе.

### Незакрытое (TODO / итерации)

- **Нарезка/сжатие длинных встреч** под лимит 25 МБ на дорожку.
- **Очередь отправки на диск** (переживать перезапуск, отложить до сети) — сейчас в памяти.
- **Авто-старт по календарю** (EventKit: iCalUID → `identity_kind=calendar`, ссылка, участники).
- **Авто-детект браузерного звонка** → `identity_kind=room`.
- **Окно пометок во время встречи** → `user_notes` (поле контракта уже есть).
- **Онбординг токена в UI** + хранение токена в **Keychain** вместо plaintext-файла.
- **Авто-апдейтер.**
- **Распространение бинаря в команду** без платного Apple Developer Program — открытый вопрос (подпись ad-hoc, нотаризации нет).

---

## 11. Definition of Done (текущий cut)

- [x] Запись системного звука онлайн-звонка двумя дорожками AAC m4a
- [x] Микрофон best-effort (вторая дорожка), сведение по таймстампам на сервере
- [x] Поток claim → ingest с ретраями; загрузка только держателем права (`decision=transcribe`)
- [x] `--selftest` прогоняет весь цикл захват → claim → загрузка (e2e доказан)
- [x] Меню-бар: статус-икона, ручной старт/стоп, пункт «Открыть Рой»
- [x] Сборка `.app` без полного Xcode (`build-app.sh`, ad-hoc подпись)
- [ ] Нарезка/сжатие под 25 МБ для длинных встреч
- [ ] Очередь отправки на диск (переживать перезапуск)
- [ ] Авто-старт (календарь / детект браузерного звонка)
- [ ] Онбординг токена в UI + Keychain
