# Единый движок задач — _shared/tasks/

> Статус: **выполнено** (2026-05-31, ветка `sandbox_vas`).

---

## Что сделано

### Файлы

| Файл | Что это |
|------|---------|
| `_shared/tasks/types.ts` | Единственный источник `Task` и `TaskInput`. Клиенты импортируют отсюда. |
| `_shared/tasks/db.ts` | Чистый доступ к таблице `tasks`: `createTask`, `getTask`, `listTasks`, `updateTask`, `deleteTask`. |
| `_shared/tasks/sprints.ts` | Доступ к таблице `sprints` (изоляция по `group_id`): `listSprints`, `createSprint`, `updateSprint`, `deleteSprint`, `setTasksSprint`. |
| `_shared/tasks/dependencies.ts` | Доступ к `task_dependencies`: `listDependencies`, `listWorkspaceDependencies`, `createDependency`, `deleteDependency`. Приватность — только через `tasks`. |
| `swarm-mcp/tasks/tools.ts` | Прослойка MCP: резолв `requesting_user_id→group_id` и `assignee_name→assignees/ids`, вызов движка, форматирование строк для Claude. |
| `swarm-bot/tasks/db.ts` | Тонкая обёртка бота: пробрасывает все вызовы в движок. `dbListAllOpen` остаётся локально (другой порядок сортировки). |
| `swarm-bot/tasks/types.ts` | Реэкспорт из `_shared/tasks/types.ts` — импорты в handlers.ts/formatter.ts/matcher.ts не менялись. |

### Коммиты

1. `27f1ff9` — создание `_shared/tasks/{types,db}.ts`
2. `b723d94` — перевод `swarm-mcp/tasks/tools.ts` на движок
3. `0840a3f` — перевод `swarm-bot/tasks/db.ts` на движок

---

## Контракт движка

Движок принимает **уже готовый** `group_id` и **уже разрешённых** исполнителей. Резолв имён и поиск workspace — ответственность прослоек.

```
createTask(input: TaskInput, groupId?: string) → Promise<Task>
  Параметр groupId перекрывает input.group_id.
  Дефолт status="open", tags=[].

getTask(id: string) → Promise<Task | null>

listTasks(filters, groupId?) → Promise<Task[]>
  filters: { status?, country?, period?, telegramId?, assigneeText?, limit?,
             confirmed?, createdBy?, dueToday?, viewerId?, isAdmin?,
             sprintId?, tags?, startDateFrom?, startDateTo?, dueDateFrom?, dueDateTo? }
  Порядок: due_date ASC, nullsFirst:false.
  Видимость приватных задач (модуль Рой):
    isAdmin=true → видит все (фильтр приватности не накладывается).
    иначе viewerId задан → or(is_private.eq.false, owner_id.eq.viewerId).
    иначе (нет ни isAdmin, ни viewerId) → безопасный дефолт: только is_private=false.
  confirmed задан → eq(confirmed); иначе (и не dueToday) исключает done/cancelled/draft.
  country: ilike. createdBy: eq(created_by_telegram_id).
  sprintId: eq(sprint_id). tags: overlaps (ANY-совпадение).
  startDateFrom/To: gte/lte(start_date). dueDateFrom/To: gte/lte(due_date).
  telegramId: contains(assignee_telegram_ids, [id]).
  dueToday: lte(due_date, today) + eq(confirmed, true).
  period="week": gte today / lte +7d.
  assigneeText: пост-фильтр по assignees[] (после запроса).
  limit: дефолт 200.

updateTask(id, fields) → Promise<void>
  Всегда добавляет updated_at.

deleteTask(id) → Promise<void>
  Сначала task_history, потом tasks.
```

---

## Контракт спринтов (`sprints.ts`)

Все операции изолированы по `group_id` — спринт принадлежит воркспейсу.
`groupId` обязателен во всех функциях.

