<!-- managed by furca: do not change the row format below — fabrica and cursus parse this file -->
# Tasks

<!-- id: Tnnn (T001, T002, ...). status: todo | in_progress | done | failed | cancelled | blocked:Qnnn (Qnnn — the id of an open question in questions.md). cancelled is for a task dropped by a decision: it was neither done nor did it fail, so put the decision id in its text. Without this status such a task sits in failed and the summary reports a failure that never happened — measured on a live project, where one stood there for two weeks — while done would claim the behaviour exists in the product. "depends on" — ids separated by commas, or "—". block: the name of a product block from plan.md, or chores for housekeeping tasks that belong to no block (topping up research, obtaining access, applying an owner's answer) — those are never handed to block agents. issue: the task's number in the project tracker (#N), or "—" if it has none. The issue column is what makes reconciling the graph against the tracker mechanical: without it the link lives in commit text, and the graph falls behind the tracker silently — on a live project that is how the build stood still for a month and a half.

stage: the number of the wave in which the task is done (1, 2, 3…), or "—" if the product is built in one pass. A stage is something that must work end to end — "the month is calculated in the browser" — not "block api is finished". Why it has to be machine-readable: without it a graph passes the integrity check and is still unreachable — the goal of the first wave depends on a task from the fourth, and only a person holding the waves in their head can see it. The rule that then gets checked: a task may not depend on a task from a later stage. Use the same number as the stage marks on the Definition of Done items in the block description. -->

| id | block | depends on | status | task | issue | stage |
|---|---|---|---|---|---|---|
<!-- | T001 | api | — | todo | Example: design the database schema | #12 | 1 | -->
| T001 | core | — | done | `planCarry`: кто остаётся, кто уезжает вручную с причиной, кто автоматически, что остаётся упоминанием. Тесты вперёд | — | 1 |
| T002 | core | — | done | `nextCycleDates`: следующий спринт встык, 14 дней, сверка на шестой день, имя «Спринт N · дд.мм — дд.мм». Тесты вперёд | — | 1 |
| T003 | core | — | done | `computeSprintStats`: новые ключи итогов; отменённая задача вне процента и вне знаменателя (D010). Тесты вперёд, старые тесты правятся под новое правило | — | 1 |
| T004 | core | — | done | `parseLinks`: http/https, не больше 20, без повторов, `javascript:` — отказ. Тесты вперёд | — | 1 |
| T005 | db | — | done | Миграция: поля сверки, переноса, `carry_count`, упоминания, `tab_id`, `check_date`, частичный уникальный индекс, `links` с проверкой массива, поля проектов. `supabase db reset` проходит | — | 1 |
| T006 | db | T005 | done | Триггер `before delete on tasks` → упоминание удалённой задачи; тест на удаление через API и прямым `delete` | — | 1 |
| T007 | db | T001,T002,T003,T005 | done | Функция `accept_sprint_cycle` одной транзакцией; тест на локальной базе сверяет результат с `planCarry`, повторный вызов отбит, живой спринт после приёмки ровно один | — | 1 |
| T008 | db | T005,T007 | done | Гранты: `REVOKE ... FROM PUBLIC, anon, authenticated`, явный `GRANT` для `service_role` (D006); после наката `get_advisors` и `has_function_privilege('anon', ...) = false` | — | 1 |
| T009 | api | T005 | done | Модуль спринтов: `tab_id` в списке и создании, снятие «только админ» кроме удаления, гварды (чужой воркспейс → 400, второй живой → 409) | — | 1 |
| T010 | api | T005 | done | `PATCH /sprint-cycles/:id/items/:taskId`: отметка сверки, комментарий, «к переносу» с причиной; на принятом → 409 | — | 1 |
| T011 | api | T003,T007 | done | Роут приёмки: считает итоги и параметры следующего спринта, зовёт SQL-функцию, различает `23505` и `P0001` по коду | — | 1 |
| T012 | api | T004,T005 | done | Поля `links` у задач и `owner_telegram_id`/`start_date`/`end_date` у проектов: разбор, проверки, история | — | 1 |
| T013 | api | T005 | done | Журнал пространства `GET /spaces/:tabId/journal?days=` отдельным модулем, с фильтром приватности и тестом гварда | — | 1 |
| T014 | chores | T005 | todo | Удалить спринт владельца 3f0872a3 (разрешено им); счёт задач до и после совпадает (476). Не сделано в раскатку 19.09: пишущий коннектор отвалился, а читающий MCP поднят --read-only. Не блокирует: частичный индекс на NULL-вкладку не распространяется | — | 1 |
| T015 | chores | — | done | Подключить `scripts/check` в CI отдельным заданием, чтобы гейт гонялся не только руками | — | 1 |
| T016 | chores | T009,T011,T012,T013 | done | Доки этапа 1: `ARCHITECTURE.md`, `QUICK_REF.md` (эндпоинты, таблицы, поля), описания блоков — тем же коммитом | — | 1 |
| T017 | chores | — | blocked:Q003 | Карантин свежих версий пакетов (`min-release-age` в npm): рекомендация admissio, меняет политику установки всего репозитория | — | 1 |
| T018 | visual | — | done | Компоненты доски по эталону: строка задачи, плашка исполнителя, метки, полоска, баннер, шкала, таблица, переключатель вида; все состояния и обе темы | — | 2 |
| T019 | web | T009,T018 | done | Вкладка «Спринты»: переключатель пространств, шапка с KPI, список «направление → инициатива → задачи», пул слева, «Начать спринт» | — | 2 |
| T020 | web | T019 | done | Вид «Канбан» — существующий экран #267 как второй вид, переключатель запоминается; поведение сверено до и после | — | 2 |
| T021 | web | T012,T018 | done | Строка задачи с метками и поле «Ссылки» в `TaskModal` над описанием; карточка проверена на всех экранах в обеих темах | — | 2 |
| T022 | web | T011,T019 | done | Приёмка из интерфейса: окно с хвостами и необязательной причиной (D011), баннеры итогов принятого спринта | — | 2 |
| T023 | chores | T019,T021,T022 | done | Доки этапа 2 и живой прогон экрана на локальном контуре | — | 2 |
| T024 | core | T001 | done | `initiatives.ts`: прогресс инициативы, «не отмечено» с дня сверки (D013), «×N» с двух переносов (D012). Тесты вперёд | — | 3 |
| T025 | web | T010,T018,T024 | done | Экран «Сверка»: шкала ритуала, три отметки с комментарием, пометка «к переносу» с причиной, счётчик «не отмечено» | — | 3 |
| T026 | web | T012,T024 | done | «Все инициативы»: сворачиваемые инициативы, «в спринт N», правка ответственного и сроков инициативы | — | 3 |
| T027 | chores | T025,T026 | done | Доки этапа 3 и живой прогон ритуала на локальном контуре | — | 3 |
| T028 | core | T003,T024 | todo | `spaceAnalytics.ts` и `buildSpaceReport`: семь таблиц и markdown, сверка с ручным пересчётом. Тесты вперёд | — | 4 |
| T029 | web | T028 | todo | Экран «Аналитика»: семь таблиц с сортировками эталона | — | 4 |
| T030 | web | T013 | todo | Экран «Журнал»: события по дням с фильтром периода | — | 4 |
| T031 | web | T028 | todo | Выгрузка итогов в markdown: в буфер синхронно по нажатию, запасное поле при отказе (D009) | — | 4 |
| T032 | demo | T005 | todo | Демо-сид: пространство, направления, инициативы, живой спринт с отметками, принятый спринт с итогами; по-английски, имена выдуманные, идемпотентно | — | 4 |
| T033 | chores | T029,T030,T031,T032 | todo | Доки этапа 4: `GUIDE.md` (строка 47 неверна), `ARCHITECTURE.md`, реестр материалов; демо проверено по демо-ссылке | — | 4 |
| T034 | api | T009 | done | Закрыть находку из приватного advisory GHSA-cjqc-58qh-3c4j (детали — там, в публичный трекер не переносить) | — | 1 |
