# Блок: orchestrator

## Назначение

Долгоживущая служба: поднимает контейнер на встречу, гасит после, шлёт heartbeat. Отдельно от
контейнера, потому что живёт дольше одной встречи и обязана переживать её падение.

Для MVP достаточно ручного запуска по приглашению из веба (D017); автозапуск по календарю — следующий этап.

## API-контракт

```ts
export async function startForMeeting(joinUrl: string, platform: Platform, onBehalfOf: number, invite?: { id: string; joinUrl: string }): Promise<ContainerId>;
export async function stop(id: ContainerId): Promise<void>;
```

Вход — служба `orchestrator-main.ts`: опрашивает `POST /meeting-invite` (токен агента, без
`X-On-Behalf-Of`) и по каждому приглашению зовёт `startForMeeting(..., invited_by, invite)`;
площадка без адаптера — `join_failed` позвавшему (EN+RU), контейнер не поднимается.

Живёт **внутри WSL2** рядом с Docker, управляет контейнерами через dockerode. Границу Windows/WSL2 не
пересекает.

## Зависимости

`container` (что поднимать), `swarm-client` (чем ходить на сервер), `conference-link` (откуда берётся
ссылка и площадка).

## Definition of Done блока

| этап | пункт |
| --- | --- |
| 1 | контейнер поднимается по ссылке и гасится после встречи |
| 1 | контейнер умер посреди встречи → heartbeat прекратился, существующий watchdog это видит |
| 1 | два контейнера одновременно не мешают друг другу |
| 1 | брошенных контейнеров не остаётся: проверено после падения оркестратора |
| 2 | автозапуск по календарю: бот приходит на встречу сам |

## Состояние

Прежние сдачи (T155–T157 и раньше) приняты и влиты — их состояние и проверки в `git log -p` этого
файла.

## T100

**2026-09-28 · в работе, ветка `feat/calendar-autostart`.**

Путь: оркестратор раз в минуту зовёт `POST /meeting-calendar` (токен агента) → сервер читает
календари людей воркспейса, включивших автозапуск, берёт события, начинающиеся в ближайшие минуты,
заводит задание (одно на встречу воркспейса: уникально `group_id + calendar_key`) и отдаёт взятые
задания оркестратору; пропущенное — списком с причиной (нет ссылки, не Meet, календарь не подключён,
токен мёртв, отклонил) → оркестратор поднимает контейнер за владельца календаря → бот заявляет
встречу как `calendar` с ключом события → `meeting-claim` сверяет её с календарём человека (D016,
уже есть) → бот стучится.

Развилка владельцу (не решаю сам): кому бот приходит сам — см. отчёт; до решения автозапуск
выключен у всех (`allowed_users.scriba_autojoin=false`), механизм работает на тех, у кого включён.

Сделано и в `origin`: миграция `20260928063104_meeting_calendar_jobs.sql`; ядро отбора
`_shared/calendar-dispatch.ts` (тесты до кода, порча 4 границ — красная); функция
`meeting-calendar/` (`sweep.ts` + тесты); бот — `calendar-client.ts`, `calendar-trigger.ts`,
`calendar-service.ts`, `poll-loop.ts` (общий цикл с `invite-trigger.ts`), `claimFor`/`calendarClaim`
в `claim-request.ts`, `SCRIBA_CALENDAR_KEY`+`SCRIBA_CALENDAR_STARTS_AT` в `config.ts`,
`startForMeeting(..., basis: InviteReference | CalendarReference | null)`.

Контракт тестов бота (optio): `calendar-client.test.ts` — разбор ответа (не `ok` / нет `jobs` /
нет `skipped` → `SwarmProtocolError`; кривое задание — в `malformed`, соседи целы; кривой пропуск
отброшен), HTTP-ошибка → `SwarmHttpError`, сеть → `SwarmTransportError`, запрос без
`X-On-Behalf-Of`; сверка имён полей с `JOB_COLUMNS` сервера. `calendar-trigger.test.ts` — задание
Meet → `start` один раз, повтор того же id — второго нет; не Meet → `refuse` с текстом площадки;
`start` бросил → `refuse` c `start_failed`; `refuse` бросил → строка «ОТКАЗ НЕ ДОСТАВЛЕН»; пропуск
пишется один раз за час и снова после; сбой `sweep` — строка в журнал, не исключение.
`claim-request.test.ts` — `calendarClaim`/`claimFor`. `config.test.ts` — пара переменных
календаря вместе, время, не вместе с приглашением. `orchestrator.test.ts` — у календарного
основания в окружении ключ и начало, метка `scriba.calendar`, приглашения нет.

Дальше: смоук `scripts/scriba-calendar-smoke.ts` (локальный Supabase 4400–4403, функции 4404+,
поддельный Google) → доки (ARCHITECTURE, QUICK_REF) → гейт.

Устройство — ARCHITECTURE.md «Бот scriba: оркестратор встреч».
