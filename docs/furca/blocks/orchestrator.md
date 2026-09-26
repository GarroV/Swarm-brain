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

**2026-09-26 · T150 (веб «позвать бота по ссылке») — сделано, ветка `feat/web-invite`, в `main` не влито.**
Человек на экране «Встречи» вставляет ссылку Meet / Контур.Толк / Zoom и видит статус своего приглашения:
ждёт бота → бот стучится → бот записывает (кнопка «Открыть встречу» → вычитка) / истекло; отказы
`invalid_link`, `too_many_invites`, `demo_not_allowed` — текстом на языке интерфейса. Экран —
`miniapp/src/components/roy/InviteBotCard.tsx`, разбор и статусы — `miniapp/src/lib/meetingInvite.ts`,
клиент — `lib/api.ts`; устройство — ARCHITECTURE §Приглашение бота (D017), подпункт «Веб».

Проверено (T150): `npm test` в miniapp (166, из них 7 новых), `npm run build`, `tsc`, `./scripts/check`
зелёные. Порчи `meetingInvite.ts` (статус не проверяется; `expired` не окончательный; память без предела)
— все три красные, файл возвращён копией. Живой прогон: next dev на 4420 против заглушки на 4421, в
которой крутится НАСТОЯЩИЙ `swarm-api/meeting-invites.ts` поверх базы в памяти (не прод, не локальный
Supabase); браузер — Chrome for Testing, клавиатура и мышь настоящими событиями: 24 проверки зелёные —
Meet, повтор той же ссылки (одна строка, одна запись), мусор, чужой сайт, Zoom, 4-е → 429, переходы
taken/used/expired по опросу, перезагрузка, тёмная тема, «Открыть встречу» → `?meeting=`, 390 и 320 px
без горизонтального скролла, демо (EN, `demo_not_allowed`, приглашения обычного воркспейса скрыты).
Визуальная проверка (norma, эталона в `design/` нет — сверка с соседями): на 320 px кнопка наезжала на
статус, «Истекло» совпадало по цвету с «Ждёт бота» — исправлено; проверка наезда в сценарии краснеет на
старой вёрстке. Не моё, на решение: в демо переключатель «Все/Ожидают/Подтверждены» и «Встреч нет»
остаются русскими (строки экрана до T150); × есть только у окончательных статусов — намеренно.

Дальше (T144/T147 — прежнее): сдача блока. Вход оркестратора: опрос `meeting-invite` и передача
`invite_id`/`join_url` в заявку (T070) — вызов `orchestrator.startForMeeting(joinUrl, platform, onBehalfOf)`.
T147: сторож молчания бота — `swarm-bot/lib/recording-watchdog.ts` (+ `-store.ts`), `checkRecorderHealth`
зовёт их; разделение по встречам — D018 (поля в `meetings`, heartbeat несёт `meeting_id`).

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
- T147: `recording-watchdog.test.ts` 16 тестов; порчи (8, все красные, файл возвращён копией):
  тишина бота не проверяется, бот мерится порогом рекордера, нестрогая граница порога, гонка сброса
  игнорируется, `container_died` не учитывается, бот шлёт текст bumblebee, рекордер человека не
  проверяется, название не экранируется. Живой смоук `scripts/scriba-watchdog-smoke.ts` на стенде
  `scriba-watchdog` (порты 4380-4389): 17 ожиданий зелёные — настоящий heartbeat через
  meeting-heartbeat, настоящий cron swarm-bot, подделка Telegram; порчи store (не тот вид нотисы,
  агенты не читаются, условный сброс не совпадает) краснеют.
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
- **T147, вторая половина — нужна схема (миграций в волне не веду, их ведёт identity).** Строка
  `service_agents` одна на агента: два контейнера пишут в неё по очереди, живой прячет
  замолчавший. Варианты: (а) `meetings.agent_last_seen_at timestamptz` + `agent_last_recording
  boolean` — бот один на встречу, адресат уже есть (`claim_owner`), ручные ключи перестают быть
  неоднозначными; (б) таблица `service_agent_runs (agent_id, meeting_id, on_behalf_of,
  last_seen_at, last_recording)`, PK `(agent_id, meeting_id)` — если агентов на встречу станет
  больше одного. В обоих heartbeat бота должен нести `meeting_id` (сессия знает его после claim):
  правка `swarm-client` (`HeartbeatRequest`, `session.heartbeat`) и `meeting-heartbeat/write.ts`.
  Сторож уже разделён: сменится только `recordingAgents`/`clearAgentRecording` в store.
- Найдено попутно (#549): сторож-призраков `sweepStuckMeetings` метит `failed` встречу бота,
  которая идёт дольше 15 мин — claim раньше захода, ingest только в конце.
- Граф `plan.md`: добавлена стрелка meet-adapter → orchestrator в `.dependency-cruiser.cjs`.
- swarm-client не запускается strip-only Node (свойства-параметры) — контейнер идёт с
  `--experimental-transform-types`.
- Ручной claim создаёт встречу до захода; не впустили — пустая встреча остаётся на сервере.
