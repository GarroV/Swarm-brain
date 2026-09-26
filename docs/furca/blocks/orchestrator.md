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

**2026-09-26 · готов к сдаче.** Человек (пока — вызывающий код; вход «по ссылке» ждёт Q008) даёт
описание встречи → оркестратор поднимает контейнер → бот заявляет встречу (claim), заходит,
пишет, отдаёт запись в очередь и meeting-ingest → контейнер гасится; смерть контейнера и
смерть оркестратора видны и не оставляют сирот.

Где стою: T144 закрыт (`1a445f5d`). T070/T071/T072 — код и живой прогон готовы (`405c7191`,
`6710eb70`), включая настоящий SIGKILL оркестратора. Ствол `feat/meeting-bot` влит
(`9ff8129c`), клиент `meeting-notice` (`notice-client.ts`) заменил заглушку: юнит-тесты и
порчи краснеют; живой смоук door, death, full, stop через прокси нотис (`smoke-notices.ts`,
порт 4361 → fake-swarm 4362) зелёный: две `door_waiting` с `meeting_id` без `attempt`,
`container_died` от имени человека. ARCHITECTURE.md §Бот scriba и QUICK_REF обновлены.

Дальше: сдача блока. `bot/container/.env.example` нет — переменные контейнера ставит
оркестратор, канон имён `MEETING_ENV` в `config.ts`, перечень — ARCHITECTURE.md.

Q008 (тонкий слой): вход «ручной запуск по ссылке» не построен. Когда владелец решит, триггер
(HTTP или CLI) зовёт `orchestrator.startForMeeting(joinUrl, "meet", onBehalfOf)` — больше
ничего не нужно; сейчас его зовут только тесты и смоук.

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
| `notices.ts` | виды нотис по контракту notices, `JournaledNotifier` — каждая нотиса и исход в журнал |
| `notice-client.ts` | клиент `POST /meeting-notice`: без `attempt`, 409 → уйти, прочие отказы громко |
| `smoke-orchestrator.ts` | живой смоук против настоящего Docker и `fake-swarm` |

Проверено:
- `./scripts/check bot` зелёный, покрытие 100% (1135/1135).
- Живой смоук (`docker build -f bot/container/Dockerfile -t scriba-orchestrator:dev bot/`,
  затем `SCRIBA_SMOKE_STATE=<scratch> SCRIBA_SMOKE_ONLY=<сценарии> node --experimental-transform-types bot/src/orchestrator/smoke-orchestrator.ts`):
  `full` (6 частей, таймлайн, heartbeat true…false, контейнер убран), `two` (две встречи, две
  записи — после починки общей очереди), `death` (kill → 137, `container_died` с meeting_id,
  heartbeat замолк на `recording:true`), `stop` (SIGTERM → запись ушла), `door` (door_timeout,
  ничего не отправлено), `orphans` (SIGKILL процесса оркестратора → контейнер-сирота сам
  закончил встречу и исчез через 97 с, запись отдана), `adopt` (оркестратор убит и поднят
  снова → живой контейнер подхвачен, 100 с не счёл себя сиротой, погашен штатно).
- Порчи (все красные, файлы возвращены копией): смерть читается как штатный конец (6 тестов),
  поводок никогда не рвётся (3), финальный heartbeat на сбое (3), снятые ворота defer (1),
  усыновление своего запуска (1), ожидание выхода после старта (12).

Открыто, решать не мне:
- Существующий watchdog `checkRecorderHealth` читает только `allowed_users`, а heartbeat бота
  пишется в `service_agents` (D007) — «смерть видна существующему watchdog» на сервере не
  выполняется без правки swarm-bot. Строка `service_agents` одна на агента: при двух встречах
  живой контейнер перекрывает замолчавший.
- Граф `plan.md`: добавлена стрелка meet-adapter → orchestrator в `.dependency-cruiser.cjs`.
- swarm-client не запускается strip-only Node (свойства-параметры) — контейнер идёт с
  `--experimental-transform-types`.
- Ручной claim создаёт встречу до захода; не впустили — пустая встреча остаётся на сервере.
