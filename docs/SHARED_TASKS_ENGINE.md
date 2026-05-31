# Единый движок задач — _shared/tasks/

> Статус: **выполнено** (2026-05-31, ветка `sandbox_vas`).

---

## Что сделано

### Файлы

| Файл | Что это |
|------|---------|
| `_shared/tasks/types.ts` | Единственный источник `Task` и `TaskInput`. Клиенты импортируют отсюда. |
| `_shared/tasks/db.ts` | Чистый доступ к таблице `tasks`: `createTask`, `getTask`, `listTasks`, `updateTask`, `deleteTask`. |
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
  filters: { status?, country?, period?, telegramId?, assigneeText?, limit? }
  Порядок: due_date ASC, nullsFirst:false.
  Без status → исключает done/cancelled/draft.
  country: ilike. period="week": gte today / lte +7d.
  telegramId: contains(assignee_telegram_ids, [id]).
  assigneeText: пост-фильтр по assignees[].
  limit: дефолт 200.

updateTask(id, fields) → Promise<void>
  Всегда добавляет updated_at.

deleteTask(id) → Promise<void>
  Сначала task_history, потом tasks.
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
