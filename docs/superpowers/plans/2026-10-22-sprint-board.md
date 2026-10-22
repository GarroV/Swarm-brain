# Доска спринтов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Порядок работы (владелец 22.10):** «спринты строй сам… не такой объём, чтобы фурку подрубать» — исполнитель по задачам, приёмка и проверки — ведущая сессия.

**Goal:** перенос задачи между спринтами — одно настоящее действие с одной обязательной причиной; новый вид «Доска спринтов» с мастер-планом, задача в нескольких спринтах, ход задачи, закрытие спринта одним списком.

**Architecture:** правила — в функциях Postgres (одна точка для API, MCP и триггера срока), тонкий TS-слой в `supabase/functions/_shared/tasks/sprint-*.ts`, роуты в `swarm-api/sprint-cycles.ts`, инструменты в `swarm-mcp/tasks/sprints*.ts`, веб в `miniapp/src/components/tasks/sprints/`. Пять этапов = пять PR, каждый катится ночью; этапы 1–2 идут одним PR (триггер начинает двигать задачи — «Список» обязан показать снимки в той же раскатке).

**Tech Stack:** Postgres (миграции `supabase/migrations/`), Deno edge-функции, Next.js + Tailwind (`miniapp/`), тесты `deno test` (чистые) и `*.db.test.ts` (настоящая база, `make test-db`, CI).

**Spec:** `docs/superpowers/specs/2026-10-22-sprint-board-design.md` (+ решения `docs/decisions/2026-10-22-sprint-board-direction.md`).

## Global Constraints

- Срок задачи (`tasks.due_date`) меняет только человек явно: новая дата в окне переноса или карточка. Ни одна функция не двигает его сама.
- Причина переноса обязательна (не пустая после trim) и спрашивается один раз; уже записанная — подставляется, не спрашивается.
- Колонки только добавляются; `to_carry`/`carry_auto` не удаляются в этом плане (правило двух шагов).
- Раздел «Проекты» не трогаем: `.github/protected-paths.txt` (в т.ч. `_shared/tasks/sprints.ts`, `SprintBoard.tsx`, миграции на `projects`/`sprints`).
- Новые пользовательские тексты — `dt("рус","eng")`; доска и диалоги — тёмная и светлая тема.
- Действия видны без наведения; кнопки не занимают отдельную строку.
- Комментарий-причина — через существующий `postReasonComment` (`_shared/tasks/sprint-reason-post.ts`), формат `Перенос (<имя спринта>): <причина>`.
- Тесты базы — по образцу `_shared/tasks/sprint-autoplace.db.test.ts` (свой `WS`, `reset`, без пропусков); каждый новый тест ядра проверить на порче (`make porcha` / временно сломать правило — тест краснеет).
- Перед пушем: `deno check` затронутых функций, `npm run build` в `miniapp/`, `./scripts/check fast`.

## Review Focus

1. Двое одновременно переносят одну строку — второй получает понятный отказ «задача уже перенесена», а не вторую строку в цели (блокировка строки `for update`).
2. Приватная, архивная, выполненная или отменённая задача; спринт-цель из другого пространства или уже принятый — отказ с текстом, а не тихая вставка.
3. Срок вернули обратно в идущий спринт после переноса — снимок оживает, дубля строки нет, в цели строка снимается (если она в черновике и без иной причины быть там).
4. Старый клиент (открытая вкладка до раскатки) или MCP шлёт `PATCH … {to_carry:true}` — запрос по-прежнему проходит, строка помечается старым способом и при закрытии попадает в список «без продолжения».
5. Удалили запланированный спринт, куда указывает `moved_to` снимка — снимок показывает «перенесена (спринт удалён)», ничего не падает (FK `on delete set null`).

---

## Этап 1–2 (один PR): перенос в базе и в «Списке»

### Task 1: Колонки и функция переноса

**Files:**
- Create: `supabase/migrations/20261022120000_sprint_move.sql`
- Test: `supabase/functions/_shared/tasks/sprint-move.db.test.ts`

