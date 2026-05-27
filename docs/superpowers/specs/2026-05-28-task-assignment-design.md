# Task Assignment — Design Spec
*2026-05-28*

## Цель

Улучшить систему назначения задач: добавить роли пользователей, матчинг по почте и псевдонимам, назначение нескольким исполнителям через логику роль + страна.

---

## Секция 1: Изменения схемы БД

### `user_profiles` — новые поля

```sql
role         text CHECK (role IN ('marketing', 'bd', 'rnd')) DEFAULT NULL
email        text DEFAULT NULL
name_aliases text[] DEFAULT '{}'  -- альтернативные имена: «Вася», «Vasily», «Vas»
```

Роли фиксированные:
- `marketing` — маркетинг
- `bd` — бизнес-девелопмент + операционка (catch-all для всего что не product и не marketing)
- `rnd` — работают с продуктом

Редактировать `email` через существующую админку профилей.

### `tasks` — изменения

```sql
-- добавить
task_role             text CHECK (task_role IN ('marketing', 'bd', 'rnd')) DEFAULT NULL
assignee_telegram_ids int4[] DEFAULT '{}'

-- убрать
assignee_telegram_id  int4   -- заменяется массивом выше
```

---

## Секция 2: Логика резолюции исполнителя

GPT в промпте извлечения получает полный список профилей:
```json
{ "id": 123456789, "name": "Василий Гарров", "aliases": ["Вася", "Vasily"], "email": "v@example.com", "role": "bd", "markets": ["Словения", "Хорватия"] }
```

GPT возвращает на каждую задачу:
```json
{
  "title": "Обновить прайс-лист",
  "assignee_ids": [123456789],
  "task_role": "bd",
  "country": "Словения",
  "due_date": "2026-06-01",
  "confidence": 0.85
}
```

### Резолюция на сервере (приоритет сверху вниз)

| Условие | Результат |
|---|---|
| `assignee_ids` непустой | назначаем этих людей напрямую |
| `task_role` + `country` | все профили с этой ролью у кого страна в `markets[]` |
| только `country` | все профили у кого страна в `markets[]` (любая роль) |
| только `task_role` | общий пул: `assignees = []`, `task_role` проставлен |
| ничего | общий пул: всё пустое |

Если несколько исполнителей → один таск с несколькими `assignees` и `assignee_telegram_ids[]`.

Все задачи уходят в статус `pending` — подтверждение через кнопки в боте (временно, убрать после обкатки).

---

## Секция 3: Изменения в коде

### Матчинг — убрать substring, перейти на GPT

Файлы: `swarm-bot/tasks/matcher.ts`, `swarm-mcp/tasks/tools.ts`

Текущий substring-матчинг (`includes(lower)`) заменить на GPT-резолюцию. Функция `resolveAssignees(profiles, extracted)` реализует логику таблицы выше.

### `analyzeAndCreateTasks` — обновить промпт

Файл: `swarm-bot/tasks/handlers.ts`

- Передавать в промпт полные профили: `name`, `email`, `name_aliases`, `role`, `markets`
- GPT возвращает `assignee_ids[]` + `task_role` + `country` вместо одного `assignee_id`
- Минимальный порог confidence остаётся `>= 0.7`

### DB-слой — массив вместо одного ID

Файл: `swarm-bot/tasks/db.ts`

- `dbCreateTask` / `dbUpdateTask` — `assignee_telegram_id` → `assignee_telegram_ids[]`
- `dbListTasks` — фильтр `assignee_telegram_ids @> ARRAY[userId]` вместо `= userId`

### MCP-инструменты — добавить `task_role`

Файл: `swarm-mcp/tasks/tools.ts`

- `add_task` / `update_task` — добавить `task_role` в inputSchema
- `toolAddTask` — вызывать тот же `resolveAssignees` для матчинга

---

## Секция 4: Что не меняем

- Флоу подтверждения (`pending` → кнопки) — без изменений
- Формат карточки задачи в боте — без изменений
- Источники извлечения: встречи (авто) + явное упоминание в тексте

---

## Источники задач

- **Встречи** — автоматически при сохранении транскрипта (`analyzeAndCreateTasks`)
- **Явный текст** — только если TASK_KEYWORDS совпадает (`/задач|таск|task|сделать|.../`)
