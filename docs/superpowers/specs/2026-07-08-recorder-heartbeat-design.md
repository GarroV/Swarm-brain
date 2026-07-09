# Recorder Heartbeat — дизайн

> Статус: согласовано с владельцем 2026-07-08. Замена ложного Read.ai-watchdog («встречи не поступают») на осмысленный мониторинг рекордера.

## Проблема

Read.ai-watchdog слал ежедневный алерт «встречи не поступают — проверь вебхук» по давности последней встречи. Ложный шум: «нет встреч» ≠ поломка. Read.ai отключён, его watchdog убран (код-гейт + pg_cron джоб удалён).

Для рекордера нужен мониторинг, но **без той же ловушки**: у рекордера «нет встреч» = чаще всего просто не было созвонов (выходные, отпуск). Алерт «давно не видели рекордер» → тот же ложный шум (выключенный Mac — норма).

## Решение: алерт на аномалию, не на тишину

Не алертим на молчание само по себе. Только два сигнала, где молчание = настоящая проблема:

**Сигнал 1 — оборванная запись (главный).** Рекордер в heartbeat сообщает `recording: true/false`. Если последний heartbeat был `recording:true`, прошло > `STALE_MIN` (20 мин), а встреча (`meetings`) от этого юзера так и не появилась → запись прервалась посреди созвона (краш/сеть). Алерт **записавшему**. Привязано к реальной активности → без ложняка (выключенный Mac не был `recording`).

**Сигнал 2 — токен истекает.** `recorder_token_expires_at` в пределах 7 дней → алерт «переустанови рекордер, токен истекает через N дней». Детерминированно, ноль ложных. Дедуп через `recorder_expiry_warned` (сброс при перевыпуске токена).

**Сознательно НЕ делаем** «рекордер не пингует N дней» — это ловушка Read.ai.

## Компоненты

### БД (`allowed_users`, только ADD COLUMN — безопасно)
- `recorder_last_seen timestamptz` — время последнего heartbeat.
- `recorder_last_recording boolean` — писал ли рекордер на момент последнего heartbeat.
- `recorder_last_version integer` — версия сборки (из CFBundleVersion).
- `recorder_expiry_warned boolean default false` — послан ли алерт об истечении токена (сброс при `mintRecorderToken`).

### Сервер
- **`meeting-heartbeat`** (новая Edge Function, шаблон `meeting-current`): `verifyAgentToken` (recorder-токен) → body `{recording, version}` → пишет 4 поля + `recorder_last_seen=now`. Возвращает 200.
- **Watchdog** `checkRecorderHealth()` в `swarm-bot`, вызывается из `sweepStuckMeetings` (бежит ежечасно через `granola_poll` / `meetings_watchdog`):
  - Сигнал 1: `recorder_last_recording=true AND recorder_last_seen < now-STALE_MIN` И нет `meetings` от юзера с `created_at > recorder_last_seen` → алерт + сброс `recorder_last_recording=false` (дедуп).
  - Сигнал 2: `recorder_token_expires_at < now+7d AND NOT recorder_expiry_warned` → алерт + `recorder_expiry_warned=true`.

### Рекордер (Swift)
- `SwarmClient.heartbeat(recording:version:)` → `POST /meeting-heartbeat` (Bearer recorder-токен).
- Вызов в существующем `maintenanceTick` (Timer 900с) + один раз на старте. `recording` = `isRecording`, `version` = `Updater.currentBuild`.

## Проверка
- `deno check` meeting-heartbeat + swarm-bot.
- Миграция применена (Management API), поля видны.
- `swift build` рекордера зелёный.
- Деплой meeting-heartbeat + swarm-bot; pg_cron `granola-poller-hourly` уже гоняет `sweepStuckMeetings`.
