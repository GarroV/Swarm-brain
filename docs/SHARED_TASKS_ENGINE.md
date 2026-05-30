# Единый движок задач — план вынесения shared/tasks/db.ts

> Только описание и предложение. Никаких изменений кода до согласования.

---

## 1. Сравнительная таблица двух реализаций

### CREATE

| Аспект | `swarm-bot/tasks/db.ts` | `swarm-mcp/tasks/tools.ts` |
|--------|------------------------|---------------------------|
| Сигнатура | `dbCreateTask(input: TaskInput): Promise<Task>` | `toolAddTask(args): Promise<string>` |
| Возврат | Типизированный объект `Task` | Строка `"✅ Задача создана (id: ...)"` |
| Ошибки | Бросает исключение | Возвращает строку `"Ошибка: ..."` |
| Разрешение исполнителя | Нет — ожидает готовые `assignees[]` и `assignee_telegram_ids[]` | Да — принимает `assignee_name: string`, резолвит через `matchAssignee()` с fuzzy-матчингом |
| Workspace `group_id` | Параметр `input.group_id` (уже готовый) | Резолвит из `requesting_user_id` → запрос в `allowed_users` |
| Статус по умолчанию | `"open"` | `"open"` |
| Теги | Из input, дефолт `[]` | Хардкод `[]` |

### READ / LIST

| Аспект | `swarm-bot/tasks/db.ts` | `swarm-mcp/tasks/tools.ts` |
|--------|------------------------|---------------------------|
| Сигнатура | `dbListTasks(opts): Promise<Task[]>` | `toolGetTasks(args): Promise<string>` |
| Возврат | Массив объектов `Task[]` | Форматированная строка для Claude |
| Фильтр по telegramId | Да (`assignee_telegram_ids @> [id]`) | Нет |
| Фильтр по assignee | Да (клиентская фильтрация по тексту) | Да (клиентская фильтрация по тексту) |
| Лимит | Параметр, дефолт 200 | Хардкод 30 |
| Workspace | Параметр `groupId` | Резолв из `requesting_user_id` |

### UPDATE

| Аспект | `swarm-bot/tasks/db.ts` | `swarm-mcp/tasks/tools.ts` |
|--------|------------------------|---------------------------|
| Сигнатура | `dbUpdateTask(id, fields): Promise<void>` | `toolUpdateTask(args): Promise<string>` |
| Возврат | `void` | Строка `"✅ Задача обновлена."` |
| Обновляемые поля | Любое поле `TaskInput` + `status` + `url` | Только 7 конкретных полей (`title`, `description`, `country`, `due_date`, `status`, `task_role`, `assignee_name`) |
| Разрешение исполнителя | Нет | Да — при смене `assignee_name` резолвит имя в ID |
| `updated_at` | Всегда обновляет | Всегда обновляет |
| Ошибки | Тихий проглот | Возвращает строку |

### DELETE

| Аспект | `swarm-bot/tasks/db.ts` | `swarm-mcp/tasks/tools.ts` |
|--------|------------------------|---------------------------|
| Сигнатура | `dbDeleteTask(id): Promise<void>` | `toolDeleteTask(args): Promise<string>` |
| Возврат | `void` | Строка с названием задачи |
| Удаление task_history | Да | Да |
| Проверка существования | Нет | Да — фетчит задачу перед удалением |
| Ошибки | Тихий проглот | Возвращает строку |

---

## 2. Почему расходятся

**Намеренные различия** (обусловлены разными клиентами):

| Различие | Причина |
|----------|---------|
| **Возврат: Task vs. строка** | Бот использует объект для рендеринга Telegram UI (кнопки, карточки). MCP отдаёт Claude текст для показа в чате |
| **Ошибки: throw vs. строка** | Бот — внутренний код, исключения обрабатываются вызывающим. MCP — инструментный интерфейс, ошибка должна прийти как читаемый текст |
| **Резолв исполнителя** | Бот получает уже выбранного пользователя из Telegram UI (кнопка). MCP получает текстовое имя от Claude — нужен fuzzy-матч |
| **Резолв workspace** | Бот вызывается из хендлеров, где `groupId` уже известен. MCP принимает `requesting_user_id` от Claude и должен сам найти workspace |
| **Ограничение полей при UPDATE** | MCP через AI-интерфейс — ограниченный набор полей защищает от нечаянных мутаций. Бот — внутренний API, нет смысла ограничивать |

**Случайные различия** (технический долг без обоснования):

| Различие | Вердикт |
|----------|---------|
| Лимит 200 vs. 30 | Случайное — нет причины иметь разные дефолты |
| `telegramId`-фильтр только в боте | Случайное — MCP просто не добавил, хотя мог бы |
| Проверка существования при DELETE только в MCP | Случайное — бот просто доверяет вызывающему |

---

## 3. Что конкретно сломается при объединении

