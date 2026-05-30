# Mini App — Архитектура доступа к данным

> Черновик для обсуждения. Изменения в коде/RLS — только после согласования.

---

## 1. Текущее состояние CRUD-логики задач

### Дублирование

Логика задач существует в **двух независимых копиях** без общего кода:

| | `swarm-bot/tasks/db.ts` | `swarm-mcp/tasks/tools.ts` |
|---|---|---|
| Назначение | Внутренний DAL для Telegram-бота | MCP-инструменты для Claude Desktop |
| Функции | `dbGetTask`, `dbListTasks`, `dbCreateTask`, `dbUpdateTask`, `dbDeleteTask`, `dbListAllOpen` | `toolAddTask`, `toolUpdateTask`, `toolDeleteTask`, `toolGetTasks` |
| Workspace | Параметр `groupId: string` | Параметр `requesting_user_id`, resolves через `allowed_users` |
| Auth | Нет (вызывается изнутри бота) | Нет (доверяет `requesting_user_id` на слово) |
| Общий код | ❌ | ❌ |

Дополнительно — прямые `supabase.from("tasks")` запросы разбросаны по `tasks/handlers.ts` (строки 626, 632, 643) и `index.ts` (строки 326–327), в обход `db.ts`.

**Вывод:** единого переиспользуемого слоя сейчас нет. Бизнес-логика размазана по хендлерам бота.

---

## 2. Контракт swarm-mcp (текущий)

**Протокол:** JSON-RPC 2.0 по HTTP POST.

**Workspace-идентификация:** параметр `requesting_user_id: number` (Telegram ID). Функция резолвит его в `group_id` через запрос к `allowed_users`. Нет общей утилиты — логика продублирована инлайн в каждом инструменте.

**Авторизация:** отсутствует на уровне инструментов. Любой, кто достучится до эндпоинта и передаст любой `requesting_user_id`, получит данные соответствующего воркспейса. Защита — только на уровне сетевой недоступности (Supabase Edge Function без публичного URL в открытом доступе).

**Для Mini App этот контракт не подходит** — нет механизма верификации того, что `requesting_user_id` принадлежит реальному пользователю, открывшему Mini App.

---

## 3. RLS на таблицах tasks и allowed_users

**Текущее состояние:**

| Таблица | RLS включён | Политики |
|---|---|---|
| `tasks` | ❌ | нет |
| `allowed_users` | ❌ | нет |
| `entries` | ❌ | нет |
| `app_settings` | ✅ | deny all (нет политик) |
| `workspaces` | ✅ | deny all (нет политик) |

Оба Edge Function используют `SUPABASE_SERVICE_ROLE_KEY`, который полностью обходит RLS. Workspace-изоляция реализована исключительно на уровне кода через фильтры `.eq("group_id", groupId)`.

**Вывод:** Mini App не может читать задачи напрямую через `supabase-js` с пользовательским токеном — таблица не защищена политиками, а давать Mini App service_role_key нельзя.

---

## 4. Рекомендация по архитектуре

### Контекст ограничений

- Telegram Mini App аутентифицирует пользователя через `initData` (HMAC-подписанная строка от Telegram) — это не Supabase JWT.
- Supabase Realtime работает через WebSocket и поддерживает фильтрацию на стороне сервера, но для workspace-изоляции нужен либо RLS, либо серверный прокси.
- Принцип проекта: бизнес-логика не в клиенте, клиенты взаимозаменяемы.

### Предлагаемая схема: API Edge Function + Lightweight RLS

```
Telegram Mini App
    │
    │  1. initData (HMAC)          2. workspace JWT (short-lived)
    ▼                                      │
swarm-api (новый Edge Function)            │
    │  - верифицирует initData              │
    │  - резолвит telegram_id → group_id   │
    │  - выдаёт JWT с claim {workspace}    │
    │  - REST CRUD для задач               │
    │                                      │
    ▼                                      ▼
Supabase DB (tasks)           supabase-js (Realtime)
    │                              │
    │  service_role_key             │  workspace JWT + RLS
    └──────────────────────────────┘
```

#### Компоненты

**`swarm-api` — новый Edge Function**

Единственная точка входа для Mini App. Делает три вещи:
1. Верифицирует `initData` от Telegram (HMAC-SHA256 с `BOT_TOKEN`)
2. Резолвит `telegram_id → group_id` через `allowed_users`
3. Отдаёт данные (tasks CRUD) через service_role_key + фильтр по group_id

Дополнительно — после верификации выдаёт короткоживущий Supabase JWT с кастомным claim `workspace_id`, который Mini App использует только для Realtime-подписки.

**Shared task module**

Вынести `tasks/db.ts` из swarm-bot в `shared/tasks/db.ts`. Импортировать из:
- `swarm-bot` (текущий потребитель)
- `swarm-mcp` (заменяет `tools.ts`)
- `swarm-api` (новый потребитель)

Это устраняет дублирование и делает логику по-настоящему переиспользуемой.

**Lightweight RLS на tasks** (только для Realtime)

Минимальная политика: `SELECT WHERE group_id = current_setting('app.workspace_id')`. Устанавливается через JWT claim в Supabase Auth. Нужна только для Realtime-подписок — все мутации идут через `swarm-api` с service_role_key.

#### Поток данных для Mini App

| Операция | Путь | Auth |
|---|---|---|
| Открытие Mini App | `swarm-api` POST `/auth` + initData | Telegram HMAC |
| Получить задачи | `swarm-api` GET `/tasks` | Bearer JWT от swarm-api |
| Создать/обновить/удалить | `swarm-api` POST/PATCH/DELETE `/tasks` | Bearer JWT |
| Realtime-подписка | supabase-js Realtime | workspace JWT (claim) + RLS |

### Альтернатива: всё через swarm-api (без Realtime)

Если realtime не критичен на старте — проще: Mini App только делает REST-запросы к `swarm-api`, поллинг каждые N секунд. Никаких изменений в RLS. Можно добавить Realtime позже.

**Плюс:** быстро запустить, нулевые изменения в БД.  
**Минус:** не настоящий realtime, канбан будет "дёргаться".

### Что НЕ стоит делать

- Давать Mini App `service_role_key` — утечка даст полный доступ к БД.
- Переиспользовать `swarm-mcp` как API для Mini App — у него нет верификации initData и он не предназначен для браузерных клиентов.
- Добавлять RLS без shared module — изоляция останется ненадёжной (часть запросов всё равно идёт через service_role_key в обход).

---

## 5. Что нужно сделать (не трогаем до согласования)

| Шаг | Описание | Сложность |
|---|---|---|
| Shared module | Вынести `tasks/db.ts` → `shared/tasks/db.ts`, обновить импорты | Низкая |
| `swarm-api` | Новый Edge Function: initData verify + REST CRUD | Средняя |
| RLS на tasks | Минимальная SELECT-политика по workspace JWT claim | Низкая |
| Supabase Auth bridge | Выдача workspace JWT после initData верификации | Средняя |
| swarm-mcp рефактор | Заменить `tools.ts` на импорт из shared module | Низкая |

Шаги 1 и 5 (shared module) имеет смысл делать независимо от Mini App — это технический долг, который уже есть.

---

## Открытые вопросы для обсуждения

1. **Realtime на старте или поллинг?** Поллинг проще, но хуже UX на канбане.
2. **Shared module — сейчас или вместе с Mini App?** Рефактор полезен в любом случае.
3. **`swarm-api` — новая функция или расширение `swarm-mcp`?** Логически разные назначения, рекомендую отдельную.
4. **Права в Mini App:** только свои задачи или весь workspace? Это влияет на RLS-политики.
