# Откуда продолжать (записано 03.09.2026 ~10:10, 5ч-окно подписки исчерпано, сброс ~11:49)

## Что уже сделано в этой сессии

- `TaskModal` «Описание» схлопывается при клике → issue #211 + строка в BACKLOG.
- Владельцу локально поставлен рекордер **build 28** (`recorder/install.sh`, `/Applications/bumblebee.app`, `CFBundleVersion 28`).
- **Живой прогон build 28 пройден**: запись `35ba4b51-f058-4363-ab83-92063140a6ff` — 18.4 с, `parts_done 3/3`, транскрипт, тезисы (`summary_status=done`), `awaiting_review`, название из календаря.
- `deno task test` — 574 passed / 0 failed. `swift test` локально НЕ идёт: нет `XCTest` (только Command Line Tools, без Xcode) — гоняет CI.
- Рубильник `LATEST_BUILD` 26 → 28 — **PR #212**, метка `deploy-window` (ночью вольёт автоматика). После мёржа обязателен ручной `supabase functions deploy swarm-recorder-version`.

## Задача на продолжение: `agent_version` врёт (#209)

Клиент build 28 записал встречу, а в базе `meetings.agent_version = "0.1.0"` — после раскатки по базе не понять, кто обновился (это и нужно, чтобы ловить историю с двумя бинарями под номером 27, #210).

Владелец 03.09: «дефект с версией давай тоже проработаем чтоб ночью все влить» — то есть хочет фикс в ту же ночную раскатку.

### Где править (найдено grep-ом)

Жёсткая строка `"0.1.0"` в четырёх местах:

- `recorder/Sources/SwarmRecorder/UploadQueue.swift:232`
- `recorder/Sources/SwarmRecorder/AppDelegate.swift:1481`
- `recorder/Sources/SwarmRecorder/AppDelegate.swift:1568`
- `recorder/Sources/SwarmRecorder/AppDelegate.swift:1581`

Сервер уже принимает что дадут — `supabase/functions/meeting-claim/index.ts:46,111,420` (`agent_version?: string`, пишет как есть, валидации формата нет). Значит правка **только клиентская**.

### План

1. Одна точка истины в клиенте: `enum BuildInfo { static let version = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "dev" }` (файл рядом с `UploadQueue.swift`), все четыре места — на неё. ⚠️ Проверить, что четвёртое/третье вхождения не в тестовом/дев-пути с другим смыслом.
2. Тест в `recorder/Tests/RecorderKitTests/` на то, что версия не хардкод (локально не прогонится — XCTest нет; зелёный статус даст CI).
3. `recorder/VERSION` 28 → **29** (правило: под одним номером не должно ходить два разных бинаря, #210).
4. Собрать (`recorder/build-app.sh`), залить `SwarmRecorder-29.zip` в Storage `swarm_drive/recorder/`, проверить анонимный 200.
5. **Живой прогон build 29**: поставить себе, записать ~20 с, убедиться SQL-ом, что `agent_version = "29"`, а не `0.1.0`:
   `supabase db query --linked "select id::text, agent_version, recorded_seconds from meetings order by created_at desc limit 1"`
6. Обновить **PR #212**: `LATEST_BUILD` 26 → **29** (вместо 28), в теле PR — факты прогона 29. Метка `deploy-window` остаётся.
7. Ночью после мёржа: `supabase functions deploy swarm-recorder-version` → эндпоинт должен отдать `{"build":29}`; закрыть #209 частью про телеметрию.

### Границы

- Раскатка — только по «да» владельца (оно есть) и в окно **23:00–05:59**; сейчас день.
- Не поднимать `LATEST_BUILD` до живого прогона той сборки, которую раздаём.
