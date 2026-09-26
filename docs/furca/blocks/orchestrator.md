# Блок: orchestrator

## Назначение

Долгоживущая служба: поднимает контейнер на встречу, гасит после, шлёт heartbeat. Отдельно от
контейнера, потому что живёт дольше одной встречи и обязана переживать её падение.

Для MVP достаточно ручного запуска по ссылке; автозапуск по календарю — следующий этап.

## API-контракт

```ts
export async function startForMeeting(joinUrl: string, platform: Platform, onBehalfOf: number): Promise<ContainerId>;
export async function stop(id: ContainerId): Promise<void>;
```

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

**2026-09-26 · в работе.** Человек (пока — вызывающий код; вход «по ссылке» ждёт Q008) даёт
описание встречи → оркестратор поднимает контейнер → бот заявляет встречу (claim), заходит,
пишет, отдаёт запись в очередь и meeting-ingest → контейнер гасится; смерть контейнера и
смерть оркестратора видны и не оставляют сирот.

Где стою: T144 закрыт (`1a445f5d`). T070/T071 — код и живой прогон готовы (`405c7191`,
`6710eb70`). T072 — код готов, живой прогон падения оркестратора (сценарии `orphans`,
`adopt`) ещё НЕ прогнан. Уведомитель — журнальная заглушка `LogNotifier`.

Дальше:
1. Прогнать `orphans,adopt` (команда ниже), закрыть T072.
2. Влить ствол `git merge feat/meeting-bot` (notices влит, b0c348ff) и написать клиент
   `meeting-notice` вместо `LogNotifier` (контракт — `docs/furca/blocks/notices.md`:
   `meeting_id`, `attempt` запрещён, `should_leave` от сервера).
3. ARCHITECTURE.md / QUICK_REF.md, env-переменные контейнера в `bot/container/.env.example`.

Устройство (`bot/src/orchestrator/`):

| файл | что держит |
| --- | --- |
| `orchestrator.ts` | `Orchestrator`: `startForMeeting`/`stop`, смерть по коду выхода → нотиса `container_died`, поводок, подхват живых и уборка остановленных на старте |
| `engine.ts` / `docker-engine.ts` | узкая граница к Docker и её перевод в dockerode (AutoRemove, том, поводок только на чтение) |
| `run-meeting.ts` | процесс встречи: claim → заход → дверь (2 нотисы) → запись → одни 2 мин → выгрузка; heartbeat изнутри; на сбое — без финального `recording:false` |
| `container-main.ts` | точка входа контейнера: Chromium+адаптер, клиент, очередь, ffmpeg, сигналы остановки (SIGTERM, поводок, потолок 4 ч) |
| `lease.ts` | поводок: контейнер без движения `seq` 90 с сам заканчивает встречу |
| `run-directories.ts` | своя очередь у каждого запуска; осиротевшие (alive старше 5 мин) переезжают к следующему |
| `recorder.ts` / `parts.ts` | ffmpeg и отдача закрытых частей в очередь ровно один раз |
| `notices.ts` | виды нотис по контракту notices, `LogNotifier` до клиента |
| `smoke-orchestrator.ts` | живой смоук против настоящего Docker и `fake-swarm` |

Проверено:
- `./scripts/check bot` зелёный, покрытие 100% (1135/1135).
- Живой смоук (`docker build -f bot/container/Dockerfile -t scriba-orchestrator:dev bot/`,
  затем `SCRIBA_SMOKE_STATE=<scratch> SCRIBA_SMOKE_ONLY=<сценарии> node --experimental-transform-types bot/src/orchestrator/smoke-orchestrator.ts`):
  `full` (6 частей, таймлайн, heartbeat true…false, контейнер убран), `two` (две встречи, две
  записи — после починки общей очереди), `death` (kill → 137, `container_died` с meeting_id,
  heartbeat замолк на `recording:true`), `stop` (SIGTERM → запись ушла), `door` (door_timeout,
  ничего не отправлено).

Открыто, решать не мне:
- Существующий watchdog `checkRecorderHealth` читает только `allowed_users`, а heartbeat бота
  пишется в `service_agents` (D007) — «смерть видна существующему watchdog» на сервере не
  выполняется без правки swarm-bot. Строка `service_agents` одна на агента: при двух встречах
  живой контейнер перекрывает замолчавший.
- Граф `plan.md`: добавлена стрелка meet-adapter → orchestrator в `.dependency-cruiser.cjs`.
- swarm-client не запускается strip-only Node (свойства-параметры) — контейнер идёт с
  `--experimental-transform-types`.
- Ручной claim создаёт встречу до захода; не впустили — пустая встреча остаётся на сервере.