**Interfaces:**
- Produces: колонки `sprint_items.moved_at timestamptz`, `moved_to uuid references sprint_items(id) on delete set null`, `moved_by text`, `plan_reason text`, `auto_extended boolean not null default false`; функция `public.sprint_move_task(p_item_id uuid, p_target_cycle_id uuid, p_reason text, p_new_due date, p_actor text) returns jsonb` → `{"source_item_id","target_item_id","revived":bool}`; внутренняя `public.sprint_move_task_internal(...)` с теми же аргументами, но разрешающая `p_reason is null` (для триггера). Сессионный флаг `set_config('swarm.sprint_moving','1',true)` на время смены срока — триггер срока его видит и молчит.

- [x] **Step 1: Тесты** (`Deno.test` по-русски):
  - «перенос: задача в цели, в источнике снимок с причиной» — после вызова: в цели строка `carried_from = источник`, `carry_count = источник+1`, `in_plan = true`; у источника `moved_at not null`, `moved_to = цель`, `carry_reason = 'ждём юристов'`, `frozen_title = tasks.title`.
  - «пустая причина — отказ» — `p_reason = '  '` → исключение с текстом `Нужна причина переноса`.
  - «выполненную/отменённую не переносим», «цель из другого пространства — отказ», «цель не черновик — отказ», «источник не в идущем — отказ».
  - «срок не трогается без новой даты» — `due_date` до и после равны; «новая дата меняет срок и не плодит строк» — ровно 2 строки задачи после вызова.
  - «повторный перенос той же строки — отказ `Задача уже перенесена`» (оживление снимка проверяет Task 2 через срок).
  - «приватную не переносим».
- [x] **Step 2:** `make test-db` (или `./scripts/check`) — новые тесты FAIL «function sprint_move_task does not exist».
- [x] **Step 3:** миграция: колонки, функции (`security invoker`, `search_path = public, pg_temp`, блокировка исходной строки `for update`, тексты отказов `using errcode = 'P0001'`), `revoke all on function … from public, anon, authenticated` (урок SECURITY DEFINER/PUBLIC — даже для invoker держим EXECUTE только у `service_role`).
- [x] **Step 4:** тесты PASS; порча: убрать проверку причины — тест «пустая причина» краснеет.
- [x] **Step 5:** commit `feat: перенос задачи между спринтами — функция базы`.

### Task 2: Триггер срока двигает, а не помечает; план не сносится

**Files:**
- Create: `supabase/migrations/20261022121000_sprint_autoplace_moves.sql` (новая версия `sprint_autoplace_task`)
- Modify: `supabase/functions/_shared/tasks/sprint-autoplace.ts` (`planPlacement` — то же правило в чистом виде), `sprint-autoplace.test.ts`, `sprint-autoplace.db.test.ts`

**Interfaces:**
- Consumes: `sprint_move_task_internal` (Task 1).
- Produces: `planPlacement(input) → PlacementPlan` с полями `move: {targetCycleId} | null`, `extendTo: cycleId | null`, `revive: boolean` вместо `setCarry`/`clearCarry`.

- [x] **Step 1: Тесты** (обновить сцены, ожидания по спеке «Правила на граничные случаи»):
  - «срок за концом идущего, плана нет: задача в спринте срока, в идущем снимок без причины» (`moved_at not null`, `carry_reason is null`).
  - «срок за концом идущего, есть план до С6, срок в С8: план продлён строками С7–С8 с `auto_extended`, строка идущего живая».
  - «срок внутри плана: строки не трогаются».
  - «срок вернули в идущий: снимок ожил (`moved_at is null`), строка цели в черновике снята».
  - «флаг `swarm.sprint_moving` — триггер молчит».
  - «опечатка в сроке (через десять лет)» — как раньше: спринтов нет, задача не переехала, снимка нет.
- [x] **Step 2:** FAIL на старой функции.
- [x] **Step 3:** переписать функцию по правилам спеки; удаление строк в черновиках — только строк без `moved_at`, вне плана задачи и не `in_plan`-строк плана (строки плана не удаляются никогда триггером).
- [x] **Step 4:** PASS (`deno test …sprint-autoplace.test.ts` + `make test-db`); порча: вернуть удаление строк плана — «план не сносится» краснеет.
- [x] **Step 5:** commit `feat: смена срока переносит задачу и не сносит план`.

### Task 3: Серверный слой переноса — TS, API, MCP, статистика

