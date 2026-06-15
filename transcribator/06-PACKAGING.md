# 06 — Сборка и распространение рекордера

Рекордер — своё лёгкое macOS-приложение (`recorder/` в репо), Swift/AppKit меню-бар. Не форк, не Tauri/Rust. Собирается **без полного Xcode**: достаточно Command Line Tools (`swift build`), сборку `.app`-бандла и ad-hoc-подпись делает скрипт `recorder/build-app.sh`. Транскрибация — в облаке (OpenAI на сервере), поэтому на машине пользователя нет ни ML-модели, ни GPU-зависимостей: качать на онбординге нечего.

## Сборка `.app`

Скрипт `recorder/build-app.sh` делает четыре шага:

1. `swift build -c release` — собирает исполняемый файл (SwiftPM-обёртка `Package.swift`, `swift-tools-version:5.9`, платформа `.macOS(.v13)`).
2. Собирает бандл `SwarmRecorder.app`: создаёт `Contents/MacOS/`, копирует туда бинарь, генерирует `Contents/Info.plist`.
3. Ad-hoc подпись: `codesign --force --deep -s - SwarmRecorder.app` (бесплатно, без аккаунта Apple — даёт целостность бандла, не нотаризацию).
4. Проверка подписи: `codesign -v --verbose=2`.

Полный Xcode не требуется — он лишь удобнее для отладки. Xcode-проект (`.xcodeproj`) намеренно не держим: при наличии исходников в `Sources/SwarmRecorder/` бандл собирается скриптом за секунды.

## Метаданные бандла (`Info.plist`)

Скрипт зашивает в `Contents/Info.plist`:

| Ключ | Значение | Назначение |
|---|---|---|
| `CFBundleIdentifier` | `io.dodobrands.swarmrecorder` | bundle id (привязка TCC-разрешений к нему) |
| `CFBundleName` / `CFBundleDisplayName` | `SwarmRecorder` / `Swarm Recorder` | имя приложения |
| `CFBundleVersion` / `CFBundleShortVersionString` | `0.1.0` | версия |
| `LSMinimumSystemVersion` | `13.0` | минимальная macOS 13 |
| `LSUIElement` | `true` | меню-бар без иконки в Dock и без главного окна |
| `NSMicrophoneUsageDescription` | «SwarmRecorder записывает звук встречи, чтобы подготовить тезисы.» | текст системного запроса доступа к микрофону |
| `NSCalendarsUsageDescription` | «SwarmRecorder читает календарь, чтобы автоматически начинать запись запланированных встреч.» | текст запроса доступа к календарю |

Эталонный список ключей — `recorder/Info-keys.plist`. Запись экрана / системного звука (ScreenCaptureKit) отдельной Info-строки не требует: macOS сама запросит «Screen & System Audio Recording» в System Settings при первом запуске.

## TCC-разрешения (выдаёт пользователь при первом запуске)

Программно разрешения не выдать — только провести человека через системные окна:

- **Микрофон** — для дорожки владельца (AVAudioRecorder). Текст из `NSMicrophoneUsageDescription`.
- **Запись экрана и системного звука** — для дорожки удалённых участников (ScreenCaptureKit). System Settings → Privacy & Security → Screen Recording. Без явной usage-строки в Info.plist.
- **Календарь** — для авто-старта по событиям (когда подключим). Текст из `NSCalendarsUsageDescription`.

**Известное неудобство:** ad-hoc-подпись означает, что после пересборки `.app` macOS может попросить выдать TCC-разрешения заново (идентичность бандла для TCC завязана не только на bundle id). Это честный минус ad-hoc-подписи; обходить его платным аккаунтом Apple мы не планируем.

## Конфиг

`SwarmConfig` читается из `~/Library/Application Support/SwarmRecorder/config.json`:

```json
{
  "token": "smcp_...",
  "ingestBaseURL": "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1",
  "webBaseURL": ""
}
```

- `token` — персональный `smcp_`-токен из бота (`/mytoken`). Личность и `group_id` сервер достаёт из токена (SHA-256-хэш в `allowed_users`, верификация в `_shared/agent-auth.ts`), не из payload — спуфинг невозможен. Это **не** статический общий секрет.
- Для текущего этапа файл кладётся руками; ввод токена в меню-баре на онбординге — следующий шаг.

## Запуск и проверка

- Запуск: `open SwarmRecorder.app` (или двойной клик).
- Логи: `log stream --predicate 'process == "SwarmRecorder"'` или Console.app.
- **`--selftest`** прогоняет весь цикл (запись → claim → загрузка аудио) — e2e уже доказан этим режимом.

## Распространение бинаря — открытый вопрос

Как раздавать собранный `.app` команде (~20 человек) **без платного аккаунта Apple** — пока не решено. Ad-hoc-подпись даёт целостность, но не снимает Gatekeeper-трение при скачивании из сети и не даёт нотаризации. Варианты обсуждаются отдельно; в спеке фиксируем только, что платный Apple Developer Program и нотаризацию мы не закладываем.

## Чек-лист релиза

- [ ] `recorder/build-app.sh` отрабатывает без ошибок (`swift build` зелёный, подпись валидна)
- [ ] Версия в `Info.plist` (`build-app.sh`) обновлена
- [ ] Минимальная macOS 13 не нарушена
- [ ] `--selftest` проходит на чистой машине (выданы TCC-разрешения: микрофон, запись экрана/звука)
- [ ] Полный цикл: запуск → запись тестовой встречи → claim → загрузка аудио → тезисы в очереди на вычитке в вебе
