# SwarmRecorder — macOS рекордер встреч

Лёгкое меню-бар приложение: записывает звук онлайн-звонка → отправляет аудио в Swarm Brain
(`meeting-claim` → `meeting-ingest`), где сервер транскрибирует (OpenAI) и делает тезисы.
Дизайн и контракт — `../transcribator/10-REVISED-DESIGN.md`.

## Статус (первый cut, писался без компилятора — нужен проход в Xcode)

| Модуль | Уверенность | Заметки |
|---|---|---|
| `SwarmTypes.swift` (Config, Codable-модели) | высокая | по доказанному e2e контракту |
| `SwarmClient.swift` (claim + upload, ретраи) | высокая | контракт проверен на проде |
| `Permissions.swift` (Screen/Mic/Calendar TCC) | средняя | стандартные API, проверить промпты |
| `AudioRecorder.swift` (ScreenCaptureKit → m4a) | **низкая — главный кандидат на правки** | API-тяжёлый, слепой код |
| `AppDelegate.swift` / `main.swift` (меню-бар) | средняя | AppKit NSStatusItem |

**MVP пишет только СИСТЕМНЫЙ звук** (удалённые участники). Микрофон локального юзера + микширование — **следующая итерация** (это сложный real-time аудио-код, его писать с живой компиляцией). Цель MVP — доказать весь цикл «запись → claim → загрузка → тезисы в вебе».

## Настройка в Xcode (после установки Xcode)

`.xcodeproj` намеренно не хэндписан (хрупко). Создать проект руками — 2 минуты:

1. **Xcode → File → New → Project → macOS → App.** Name: `SwarmRecorder`, Interface: **AppKit (не SwiftUI)**, Language: Swift. Minimum Deployments: **macOS 13.0**.
2. Удалить сгенерённые `AppDelegate.swift`/`main`/`MainMenu.xib`/`ViewController` и **перетащить файлы из `Sources/SwarmRecorder/`** в проект.
3. **Info.plist** — добавить ключи из `Info-keys.plist` (этого репо): `LSUIElement=YES` (меню-бар без дока), `NSMicrophoneUsageDescription`, `NSCalendarsUsageDescription` (тексты — там же). Запись экрана/системного звука TCC-строки не требует, но требует разрешения в System Settings при первом запуске.
4. **Signing & Capabilities:** для локального запуска хватит автоматической подписи Xcode (Team = твой Apple ID, бесплатно). App Sandbox можно **выключить** для MVP (ScreenCaptureKit + сеть проще без песочницы).
5. Прописать конфиг (токен + URL) — см. ниже.
6. **Run** (⌘R). При первом запуске macOS попросит доступ к записи экрана/звука и микрофону — выдать в System Settings → Privacy.

## Конфиг

`SwarmConfig` читается из `~/Library/Application Support/SwarmRecorder/config.json`:
```json
{
  "token": "smcp_...",
  "ingestBaseURL": "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1",
  "webBaseURL": ""
}
```
Токен — персональный `smcp_` из бота (`/mytoken`). Для MVP можно положить файл руками; онбординг-ввод — следующим шагом.

## Что дальше (итерации)
1. Микрофон + микширование с системным звуком (полный разговор).
2. Авто-старт по календарю (EventKit: `external_id` = iCalUID → `identity_kind=calendar`, `meeting_link`, участники).
3. Очередь/ретраи на диск (переживать перезапуск), как в `SwarmClient` заложено в памяти.
4. Меню-бар: онбординг ввода токена, индикатор статуса, «переотправить».
5. Авто-апдейтер.