**Files:**
- Create: `supabase/functions/_shared/tasks/sprint-move.ts`
- Modify: `_shared/tasks/sprint-items.ts` (`listComposition` → поле `moved`), `_shared/tasks/sprint-stats.ts` (+ категория `moved`), `swarm-api/sprint-cycles.ts` (роут), `swarm-mcp/tasks/sprints.ts` + `sprints-defs.ts` (+ `move_sprint_task`), `miniapp/src/types.ts`, `miniapp/src/lib/api.ts`
- Test: `_shared/tasks/sprint-stats.test.ts`, `_shared/tasks/sprint-move.db.test.ts` (дополнить: комментарий-причина создан один раз)

**Interfaces:**
- Produces:
  - `moveItem(sb, { groupId, viewer: number, itemId: string, targetCycleId: string, reason: string, newDue: string | null }) → Promise<{ targetItemId: string; revived: boolean }>` — проверки доступа как у `updateItem`; после RPC — `postReasonComment(taskId, viewer, "Перенос (<имя источника>): <reason>")`.
  - `setMovedReason(sb, { groupId, viewer, itemId, reason }) → Promise<void>` — вписать причину в снимок без причины (только `moved_at not null and carry_reason is null`), тоже комментарий.
  - `SprintItemView.moved: { to_cycle_id: string | null; to_cycle_name: string | null; at: string; by: number | null; reason: string | null } | null`.
  - `computeSprintStats` → `+ moved: number`; снимки не входят в `total`/`done`.
  - API: `POST /sprint-cycles/:id/tasks/:itemId/move` `{target_cycle_id, reason, new_due?}` → `{ok:true,target_item_id,revived}`; `POST /sprint-cycles/:id/tasks/:itemId/moved-reason` `{reason}`. Ошибки P0001 → 409 с текстом.
  - MCP `move_sprint_task` `{workspace, sprint_id, task_id, target_sprint_id, reason, new_due?}`.
  - `miniapp/src/lib/api.ts`: `moveSprintTask(cycleId, itemId, body)`, `setSprintMovedReason(cycleId, itemId, reason)`.
- [x] **Step 1:** тест статистики «снимок перенесённой не считается в плане, считается в moved»; db-тест «перенос через moveItem пишет один комментарий».
- [x] **Step 2:** FAIL.
- [x] **Step 3:** реализация; старый `PATCH {to_carry}` оставить рабочим (Review Focus 4).
- [x] **Step 4:** `deno check` swarm-api, swarm-mcp; тесты PASS; живой вызов роута на локальном контуре.
- [x] **Step 5:** commit `feat: перенос в API и MCP, снимки в составе спринта`.

### Task 4: «Список» — окно переноса и снимки

**Files:**
- Create: `miniapp/src/components/tasks/sprints/MoveDialog.tsx`, `SnapshotCard.tsx`, `ReasonDialog.tsx`
- Modify: `sprints/SprintRow.tsx` (кнопка «→» открывает `MoveDialog`; убрать значок/редактор причины переноса, `NoteEditor` остаётся только для риска/проблемы — или убрать и его, если сверка уходит в меню на этапе 3), `SprintsScreen.tsx` (блок «Ушли из спринта» внизу каждой группы/состава), `SprintPulse.tsx` (чип «к переносу» → «перенесено N»), `atoms.tsx`

**Interfaces:**
- Consumes: `moveSprintTask`, `setSprintMovedReason`, `SprintItemView.moved`.
- Produces: `MoveDialog({ item, cycles, onDone })` — цели: запланированные спринты пространства; поле причины (кнопка неактивна при пустом); блок срока: цель ≤ спринт срока → «Срок дд.мм не меняется»; иначе «Срок дд.мм будет сорван. Новый срок: [date = последний день цели]» (можно стереть). `SnapshotCard({ item })` — серая пунктирная: «перенесена → <спринт> · срок A → B», «Причина: «…» · кто · дата»; без причины — красное «причина не указана — нажмите, чтобы вписать» → `ReasonDialog`. Оба компонента переиспользует доска (этап 3).
- [x] **Step 1:** dev-сервер DEV_MODE (моки в `lib/api.ts` дополнить `moved`), прогон: «→» → окно, пустая причина — кнопка неактивна, перенос → строка ушла, снимок внизу; снимок без причины → окно → причина вписана.
- [x] **Step 2:** `npm run build`; снимки 1440 и 390, светлая/тёмная — в `/private/tmp/claude-501/sprint-move/`.
- [x] **Step 3:** доки: `docs/ARCHITECTURE.md` (флоу переноса, колонки, роуты, MCP), `docs/QUICK_REF.md`; commit `feat(miniapp): перенос из «Списка» с причиной один раз, снимки ушедших`.
- [ ] **Step 4:** PR этапа 1–2, CI зелёный, метка `deploy-window`; после раскатки — живая проверка на проде (перенос тестовой задачи в отдельном пространстве или наблюдение за триггером на реальной смене срока) и сверка строк.

