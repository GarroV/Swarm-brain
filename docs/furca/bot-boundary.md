# Граница бот ↔ ядро (D029, T177)

Цель — всё поведение бота правится в `bot/` и в одном модуле его настроек на сервере, ядро
(claim/ingest/processor, auth, сторожа) знает только контракт «источник записи — служебный агент с
пропуском на встречу». Устройство — ARCHITECTURE.md, «Профиль бота и граница с ядром».

## Что донастраивается и где (после T177, 2026-09-28)

| Настройка | Где правится | Ядро трогать? |
|---|---|---|
| Имя бота (в звонке и в текстах людям) | `name` в обоих профилях | нет |
| Площадки (Meet; Толк/Zoom — с адаптером) | `platforms` в обоих профилях (+ адаптер в `bot/`) | нет |
| Тайминги двери и число сигналов | `door` в обоих профилях | нет |
| Максимальная длина встречи, срок пропуска | `maxMeetingMinutes` в обоих, `uploadTailMinutes` на сервере | нет |
| Удар heartbeat и порог сторожа тишины | `heartbeatMs` (бот), `silentMinutes` (сервер) | нет |
| Подсказка-глоссарий Whisper для записей бота | `whisperGlossaryHint` (сервер) | нет |
| Окно автозапуска | `autojoin.leadMs/lateMs` в `_shared/bot-profile.ts` | нет |
| Тексты уведомлений бота | `_shared/bot-notice-texts.ts` (`{bot}`, `{door_wait}`), тексты пропусков — `_shared/calendar-missed.ts` | нет |
| Лимит одновременных встреч | `SCRIBA_MAX_MEETINGS` в `bot/` | нет |
| Правила автозапуска (кого звать) | модули бота: `_shared/calendar-dispatch.ts`, `swarm-api/autojoin.ts` | нет |
| Новый вид уведомления | `NOTICE_KINDS` в `_shared/notices.ts` + текст | да — это контракт с базой (`meeting_notice_reserve`) |
| Арбитраж бот против рекордера | `meeting-claim/arbiter.ts`, `_shared/bot-recording.ts` | да — часть общего арбитра |
| Протокол доверия (пропуск, личность, сверка заявки) | `agent-auth`, `agent-grant`, `meeting-claim/agent-scope` | да — это безопасность, а не настройка |

Бот: `bot/src/orchestrator/profile.ts`. Сервер: `supabase/functions/_shared/bot-profile.ts`.

## Чем держится

- `supabase/functions/_shared/bot-profile.test.ts` — общие поля профилей совпадают (имя, площадки, дверь,
  потолок длины), порог тишины ≥ трёх ударов. Выбран тест, а не раздача значений с сервера: они нужны
  контейнеру до первого запроса и без сети, раскатка идёт одним куском (D033).
- `supabase/functions/_shared/bot-boundary.test.ts` — ядро (всё в `supabase/functions`, кроме `BOT_MODULES`)
  не содержит литерала `scriba` и импортирует у бота только `bot-profile.ts` и `bot-notice-texts.ts`;
  единственная точка монтирования — `swarm-api/index.ts` → `swarm-api/autojoin.ts`. Порча (имя в
  `meeting-claim/index.ts`, импорт `calendar-dispatch.ts` из `meeting-heartbeat`) — красный с путём и причиной.

## Что осталось за границей T177

- Колонка `allowed_users.scriba_autojoin` и маршрут `/scriba/autojoin` называются именем бота: это схема базы и
  адрес веба, переименование — миграция в два шага; в ядре имя колонки берётся из профиля.
- Веб (`miniapp/`) пишет имя бота в своих текстах сам; профиль сервера ему не отдаётся.
- Переменные окружения контейнера (`SCRIBA_*`) и имя PulseAudio-приёмника в `bot/src/container/` — имена
  инфраструктуры, не поведение.
- Перенос профиля в строку `service_agents` (настройка без раскатки) — при нужде, не сейчас.