Если создать `shared/tasks/db.ts` с единым контрактом (возвращает `Task`, бросает исключения):

### В swarm-bot

Нужно обновить импорты в одном файле: `swarm-bot/tasks/handlers.ts` строка 5.

Ничего не сломается по логике — бот уже ожидает типизированные объекты. Единственное, что нужно поменять — путь импорта.

Прямые запросы `supabase.from("tasks")` в `handlers.ts` (строки 626, 632, 643) и `index.ts` (строки 326–327) всё равно останутся — они не через `db.ts` идут. Их трогать не обязательно на первом этапе.

### В swarm-mcp

Сломается интерфейс всех четырёх инструментов — они сейчас возвращают строки, а вызывающий код в `index.ts` ждёт строку:

```typescript
let result = "";
// все tool-вызовы присваивают строку в result
return ok(id, textContent(result)); // ждёт строку
```

Если `toolGetTasks()` начнёт возвращать `Task[]` — в JSON-RPC ответе окажется объект вместо строки, и Claude Desktop не сможет его отобразить.

**Решение:** тонкая обёртка в `tools.ts` — каждый инструмент вызывает shared-функцию и форматирует результат в строку. Сам `index.ts` при этом не меняется.

### В типах

`swarm-bot/tasks/types.ts` и потенциальный `shared/tasks/types.ts` — нужно убедиться что тип `Task` один. Сейчас бот импортирует `Task` из `./types.ts` (handlers.ts строка 8, db.ts строка 2).

---

## 4. Единый контракт и план перехода

### Контракт shared/tasks/db.ts

Функции принимают **уже готовый `group_id: string | null`** — workspace резолвится снаружи, до вызова:

```
createTask(input: TaskInput, groupId?: string) → Promise<Task>
  input: { title, description?, assignees?, assignee_telegram_ids?, due_date?,
           tags?, country?, task_role?, source?, status?, meeting_id? }
  - не делает name resolution
  - не делает workspace lookup
  - бросает исключение при ошибке

getTask(id: string) → Promise<Task | null>

listTasks(filters, groupId?) → Promise<Task[]>
  filters: { assignee?, telegramId?, country?, status?, period?, limit? }

listAllOpen(groupId?) → Promise<Task[]>

updateTask(id: string, fields: Partial<TaskInput>) → Promise<void>
  - всегда обновляет updated_at
  - бросает исключение при ошибке

deleteTask(id: string) → Promise<void>
  - сначала удаляет task_history
  - бросает исключение при ошибке
```

### Тонкие прослойки для каждого клиента

**swarm-bot:** прослойка почти нулевая.  
Хендлеры уже передают `groupId` в `dbListTasks` и `dbCreateTask`. Меняется только путь импорта. Бот не делает name resolution — всё ок.

**swarm-mcp:** прослойка делает три вещи до вызова shared-функции:
1. Резолвит `requesting_user_id → group_id` (через `allowed_users`)
2. Резолвит `assignee_name → { assignees[], assignee_telegram_ids[] }` (через `matchAssignee`)
3. После получения `Task` — форматирует в строку для Claude

**Mini App:** прослойка делает одну вещь до вызова:  
1. Берёт `group_id` из JWT-токена (который выдал `swarm-api` после проверки initData)

### Порядок перехода

**Этап 0 (сейчас, ничего не трогать):** документируем контракт, согласовываем.

**Этап 1 — Mini App:**  
Пишем `shared/tasks/db.ts` с нуля под согласованный контракт. Новый `swarm-api` использует его сразу. Бот и MCP не трогаем — работают как раньше. Риск: ноль.

**Этап 2 — swarm-mcp:**  
`tools.ts` заменяет прямые Supabase-запросы на вызовы shared-функций. Снаружи `index.ts` не меняется — `tools.ts` всё так же возвращает строки. Риск: низкий (только tools.ts, хорошо изолирован).

**Этап 3 — swarm-bot:**  
`swarm-bot/tasks/db.ts` становится тонкой обёрткой над shared. Импорты в `handlers.ts` меняются. Риск: низкий (типы совместимы, логика не меняется).

**Этап 4 (опционально):**  
Убрать прямые `supabase.from("tasks")` из `handlers.ts` и `index.ts`, перевести на shared. Это уже рефактор, не обязателен для запуска Mini App.

---

## Открытые вопросы

1. Где физически жить `shared/`? Варианты:
   - `supabase/functions/shared/` — Deno-путь через relative imports
   - Отдельный npm/deno-пакет — избыточно для 5 файлов
   - Симлинки — работает, но неудобно при деплое на Supabase
2. Этап 1 и 2 делать одновременно с Mini App, или Этап 2 (MCP) сначала как самостоятельный шаг?
3. Переносить ли `task_history`-логику в shared или оставить в `deleteTask` каждого клиента?