## Этап 3: Доска спринтов

### Task 5: Данные доски одним запросом

**Files:**
- Create: `supabase/functions/_shared/tasks/sprint-board.ts`, `sprint-board.test.ts`
- Modify: `swarm-api/sprint-cycles.ts`, `miniapp/src/lib/api.ts`, `miniapp/src/types.ts`

**Interfaces:**
- Produces: `GET /sprint-cycles/board?tab=<tabId>` → `{ plan: { groups: [{ id, name, tasks: PlanTask[] }] }, cycles: [{ cycle, items: SprintItemView[] }] }`, `PlanTask = { id, title, status, due_date, assignees, cycle_ids: string[] }`; чистая `buildPlanSpans(rows) → Map<taskId, cycleId[]>` под тестом (порядок по `start_date`, снимки не считаются). Видимость — как у `listComposition` и панели «План».
- [ ] Тест `buildPlanSpans` (снимок не входит, порядок по датам) → FAIL → реализация → PASS → живой вызов локально → commit `feat: данные доски спринтов`.

### Task 6: Вид «Доска спринтов»

**Files:**
- Create: `miniapp/src/components/tasks/sprints/board/SprintBoardView.tsx`, `BoardColumn.tsx`, `BoardCard.tsx`, `MasterPlanColumn.tsx`, `TaskMenu.tsx`, `BoardFilters.tsx`
- Modify: `sprints/ViewToggle.tsx` (три вида: «Список · Доска спринтов · Статусы»; «Статусы» = прежний канбан, выбор помнится), `SprintsScreen.tsx`, `miniapp/src/components/roy/RoyApp.tsx` (снять потолок 1280px для вида доски — флаг маршрута/контекста, остальные экраны как были)

**Interfaces:**
- Consumes: `/sprint-cycles/board`, `MoveDialog`, `SnapshotCard`, существующие действия (`✓` = смена статуса задачи, сверка = `PATCH check_status`, снятие = `removeItem`, «Взять в спринт» = `addItems`).
- Produces: `TaskMenu({ task, item?, cycle?, cycles })` — пункты по спеке («Спринты задачи…» и «Ход задачи» — заглушки до этапа 4, скрыты флагом), используется и в «Списке» (заменяет хвост «✓ → ⋯»: кружок слева, «⋯» справа — видны всегда).
- Колонка «+ Спринт» — существующий `createCycle` (даты встык после последнего). Кнопка «История спринтов» — список принятых спринтов пространства с их замороженными `stats` (перенесено/продолжилось — для закрытых после раскатки) и раскрытием снимка.
- [ ] Прогон глазами (DEV_MODE): мастер-план закреплён при прокрутке колонок (`position: sticky; left: 0`), прошлые спринты — полоски 46px, раскрываются; перетаскивание из идущего в запланированный открывает `MoveDialog`; из мастер-плана — «взять»; между черновиками — без причины; фильтры (поиск, человек, «требуют внимания») действуют на все колонки; телефон 390 — колонки по одной (scroll-snap), перенос через «⋯».
- [ ] `npm run build`, снимки, доки (ARCHITECTURE: вид доски, роут), commit `feat(miniapp): доска спринтов`, PR, `deploy-window`.

## Этап 4: Спринты задачи и ход задачи

### Task 7: План работы задачи

**Files:**
- Create: `supabase/migrations/20261023120000_sprint_task_span.sql`, `_shared/tasks/sprint-span.ts`, `miniapp/src/components/tasks/sprints/SpanDialog.tsx`
- Modify: `swarm-api/sprint-cycles.ts`, `swarm-mcp/tasks/sprints*.ts`, `miniapp/src/lib/api.ts`
- Test: `_shared/tasks/sprint-span.db.test.ts`

