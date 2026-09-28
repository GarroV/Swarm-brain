# Граница бот ↔ ядро (D029, T177)

Карта на 2026-09-28: что в боте донастраивается и где живёт. Цель — всё поведение бота правится в `bot/`
и в одном модуле его настроек на сервере, ядро (claim/ingest/processor, auth, сторожа) знает только
контракт «источник записи — служебный агент с пропуском на встречу».

## Что донастраивается и нужно ли трогать ядро

| Настройка | Где сейчас | Ядро? |
|---|---|---|
| Тайминги двери | `bot/src/orchestrator/run-meeting.ts` + env; числа продублированы в `_shared/notices.ts` и текстах `_shared/notice-texts.ts` | да — дубль, разъедется молча |
| Окно автозапуска, «только да» | `_shared/calendar-dispatch.ts` | да |
| Имя бота | env `SCRIBA_DISPLAY_NAME`; слово `scriba` зашито в `swarm-bot/lib/recording-watchdog.ts` и `notice-texts.ts` | да — в текстах |
| Площадки (Meet/Толк/Zoom) | `bot/.../config.ts` и `_shared/meeting-invite.ts` (`BOT_PLATFORMS`) | да — дубль |
| Согласие на автозапуск | `swarm-api/autojoin.ts`, принуждение в `meeting-claim/agent-scope.ts` | да |
| Лимит одновременных встреч | `SCRIBA_MAX_MEETINGS` в `bot/` | нет |
| Максимальная длина встречи | env в `bot/`; привязка в `_shared/agent-grant.ts` (`GRANT_TTL_MS`) и `_shared/meeting-lease.ts` | частично |
| Виды уведомлений и тексты | `_shared/notices.ts`, `_shared/notice-texts.ts` | да, всегда |
| Арбитраж бот против рекордера | `meeting-claim/arbiter.ts`, `_shared/bot-recording.ts` | да (часть общего арбитра) |
| Сторожа встреч бота | `swarm-bot/lib/recording-watchdog.ts`, `ghost-sweep.ts` | да |

## Где ядро знает про бота

`_shared/agent-auth.ts` (вид «bot», пропуска), `_shared/agent-grant.ts`, `meeting-claim/{agent-scope,arbiter,claim-patch,index}.ts`,
`meeting-heartbeat/write.ts` (ветка удара бота), `meeting-current/index.ts` (событие пропуска),
`meeting-ingest/second-recording.ts` (источник `agent:<id>:<tg>`), `swarm-bot/lib/{ghost-sweep,recording-watchdog}.ts`,
`swarm-api/{meeting-invites,autojoin}.ts`.

## План

1. **Протокол доверия остаётся в ядре** — пропуск на встречу, личность агента, сверка заявки (`agent-auth`, `agent-grant`, `agent-scope`). Это не настройки, а безопасность.
2. **Настройки бота — в один модуль** `_shared/bot-profile.ts` (площадки, имя, тайминги двери, окно автозапуска, таймауты сторожей, потолок длины), позже при нужде — строка `service_agents` вместо констант. Ядро берёт значения только оттуда; дубли в `notices.ts`, `meeting-invite.ts`, сторожах и текстах уходят.
3. **Тексты уведомлений бота** — рядом с профилем, имя бота подставляется, а не зашито.
4. **Автозапуск** (`calendar-dispatch.ts`, `autojoin`) — модуль бота, ядро его не импортирует.
5. **Структурная проверка границы** — тест по образцу `_shared/auth-doors.test.ts`: файлы ядра не содержат литерала `scriba` и не импортируют бот-модули помимо разрешённого списка (контракт + профиль).
