<!-- research-report.md — the result of automatic research: what already exists in the world and what the brainstorm decisions will stand on. Filled in by the parallel research agents and by the synthesis step; the owner reads it during the brainstorm. -->

# Отчёт исследования

<!-- Project name, date. -->

Доска инициатив в «Спринтах» Swarm Brain, 2026-09-18. Сырые находки со ссылками — в
`docs/furca/research/`: `existing-solutions.md` (готовые решения), `market.md` (рынок), `stack.md` (стек).
Здесь — синтез: что берём, что нет, и развилки для брейншторма.

## Готовые решения

<!-- Repositories and libraries found that cover part of the problem. For each: link, licence, what exactly is reused or adapted and why (or why we write our own, if nothing fit). -->

Кода не заимствуем: всё найденное — AGPL/GPL (Plane, Taiga, OpenProject) или закрытая часть GitLab, а
механика спринта у нас уже своя (#267). Берём **приёмы**, пишем своё.

| Находка | Лицензия | Что берём | Что нет |
|---|---|---|---|
| Plane `transfer_cycle_issues` + `progress_snapshot` ([код](https://github.com/makeplane/plane/blob/master/apps/api/plane/utils/cycle_transfer_issues.py)) | AGPL-3.0 | итоги спринта замораживаются одним JSON на записи спринта — у нас это уже `sprint_cycles.stats` | перенос без причины и без истории; **снимок и перенос не в одной транзакции** — открытый баг [#9599](https://github.com/makeplane/plane/issues/9599) |
| Plane `IssueLink` ([модель](https://github.com/makeplane/plane/blob/master/apps/api/plane/db/models/issue.py), [валидация](https://github.com/makeplane/plane/blob/master/apps/api/plane/api/serializers/issue.py)) | AGPL-3.0 | `url` + необязательный `title`; только http/https; **запрет дубля url у одной задачи** | `metadata` под превью — не нужно; лимита у Plane нет, наш ≤ 20 остаётся |
| Taiga `HistoryEntry` + `take_snapshot(delete=True)` ([модель](https://github.com/taigaio/taiga-back/blob/master/taiga/projects/history/models.py), [хук](https://github.com/taigaio/taiga-back/blob/master/taiga/projects/history/mixins.py)) | MPL-2.0 | приём: снимок полей **до** физического удаления, ключ — не FK. Совпадает с нашим триггером `before delete on tasks` → `removed_*` | весь audit-фреймворк — избыточен |
| GitLab `health_status` ([доку](https://github.com/gitlabhq/gitlabhq/blob/master/doc/user/project/quick_actions.md)) | EE (visible source) | подтверждение: три отметки (`on_track` / `needs_attention` / `at_risk`) — промышленный стандарт; наши ok / risk / problem ему соответствуют | реализация — в EE-дереве |
| OpenProject `update_ancestors_service` ([код](https://github.com/opf/openproject/blob/dev/app/services/work_packages/update_ancestors_service.rb)) | GPLv3 | прогресс инициативы — простая доля по задачам, **исключённые статусы — вне знаменателя** | взвешивание по часам — у нас нет оценок |
| OpenProject `SprintWorkPackageBreakdown` ([код](https://github.com/opf/openproject/blob/dev/modules/backlogs/app/models/sprint_work_package_breakdown.rb)) | GPLv3 | набор срезов отчёта: запланировано на старте / сделано / не сделано / добавлено после старта | реконструкция по журналу версий — такого журнала в Swarm нет, снимок на приёмке дешевле |

**Пробел, подтверждённый поиском:** поля «причина переноса» нет ни в одном из просмотренных трекеров
(Plane, Taiga, OpenProject; целевой поиск по GitHub пуст). Эту часть модели проектируем сами — готового
образца нет.

Не докопано: Huly (есть ли открытый аналог Linear Project Update), Kanboard / Focalboard / Wekan / Leantime —
канбан-инструменты без модели закрытия спринта, априори слабый источник. На решения не влияет.

## Рынок и референсы

<!-- Competitors and analogues of the product: what worked for them, which patterns are worth taking, what is worth avoiding. Links are mandatory. -->

**Подтверждают наш дизайн:**
- Каскад «приняли спринт → сразу следующий черновик» — так делают Linear ([cycles](https://linear.app/docs/use-cycles)),
  Plane ([cycles](https://docs.plane.so/core-concepts/cycles)), ClickUp. В Linear незакрытое нельзя оставить в
  закрытом цикле — перенос обязателен.
- Снимок на приёмке — неизменяемый факт. Отчёт Jira, пересчитываемый поверх живых задач, теряет задачи,
  перенесённые больше двух раз ([community](https://community.atlassian.com/t5/Jira-Software-questions/Unable-to-find-the-issues-removed-from-the-sprint-in-the-sprint/qaq-p/916712));
  Jira до 9.6 молча стирала связь задачи с закрытыми спринтами ([KB](https://support.atlassian.com/jira/kb/why-are-sprints-removed-from-issues-when-issues-are-moved-to-another-project/)).
- Причина переноса — то, чего рынку не хватает: ни Jira, ни Linear, ни ClickUp, ни Asana, ни Plane её
  структурно не собирают; ScrumNav живёт тем, что достраивает отчёт по переносам поверх Jira
  ([scrumnav](https://scrumnav.com/blog/jira-carry-over-stories-report/)).
- Инициативы в Jira — платная надстройка с ручной настройкой иерархии
  ([Advanced Roadmaps](https://confluence.atlassian.com/advancedroadmapsserver0329/configuring-initiatives-and-other-hierarchy-levels-1021218664.html)); у нас — часть коробки.
- Сверка асинхронно, каждый за свои задачи, — рекомендованная форма, а не ещё одна встреча
  ([Geekbot](https://geekbot.com/blog/mid-sprint-check-in-does-your-team-actually-need-it/)).
- «Кто принимает спринт» Scrum оставляет открытым; явное «любой участник» снимает двусмысленность.

**Стоит перенять:**
- Linear: при пропущенном апдейте индикатор **сереет** («Update Missing»), а не держит последний зелёный
  ([updates](https://linear.app/docs/initiative-and-project-updates)) — см. развилку 4.
- Jira: при закрытии — явный выбор судьбы незакрытого
  ([complete sprint](https://support.atlassian.com/jira-software-cloud/docs/complete-a-sprint/)) — см. развилку 2.
- ScrumNav: «новое против перенесённого» в составе спринта и список хронически переносимых задач — см.
  развилку 3.

**Не повторять:**
- Plane [#9599](https://github.com/makeplane/plane/issues/9599): снимок закоммичен, перенос — нет, повторить
  через интерфейс нельзя. У нас приёмка — одна plpgsql-транзакция с блокировкой строки (спека §6).
- Plane [#3542](https://github.com/makeplane/plane/issues/3542): отменённая задача портит процент. У нас
  зеркальная проблема — см. развилку 1.
- Jira: «сделано» определяется колонкой доски, а не статусом задачи. У нас источник истины — статус.
- Asana: напоминание об апдейте только в фиксированный день
  ([форум, с 2018](https://forum.asana.com/t/status-updates-need-options-for-remind-me-every/24490)).

Непрочитанное помечено в `market.md`: help-центры Asana (401) и ClickUp (403), страница Plane Initiatives
(404), Scrum.org о mid-sprint review (пустая страница) — выводы по ним взяты из поисковых сниппетов и на
развилки не опираются.

## Стек и версии

<!-- Versions and quirks of the libraries and frameworks from plan.md, verified against their documentation: current API, known incompatibilities, migration notes. -->

Проверено по докам Postgres 17, PostgREST, Supabase, MDN и Base UI; часть — прогоном на локальной базе.
Направление вёл агент, он оборвался на лимите сессии после седьмой находки — восьмую добрал диспетчер,
непокрытое честно перечислено в конце `research/stack.md`.

**Главное — план схемы подтверждён:**
- **Триггер при удалении задачи успевает.** `BEFORE DELETE` на `tasks` срабатывает раньше, чем внешний ключ
  обнулит `sprint_items.task_id`: в Postgres «BEFORE DELETE always fires before the delete action, even a
  cascading one» ([CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html)). Проверено на
  локальной базе: снимок названия записался, `task_id` обнулился после. Значит `removed_*` пишем прямо в этом
  триггере, второй проход не нужен.
- **Один живой спринт на пространство** держится частичным уникальным индексом: строки с `tab_id is null`
  в индекс не попадают, принятый спринт не мешает завести следующий, гонка даёт `23505`. Проверено локально,
  включая имя индекса в тексте ошибки. Ловить в коде по `error.code === '23505'`, не по тексту.
- **Приёмка атомарна.** Каждый запрос PostgREST, включая вызов функции, идёт одной транзакцией
  ([transactions](https://postgrest.org/en/stable/references/transactions.html)), блокировка строки держится
  до конца запроса. Это и защищает нас от бага Plane #9599.
- **Права.** `EXECUTE` на новую функцию автоматически достаётся роли `PUBLIC`
  ([privileges](https://www.postgresql.org/docs/17/ddl-priv.html)), и `REVOKE ... FROM anon` его не снимает —
  проверено на локальной базе. План спеки (`REVOKE ... FROM PUBLIC, anon, authenticated`) верен.
- **`ADD COLUMN links jsonb not null default '[]'` не переписывает таблицу** — значение по умолчанию
  хранится в метаданных ([ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)). Проверку
  «это массив» добавляем как `NOT VALID` + отдельный `VALIDATE`, чтобы не держать тяжёлую блокировку.

**Найденное сверх задания:**
- **Supabase 30.10.2026 снимает автоматические гранты на новые таблицы** во всех существующих проектах
  ([changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)).
  Существующих таблиц это не касается, но новые объекты фичи обязаны получать `GRANT` явно в миграции.
- **Base UI: `^1.5.0` подтянет 1.8.0.** Старый краш на React 19 + Next 16 закрыт; открыты два бага узкого
  профиля — залипание `Select` при быстром открытии под нагрузкой ([#5358](https://github.com/mui/base-ui/issues/5358))
  и `RangeError` в немодальном `Popover` без фокусируемого содержимого ([#5715](https://github.com/mui/base-ui/issues/5715)).
  Оба обходятся выбором компонентов, на план не влияют.
- **Даты.** `new Date('2026-09-18')` разбирается как полночь UTC
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse)), и смешение
  такого разбора с локальным форматированием и есть источник сдвига на день у пользователя в другом поясе.
  Temporal в Safari стабильно недоступен, а версия рантайма edge-функций не проверена.
- **Выгрузка в буфер** требует HTTPS (он есть) и жеста пользователя в Safari и Firefox
  ([Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)): класть текст в буфер надо
  сразу в обработчике кнопки, а не после похода на сервер.

## Развилки для брейншторма

<!-- A numbered list; each item is one fork in the format: what is being chosen / options / recommendation with rationale. Example:
1. Existing library X instead of our own implementation — options: (a) take X, (b) write our own; recommendation: (a), since X covers most of the requirements and is actively maintained.
Below is only the skeleton of the first item; the real forks of this project are added from the research results. -->

1. **Отменённая задача в итогах спринта.** Сейчас в спринтах #267 `cancelled` считается закрытой наравне с
   `done`: пять отменённых из десяти дают 50% выполнения ([sprint-stats.ts](supabase/functions/_shared/tasks/sprint-stats.ts),
   тест «cancelled — тоже закрытая»). В артефакте отмены нет вообще, есть только «сделано» и «перенесено», так
   что эталон ответа не даёт. У Plane зеркальный баг ([#3542](https://github.com/makeplane/plane/issues/3542)):
   отменённые занижают процент. Варианты: (а) оставить как есть — отмена повышает процент; (б) считать
   отменённые отдельной цифрой и убрать из знаменателя, как `excluded_from_totals` в OpenProject; (в) считать
   невыполненными. **Рекомендация — (б):** отмена перестаёт улучшать отчёт, но и не портит его, а видно её
   отдельно. Затрагивает и нынешний отчёт спринта, поэтому решение за владельцем.

2. **Причина при автоматическом переносе.** По спеке §3 незакрытое без пометки уезжает в следующий спринт
   молча, в таблице причин у него «причина не указана» — так же в артефакте. Рынок: ни Jira, ни Linear, ни
   ClickUp причину не собирают вовсе, и именно это продаёт ScrumNav поверх Jira. Варианты: (а) как в
   артефакте; (б) в окне приёмки показать список уезжающих автоматически и дать вписать причину одной
   строкой, не требуя её; (в) требовать причину у каждого хвоста, без неё не принимать спринт.
   **Рекомендация — (б):** ритуал не удлиняется, но таблица причин перестаёт быть наполовину пустой. (в) —
   верный способ заставить людей писать «нет времени» ради кнопки.

3. **Сколько раз задача уже переносилась.** Данные для этого появятся сами: у перенесённой позиции есть
   ссылка на предыдущую (`carried_from`), цепочка считается без новых полей. В артефакте этого нет; у Jira
   тоже нет, а при переносе больше двух раз её отчёт начинает терять задачи
   ([community](https://community.atlassian.com/t5/Jira-Software-questions/Unable-to-find-the-issues-removed-from-the-sprint-in-the-sprint/qaq-p/916712)).
   Варианты: (а) не показывать; (б) показывать в строке задачи значок «×3» и колонку в таблице причин
   переносов. **Рекомендация — (б):** это ровно тот разговор, ради которого заводится таблица причин —
   видно, что задача висит четвёртый спринт.

4. **Кто не отметился на сверке.** Артефакт показывает «по плану / риск / проблема / выполнено», а
   «не отметился» — нет: молчание выглядит как отсутствие проблем. Linear на этот случай гасит индикатор
   проекта в серый ([updates](https://linear.app/docs/initiative-and-project-updates)). Варианты: (а) как в
   артефакте; (б) после дня сверки неотмеченные задачи показывать серой пометкой «не отмечено», а в шапке и
   у каждого человека — их число. **Рекомендация — (б):** ведущему видно, кто молчит, без ручного пересчёта;
   это дополнение к артефакту, а не отход от него.

Мелочи решены без владельца и записаны в `decisions.md` (D005–D008): даты считаем строками и `Intl`, без
Temporal; в миграции явные `GRANT` новым объектам; проверка «ссылки — массив» живёт в базе; повторный
одинаковый адрес у одной задачи не добавляется.