**Interfaces:**
- Produces: `public.sprint_set_task_span(p_task_id uuid, p_tab_id uuid, p_group_id text, p_from_cycle uuid, p_to_cycle uuid, p_reason text, p_actor text) returns jsonb` — добавляет строки `in_plan` в черновики отрезка, снимает строки черновиков вне отрезка (без `moved_at`), идущий и принятые не трогает; причина обязательна, если конец отрезка позже спринта срока или отрезок продлевает задачу из идущего за её последний спринт → `plan_reason` последней строки + комментарий. `POST /sprint-tasks/:taskId/span`; MCP `set_sprint_task_span`.
- [ ] Тесты: «отрезок С4–С6 создаёт 2 строки в черновиках», «сужение снимает черновик, не трогает идущий», «после срока без причины — отказ `Нужна причина: работа после срока`», «с причиной — plan_reason и комментарий» → FAIL → миграция → PASS + порча → `SpanDialog` (плитки, 🏁, красная подсказка) → commit.

### Task 8: Ход задачи

**Files:**
- Create: `_shared/tasks/sprint-journey.ts`, `sprint-journey.test.ts`, `miniapp/src/components/tasks/sprints/JourneyDialog.tsx`
- Modify: `swarm-api/sprint-cycles.ts`, `miniapp/src/lib/api.ts`

**Interfaces:**
- Produces: `buildJourney({ task, rows, cycles, comments }) → { summary: { sprints, moves, updates, daysInWork, lateDays | null }, steps: [{ cycle, dueIn, dueOut, comments, move: { to, reason } | null, outcome }] }`; комментарий в спринт по `created_at`, зазор между спринтами → предыдущий; комментарии-причины переноса не считаются апдейтами. `GET /sprint-tasks/:taskId/journey` (видимость задачи — как у карточки).
- [ ] Тесты `buildJourney` (3 спринта, 2 переноса, комментарий в зазоре, задача без спринтов → пустой путь) → FAIL → реализация → PASS → `JourneyDialog` (пункт «Ход задачи» в `TaskMenu` включён) → commit, PR этапа 4, `deploy-window`.

## Этап 5: Закрыть спринт

### Task 9: Закрытие с решениями по каждой задаче

**Files:**
- Create: `supabase/migrations/20261024120000_sprint_close.sql`, `miniapp/src/components/tasks/sprints/CloseDialog.tsx`
- Modify: `_shared/tasks/sprint-accept.ts`, `sprint-accept.db.test.ts`, `swarm-api/sprint-cycles.ts`, `swarm-mcp/tasks/sprints.ts`/`sprints-defs.ts` (`accept_sprint` + `decisions`), `sprints/SprintBar.tsx` («Принять спринт» → «Закрыть спринт»), удалить `AcceptDialog.tsx`

**Interfaces:**
- Produces: `accept_sprint_cycle(... прежние аргументы ..., p_decisions jsonb)` где `p_decisions = [{item_id, action: "move"|"plan"|"cancel", target_cycle_id?, reason?}]` и `[{item_id, action:"reason", reason}]` для снимков без причины. Продолжения (есть строка в более позднем черновике) — без решения. Отказ, если у незакрытой без продолжения нет решения или у move/plan/reason пустая причина. `move` = `sprint_move_task_internal`, `plan` = снятие строки + запись причины в снимок, `cancel` = статус задачи `cancelled`. `stats` → `+ moved, continued`.
- [ ] Тесты: «без решений по незакрытой — отказ», «продолжение не требует решения», «move с причиной — строка в цели и снимок», «причина подставляется из снимка/комментария» (на стороне TS: `prefillReasons(items, comments)` чистая, под тестом), «старые to_carry-строки попадают в список с подставленной причиной» → FAIL → реализация → PASS + порча → `CloseDialog` по спеке → доки (ARCHITECTURE, QUICK_REF, MCP-инструменты в `docs/SETUP_CLAUDE_DESKTOP.md` если перечислены) → commit, PR, `deploy-window`.

### Task 10: Уборка после перехода (отдельный PR, после недели работы)

- Снять `to_carry`/`carry_auto` из кода (UI, TS, MCP), затем миграцией из схемы — два шага. Решение о старте — по факту: в живых строках нет `to_carry = true`.
