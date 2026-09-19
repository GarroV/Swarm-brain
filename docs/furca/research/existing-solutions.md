# Готовые решения (open source) — доска инициатив / спринты

Направление: **готовые решения** для фичи «доска инициатив» (Swarm Brain, вкладка «Спринты»).
Дата: 2026-09-18.

Методология: `gh search code` / `gh search repos` + чтение первоисточника на GitHub (файл/строки).
Для каждой находки помечено, прочитан код целиком или просмотрен по заголовкам/структуре.

---

## 1. Атомарный перенос незакрытых задач между спринтами

### 1.1 Plane — `transfer_cycle_issues` + `progress_snapshot` (AGPL-3.0)

- Файл: [`apps/api/plane/utils/cycle_transfer_issues.py`](https://github.com/makeplane/plane/blob/master/apps/api/plane/utils/cycle_transfer_issues.py) (478 строк) — **прочитано целиком**.
- Эндпоинт: [`apps/api/plane/app/views/cycle/base.py`, класс `TransferCycleIssueEndpoint`](https://github.com/makeplane/plane/blob/master/apps/api/plane/app/views/cycle/base.py) (строки 594-622) — **прочитано целиком**.
- Модель поля: [`apps/api/plane/db/models/cycle.py`](https://github.com/makeplane/plane/blob/master/apps/api/plane/db/models/cycle.py) — `progress_snapshot = models.JSONField(default=dict)`, миграция `0060_cycle_progress_snapshot.py`.
- Лицензия репозитория: **AGPL-3.0-only** (шапка файла: `SPDX-License-Identifier: AGPL-3.0-only`) — для копирования кода как есть в закрытый продукт это ограничение; для переиспользования **схемы/паттерна** (не кода дословно) — свободно.
- Что делает `transfer_cycle_issues(slug, project_id, cycle_id, new_cycle_id, request, user_id)`:
  1. Проверяет, что целевой спринт (`new_cycle`) ещё не завершён (`end_date < now()` → ошибка).
  2. Считает агрегаты по старому спринту (`total/completed/cancelled/started/unstarted/backlog_issues`) через `Count(..., filter=Q(...))` по `state__group`.
  3. Если в проекте включены estimate-очки — параллельно считает `estimate_distribution` (по исполнителям и лейблам).
  4. Строит `assignee_distribution` и `label_distribution` (total/completed/pending на каждого исполнителя и лейбл) + `completion_chart` (burndown).
  5. **Замораживает всё это одним JSON-полем `progress_snapshot` на самом объекте старого `Cycle`** — то есть весь «итог спринта» это один JSON-снимок агрегатов, а не отдельная таблица истории.
  6. Переносит **только незакрытые задачи** (`state__group__in=["backlog", "unstarted", "started"]`, т.е. явно исключены `completed` и `cancelled`) — просто `cycle_issue.cycle_id = new_cycle_id`, bulk update. **Никакого поля "причина переноса" и никакого счётчика/истории переноса у самой задачи нет** — перенос это мутация FK, факт переноса виден только из `issue_activity` (лог активности, `type="cycle.activity.created"`, `old_cycle_id`/`new_cycle_id` в payload).
  7. Всё внутри одной вьюхи, без явной DB-транзакции (`atomic` не используется в этом файле) — атомарность не гарантирована на уровне кода, полагается на то, что bulk_update — одна операция.
- **Что брать:** идея «заморозить агрегаты закрываемого спринта одним JSON-снимком на самой записи спринта» — дёшево и просто, хорошо ложится на требование Swarm «снимок задач + итоги (%, причины)». Разбивка distribution по исполнителю/лейблу — полезный шаблон для аналитики «по людям»/«по инициативам».
- **Что не брать:** у Plane нет причины переноса и нет пофайлового/потасковой истории переноса (только activity-лог, не структурные данные) — это ровно то, чего в Swarm требует фича («перенос с причиной»), и тут придётся проектировать самим, готового аналога с причиной не нашлось.
- Прогресс-снэпшот на веб: [`apps/web/core/components/cycles/analytics-sidebar/sidebar-details.tsx`](https://github.com/makeplane/plane/blob/master/apps/web/core/components/cycles/analytics-sidebar/sidebar-details.tsx) — показывает `completed_issues/total_issues` из замороженного снапшота, когда спринт завершён (просмотрено по коду, не по заголовку).

### 1.2 Taiga — `close_milestone` тривиален, переноса нет в бэкенде (AGPL-3.0)

- Файл: [`taiga/projects/milestones/services.py`](https://github.com/taigaio/taiga-back/blob/master/taiga/projects/milestones/services.py) — **прочитано целиком** (нужный кусок ~90 строк).
- `close_milestone(milestone)` — просто `milestone.closed = True; save()`. Никакого переноса незавершённых user stories/tasks на новый milestone в бэкенде нет.
- Есть автозакрытие в обратную сторону: [`taiga/projects/userstories/signals.py`](https://github.com/taigaio/taiga-back/blob/master/taiga/projects/userstories/signals.py) — `try_to_close_milestone_when_delete_us` автоматически закрывает milestone, если удалённая user story была последней незавершённой. Это разовая эвристика, не имеет отношения к «переносу с причиной».
- Лицензия: Taiga back — исторически AGPL-3.0 (проверить `LICENSE` в репозитории перед использованием, здесь не перепроверял отдельно).
- **Вывод:** Taiga для сверки/переноса — слабый источник, перенос делается вручную на фронтенде (drag&drop между спринтами), в бэкенде готового «transfer + snapshot» нет, как у Plane. Дальше не копать — подтверждает то, что было предположено в задании.

---

## 2. Статус-апдейты / сверка (on track / at risk / off track)

### 2.1 GitLab — `health_status` на issue (Ultimate/EE — visible source, не чисто открытая лицензия для этой конкретной фичи)

- Доки (первоисточник для API-контракта): [`doc/api/issues.md`](https://github.com/gitlabhq/gitlabhq/blob/master/doc/api/issues.md) — **просмотрено по разделам** (grep по вхождениям `health_status`, не читал файл целиком, он огромный).
- Quick actions (полный список значений и команд): [`doc/user/project/quick_actions.md`](https://github.com/gitlabhq/gitlabhq/blob/master/doc/user/project/quick_actions.md), раздел `### health_status` (строки ~928-961) — **прочитано целиком** (нужный раздел).
- Ровно три значения: **`on_track` / `needs_attention` / `at_risk`** — управляются slash-командой `/health_status <value>` и `/clear_health_status`.
- Важно: это поле **GitLab Ultimate (EE)**, то есть часть кода/бизнес-логики находится в EE-модулях с отдельной (не чисто MIT) лицензией — при переиспользовании самой **модели** (3 состояния + комментарий/причина) проблем нет, это не код, а концепция; копировать реализацию виджета (`ee_component/issues/components/issue_health_status.vue`, упомянут в [`app/assets/javascripts/work_items/list/components/health_status.vue`](https://github.com/gitlabhq/gitlabhq/blob/master/app/assets/javascripts/work_items/list/components/health_status.vue)) — не имеет смысла, он в EE-дереве и не то же самое, что модель Swarm (задача vs инициатива).
- **Что брать:** ровно набор из трёх статусов и человеческий вокабуляр (on_track/needs_attention/at_risk) — почти буквально совпадает с требованием Swarm «ok / risk / problem». Название `needs_attention` можно взять как более мягкую формулировку, чем «problem», если понадобится третье состояние без явного «беда». В Swarm уже задано 3 состояния (ok/risk/problem) + комментарий — GitLab подтверждает, что это стандартный промышленный паттерн (Ultimate-фича, используется для «Issue health status» в портфельных отчётах), не более того — реализацию агрегации статусов в отчёт я не читал (не было времени, второй заход при необходимости).
- **Что не брать:** сама EE-реализация лицензионно не Core (для использования в проде как включённая фича нужна лицензия GitLab EE/Ultimate, хотя исходники видны в открытом репозитории — «visible source»); не копировать код виджета один в один.

### 2.2 Linear-подобных open-source аналогов "Project Update" (on track / at risk / off track) не нашёл

- Искал по `hcengineering/platform` (Huly, открытый аналог Linear) термины `onTrack`/`at_risk` — совпадений по концепции статус-апдейта проекта **не нашёл** (`gh search code "at_risk" repo:hcengineering/platform` и `gh search code "onTrack"` — только шум про WebRTC/трекинг курсора, не про статус проекта). Похоже, что открытая версия Huly либо не реализует эту фичу Linear (Project Update: on track/at risk/off track), либо не проиндексирована под этими именами — **не проверено до конца**, отмечаю как открытый вопрос ниже, а не как «отсутствует».

---

## 3. Список ссылок у задачи (IssueLink)

### 3.1 Plane — `IssueLink` модель + сериализатор с валидацией (AGPL-3.0)

- Модель: [`apps/api/plane/db/models/issue.py`](https://github.com/makeplane/plane/blob/master/apps/api/plane/db/models/issue.py), класс `IssueLink` (строки 371-384) — **прочитано целиком**.
- Валидация при создании: [`apps/api/plane/api/serializers/issue.py`](https://github.com/makeplane/plane/blob/master/apps/api/plane/api/serializers/issue.py), класс `IssueLinkCreateSerializer` (строки 405-445) — **прочитано целиком**.
- Схема поля:
  ```python
  class IssueLink(ProjectBaseModel):
      title = models.CharField(max_length=255, null=True, blank=True)
      url = models.TextField()
      issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_link")
      metadata = models.JSONField(default=dict)
  ```
  — ровно `url + title` (опционально) + свободный `metadata` (JSON) на будущее (например, favicon/og-превью), плюс наследуемые от `ProjectBaseModel` `created_by/updated_by/created_at/updated_at`.
- Валидация в `IssueLinkCreateSerializer.validate_url`: 1) формат URL через Django `URLValidator`; 2) явная проверка схемы — разрешены только `http://`/`https://` (не `ftp://`, не `javascript:` и т.п. — простая защита от XSS/чепухи); 3) в `create()` — защита от дублей: `IssueLink.objects.filter(url=..., issue_id=...).exists()` → `ValidationError("URL already exists for this Issue")`, т.е. один и тот же URL нельзя прикрепить к задаче дважды, но разные задачи могут ссылаться на один URL.
- Лимитов на **количество** ссылок на задачу в модели не увидел (ни в модели, ни в сериализаторе) — если такой лимит нужен Swarm, это придётся добавить самим, готового паттерна тут нет.
- **Что брать:** сама структура поля (`url` + `title?` + `metadata` JSON про запас) и три правила валидации (валидный URL, только http/https, запрет дубля URL на одной задаче) — прямое совпадение с формулировкой задания «валидация, лимиты» (лимитов, впрочем, Plane не делает).
- **Что не брать:** `metadata` JSONField от Plane используется под их специфику (например OpenGraph-парсинг ссылки на фронте) — в Swarm можно не тащить это поле, если функциональность превью не нужна.

---

## 4. Снимок удалённых элементов (задача удалена, но упоминание в закрытом спринте остаётся)

### 4.1 Taiga — generic `HistoryEntry` с `pre_delete`-снимком по строковому ключу (MPL-2.0)

- Модель: [`taiga/projects/history/models.py`](https://github.com/taigaio/taiga-back/blob/master/taiga/projects/history/models.py), класс `HistoryEntry` (строки 33-97) — **прочитано целиком**.
- Сервис: [`taiga/projects/history/services.py`](https://github.com/taigaio/taiga-back/blob/master/taiga/projects/history/services.py), функции `make_key_from_model_object`, `take_snapshot` (строки 85-90, 368-...) — **прочитано частично** (нужные функции, не весь файл).
- Точка вызова: [`taiga/projects/history/mixins.py`](https://github.com/taigaio/taiga-back/blob/master/taiga/projects/history/mixins.py), `HistoryResourceMixin.pre_delete()` (строки 71-73) — **прочитано целиком** (класс).
- Лицензия: **Mozilla Public License 2.0** (шапка каждого файла) — гораздо мягче AGPL, спокойно можно переиспользовать саму схему и даже адаптировать код.
- Механизм:
  1. `HistoryEntry` не хранит FK на исходный объект — только строковый `key = "{app_label}.{ModelName}:{pk}"` (`make_key_from_model_object`) + JSON-поля `diff`, `snapshot` (полный замороженный снимок state на момент записи), `values` (расшифровка id→имя для полей типа assignee/status, чтобы не зависеть от того, жив ли ещё referenced объект).
  2. При удалении объекта DRF-миксин `HistoryResourceMixin.pre_delete(obj)` **до** реального `DELETE` из БД вызывает `persist_history_snapshot(obj, delete=True)` → `take_snapshot(obj, delete=True)`, который создаёт `HistoryEntry` с `type=HistoryType.delete` и полным JSON `snapshot` (замороженная сериализация объекта). Реальная строка потом удаляется как обычно, но её последнее состояние навсегда остаётся в `history_historyentry` по строковому ключу.
  3. Поскольку `key` — не FK, а строка `"model:pk"`, история переживает удаление исходной записи без всяких `ON DELETE SET NULL`/soft-delete трюков на самой сущности.
- **Что брать напрямую в архитектуру Swarm:** для требования «удалённая задача остаётся в спринте упоминанием (снимок названия)» — не обязательно городить общий history-фреймворк как в Taiga; но сам **приём** «замораживать нужные поля (название, возможно id/код) в JSON на объекте/строке-связке спринт↔задача **в момент удаления**, ключом делать не FK, а денормализованную пару (например `task_id UUID` без FK-констрейнта + `snapshot_title text`)» — это ровно тот паттерн, который решает задачу «пусть оригинал уйдёт, упоминание останется», без необходимости тащить полноценный event-sourcing. Хук уместнее всего вешать в месте, где Swarm выполняет `delete_task` (в бэкенде — до физического DELETE, аналогично `pre_delete`).
- **Что не брать:** сам `HistoryEntry` в Taiga — это общий per-project audit log (типы change/create/delete, диффы, комментарии, hidden-флаги) — тяжелее, чем нужно для одной узкой задачи «имя удалённой задачи в отчёте спринта»; тащить всю систему целиком избыточно.

---

## 5. Иерархия инициатива → задачи и прогресс инициативы

### 5.1 OpenProject — rollup прогресса родителя от детей (GPLv3)

- Сервис: [`app/services/work_packages/update_ancestors_service.rb`](https://github.com/opf/openproject/blob/dev/app/services/work_packages/update_ancestors_service.rb) — **прочитано целиком** (метод `compute_derived_done_ratio` и соседние, строки 135-172).
- Лицензия: репозиторий OpenProject — **GPLv3** (заголовок файла: `it under the terms of the GNU General Public License version 3`).
- Модель поля: `derived_done_ratio` — вычисляемый (не хранимый вручную) процент выполнения родительского work package, отдельно от собственного `done_ratio`; хранится и в `work_packages`, и в `work_package_journals` (история). Замечено через `gh search code "derived_done_ratio" repo:opf/openproject`.
- Два режима агрегации прогресса родителя от детей (переключаемый режим на уровне инстанса, `WorkPackage.work_weighted_average_mode?` / `simple_average_mode?`):
  1. **Work-weighted average** (по трудозатратам): `progress = (estimated_hours - remaining_hours) / estimated_hours * 100` — прогресс = доля выполненной работы в часах у ВСЕХ потомков суммарно (через `derived_estimated_hours`/`derived_remaining_hours`, которые сами уже рекурсивно посчитаны).
  2. **Simple average** (по проценту, без часов): берёт `done_ratio` (или уже посчитанный `derived_done_ratio`) каждого прямого ребёнка, включая сам родитель если у него тоже есть `done_ratio` и его статус не исключён из тотала (`excluded_from_totals`), и считает **простое среднее** (`sum / count`), округляя.
  3. Дети, статус которых `excluded_from_totals` (аналог "отменено"/"не считается"), в расчёт не попадают — прямая параллель с тем, как Plane исключает `cancelled` задачи из статистики спринта (см. находку 1.1).
- **Что брать:** для Swarm, где у задачи нет трудозатрат/estimate (только статус/done), подходит именно **simple average mode**: прогресс инициативы = среднее по её задачам (0/100 или доля done), причём отменённые/архивные задачи исключить из знаменателя — тот же принцип, что и в Plane cycle stats. Схема «направление → инициатива → задачи» из задания Swarm — это ровно двухуровневая рекурсия parent/child work package из OpenProject, только фиксированной глубины (в OpenProject глубина произвольная).
- **Портфельный вид** (портфолио как группа проектов): у OpenProject есть отдельная сущность `workspace_type: portfolio` — [`app/controllers/portfolios_controller.rb`](https://github.com/opf/openproject/blob/dev/app/controllers/portfolios_controller.rb) — **просмотрено по коду частично** (первые ~80 строк), это скорее «проект-контейнер проектов» с собственным фильтруемым списком (`@query`), а не про прогресс-роллап — самостоятельной пользы для Swarm меньше, чем у `update_ancestors_service.rb`, дальше не копал.

---

## 6. Готовые отчёты спринта (без burn-up)

### 6.1 OpenProject Backlogs — `SprintWorkPackageBreakdown`: реконструкция состава спринта по журналу, а не по замороженному снимку (GPLv3)

- Файл: [`modules/backlogs/app/models/sprint_work_package_breakdown.rb`](https://github.com/opf/openproject/blob/dev/modules/backlogs/app/models/sprint_work_package_breakdown.rb) — **прочитано целиком** (100 строк).
- Контроллер отчёта: [`modules/backlogs/app/controllers/backlogs/sprint_reports_controller.rb`](https://github.com/opf/openproject/blob/dev/modules/backlogs/app/controllers/backlogs/sprint_reports_controller.rb) — **прочитано целиком**, но сам контроллер пуст (`def show; end`) — логика полностью в модели выше плюс на фронтенде; для Swarm полезности почти нет, оставляю для полноты.
- Архитектурно это **другой подход**, чем у Plane (см. находку 1.1): вместо того чтобы на закрытии спринта замораживать один JSON-агрегат, OpenProject **на лету реконструирует** состояние спринта на любой момент времени через `WorkPackage.at_timestamp(timestamp)`, которая читает историчные `sprint_id/status_id/story_points` из таблицы аудита `work_package_journals` (аналог Rails `paper_trail`/event log, где каждое изменение work package пишется отдельной строкой-версией).
- Публичные методы дают ровно набор чисел, нужный для «итогов спринта»:
  - `initially_planned` — снимок на момент старта спринта (`reference_start` = `started_at` либо `start_date.beginning_of_day`).
  - `completed` / `unfinished` — снимок на момент финиша (`reference_finish` = `completed_at`, либо `max(finish_date.end_of_day, now)` если спринт ещё идёт), отфильтрованный по `done_status_ids` (закрывающие статусы проекта + статусы с `is_closed: true`).
  - `changed_after_start` — `ChangeBlock(added_count, removed_count, added_story_points, removed_story_points)`: сравнивает **множества id** задач на старте и на финише (`finish_points.keys - start_points.keys` = добавленные, наоборот — убранные/перенесённые), т.е. «добавлено/убрано после старта» считается чистой разницей множеств на двух временных срезах, без явного события «перенос».
- **Что брать:** сам набор отчётных срезов (`запланировано на старте` / `сделано` / `не сделано` / `добавлено-убрано после старта`) почти буквально ложится на формулировку задания Swarm «итоги (сделано/перенесено/без движения, %)» — «перенесено» у Swarm ≈ `removed_after_start_ids` минус те, что реально удалены (у OpenProject это не различается — снятие с спринта и удаление задачи неразличимы в этой модели, только по `finish_points.keys - start_points.keys`).
- **Что не брать и явное отличие:** OpenProject **не хранит явного снимка** нигде — если у Swarm нет полноценного event-sourcing/журнала изменений задач (как `work_package_journals`), этот подход не воспроизвести дёшево; для Swarm практичнее подход Plane (см. 1.1) — заморозить агрегаты **в момент закрытия** одним JSON-полем, а не реконструировать их из истории. Механизм `at_timestamp` завязан на отдельный, дорогой в постройке слой (полноценные журналы версий по каждому полю) — не нашёл признаков того, что в Swarm он уже есть.
- **Негативная находка (важно для задания):** явного поля «причина переноса» (`carry_over_reason` / `rollover_reason` / `spillover_reason` и т.п.) **не нашёл ни в одном из просмотренных репозиториев** (Plane, Taiga, OpenProject) — искал `gh search code "rollover_reason OR carryover_reason OR carry_over_reason OR transfer_reason"` и `"spillover"` по всему GitHub, совпадений по коду инструментов планирования не дал (шум из научных статей о причинно-следственных эффектах). Это подтверждает: «перенос с указанием причины» — не типовой паттерн у авторов исследованных open-source трекеров, Swarm тут проектирует сам, без готового аналога модели данных.

---

## Итоговая рекомендация (что конкретно брать)

1. **Закрытие спринта / снимок:** паттерн Plane (находка 1.1) — заморозить агрегаты **одним JSON-полем на спринте в момент закрытия** (`total/done/cancelled/started/...` + разбивка по исполнителю), а не пытаться городить журнал версий как в OpenProject (находка 6.1) — тот подход требует инфраструктуры (full audit trail), которой в Swarm пока нет.
2. **Перенос незакрытых задач:** механика Plane «просто переставить FK на новый спринт, залогировать факт в activity» (находка 1.1) — работает, но **причины переноса у Plane нет**, это уникальное для Swarm требование — проектировать самим (например отдельное поле `carry_over_reason text` на строке-связке задача↔спринт, или на самой задаче на момент переноса).
3. **Статусы сверки (ok/risk/problem):** промышленный трёхзначный вокабуляр подтверждён GitLab Ultimate `health_status` (находка 2.1: `on_track`/`needs_attention`/`at_risk`) — Swarm-набор (ok/risk/problem) уже соответствует этому паттерну, менять не нужно, просто фиксирует, что решение стандартное.
4. **Ссылки на задаче:** модель Plane `IssueLink` (находка 3.1) — `url + title? + metadata JSON`, с валидацией URL-формата, разрешённой схемы (http/https) и запретом дубля URL на одной задаче — переносится в Swarm почти без изменений; лимит на количество ссылок добавить самим (Plane его не делает).
5. **Снимок удалённой задачи в закрытом спринте:** приём Taiga `HistoryEntry`/`take_snapshot(delete=True)` (находка 4.1, лицензия MPL-2.0 — самая мягкая среди всех находок) — не тащить весь audit-фреймворк, а применить сам приём: при `DELETE` задачи, если она входит в закрытый/закрывающийся спринт, до физического удаления заморозить `snapshot_title` (и, возможно, код задачи) на строке-связке спринт↔задача, без FK на исходную задачу.
6. **Прогресс инициативы от задач:** simple-average режим OpenProject (находка 5.1) — прогресс инициативы = среднее по её задачам, с исключением отменённых/архивных из знаменателя.

## Открытые вопросы / не докопал

- **Huly (`hcengineering/platform`)** — не подтверждено и не опровергнуто окончательно, есть ли в открытой части (не Enterprise) аналог Linear "Project Update" (on track/at risk/off track на уровне проекта, а не задачи). Поиск по коду не дал явных совпадений, но это не равно «отсутствует» — нужен отдельный заход с чтением `plugins/tracker*` моделей проекта (`Project`/`Milestone`), если понадобится ещё один источник для статус-апдейта на уровне инициативы, а не задачи.
- Kanboard, Focalboard, Wekan, Leantime — **не проверялись предметно** в этом заходе (нет времени): это в основном kanban-инструменты без выраженной модели «спринт с закрытием и переносом», априори менее вероятный источник, чем Plane/Taiga/OpenProject/GitLab, но формально не исключены как источник для узких кусков (например, Leantime — сплошной PHP-монолит с открытым roadmap-модулем, не смотрел).
- Агрегация `health_status` в портфельный отчёт (roll-up на уровне эпика/группы issues) у GitLab EE — не читал код агрегации, только модель поля и quick-action; если понадобится именно алгоритм агрегации статусов инициативы из статусов задач — отдельный заход.