```
listSprints(groupId: string) → Promise<Sprint[]>
  eq(group_id). Порядок: start_date DESC. Ошибки не бросает — пустой массив.

createSprint(input: SprintInput, groupId: string) → Promise<Sprint>
  Вставляет name, start_date, end_date; status дефолт "planned".
  group_id всегда из аргумента (не из input). Бросает при ошибке.

updateSprint(id, fields: Partial<SprintInput>, groupId) → Promise<Sprint | null>
  Обновляет только спринт своего воркспейса: eq(id) + eq(group_id).
  Возвращает обновлённый Sprint или null (не найден / чужой воркспейс).

deleteSprint(id, groupId) → Promise<boolean>
  Удаляет только свой воркспейс: eq(id) + eq(group_id).
  true если строка удалена, false если не найдена/чужая.
  Задачи освобождаются автоматически (FK ON DELETE SET NULL).

setTasksSprint(taskIds: string[], sprintId: string | null, groupId) → Promise<number>
  Массовое назначение/снятие sprint_id у задач воркспейса.
  Только командные задачи: in(id) + eq(group_id) + eq(is_private, false)
    — чужие личные задачи не трогаются (спринт командный).
  Добавляет updated_at. taskIds пуст → возвращает 0 без запроса.
  Возвращает число затронутых задач.
```

---

## Контракт зависимостей (`dependencies.ts`)

Таблица `task_dependencies` **не имеет** `group_id` — изоляция и приватность
обеспечиваются только через `tasks`. Тип `DepEdge = TaskDependency & { direction }`.

```
listDependencies(taskId: string) → Promise<DepEdge[]>
  Все рёбра задачи: исходящие (task_id = id, direction:"outgoing")
  и входящие (depends_on_id = id, direction:"incoming") одним массивом.
  Приватность НЕ проверяется — фильтрация на стороне вызывающего.

listWorkspaceDependencies(groupId, viewerId: number, isAdmin: boolean) → Promise<TaskDependency[]>
  Все рёбра воркспейса разом (устраняет N+1 от поэлементного listDependencies).
  1. Берёт видимые задачи воркспейса (та же приватность, что в listTasks:
     не админ → or(is_private.eq.false, owner_id.eq.viewerId)).
  2. Ребро возвращается, только если ВИДИМЫ ОБА конца (task_id и depends_on_id) —
     приватные задачи не утекают через граф. Нет видимых задач → [].

createDependency(taskId, dependsOnId, type: DependencyType) → Promise<CreateDepResult>
  CreateDepResult = { ok:true, dependency } | { ok:false, reason:"cycle"|"duplicate" }.
  Защита от циклов: через RPC get_all_dependencies(root_id=dependsOnId) собирает
    транзитивно достижимые задачи; если taskId среди них — связь замкнула бы граф →
    { ok:false, reason:"cycle" }.
  Unique-violation (код 23505) → { ok:false, reason:"duplicate" }.
  Прочие ошибки БД — бросает.

deleteDependency(taskId, depId) → Promise<boolean>
  Удаляет ребро по id, только если оно принадлежит задаче: eq(id) + eq(task_id).
  true если удалено, false если не найдено / чужое.
```

---

## Сведённые «случайные различия»

| Различие | Как свели |
|----------|-----------|
| Лимит 200 vs 30 | Параметр `limit`, дефолт 200. MCP передаёт `limit: 30` в своей прослойке. |
| `nullsFirst` только в боте | `nullsFirst:false` везде в движке. |
| `telegramId`-фильтр только в боте | Доступен в движке; MCP пока не передаёт, но может. |
| `select("id")` vs `select("*")` в create | Движок всегда `select("*")` — MCP прослойка использует только `task.id`. |
| Ошибки: throw vs строка | Движок бросает. Прослойка MCP ловит и возвращает строку. Бот принимает исключения как есть. |

---

## Что движок НЕ делает

- **Не резолвит имя исполнителя** — `matchAssignee()` остаётся в `swarm-mcp/tasks/tools.ts`
- **Не ищет workspace по telegram_id** — `resolveGroupId()` остаётся в прослойке MCP
- **Не форматирует строки** — форматирование под Claude остаётся в tools.ts

---

## Известный остаток (прямые запросы к tasks)

Прямые `supabase.from("tasks")` вне движка — следующий этап:

| Файл | Строки | Контекст |
|------|--------|---------|
| `swarm-bot/tasks/handlers.ts` | ~626, 632, 643 | callbacks `tl_pending`, `tl_done`, `tl_export` |
| `swarm-bot/index.ts` | ~326–327 | `smartTaskSearch` |

---

## Следующий шаг

Перевести `swarm-api` (будущий API для Mini App) на `_shared/tasks/db.ts` с первого дня.
