# Mini App — Архитектура

> Статус: **swarm-api готов** (2026-05-31). Следующий шаг — фронтенд Mini App.

---

## Реализованный стек

```
Telegram Mini App (фронтенд — следующий этап)
        │
        │  Authorization: tma <initData>
        ▼
swarm-api  (Supabase Edge Function)
        │  - верифицирует initData (Telegram HMAC)
        │  - резолвит telegram_id → group_id
        │  - REST CRUD для задач
        ▼
_shared/tasks/db.ts  (общий движок)
        │
        ▼
Supabase DB (service_role_key, фильтр по group_id)
```

Режим: **поллинг** (фронтенд запрашивает данные сам). Realtime, RLS и Supabase Auth bridge не нужны.

---

## API — контракт

**Базовый URL:** `https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-api`

**Заголовок аутентификации (обязателен на каждый запрос):**
```
Authorization: tma <Telegram initData>
```

**Эндпоинты v1:**

| Метод | Путь | Тело / Query | Ответ |
|-------|------|-------------|-------|
| `GET` | `/me` | — | `{ telegram_id, name, group_id, language }` |
| `GET` | `/users` | — | `User[]` |
| `GET` | `/tasks` | `?status=&country=&assignee=&mine=true&limit=` | `Task[]` |
| `GET` | `/tasks/:id` | — | `Task` |
| `POST` | `/tasks` | `{ title, description?, country?, task_role?, due_date?, status?, assignee_telegram_id? }` | `Task` (201) |
| `PATCH` | `/tasks/:id` | любые поля Task + `assignee_telegram_id?` | `Task` |
| `DELETE` | `/tasks/:id` | — | 204 |

**Типы из `_shared/tasks/types.ts`** — Task, TaskInput.

**Исполнитель:** фронтенд передаёт `assignee_telegram_id: number`. swarm-api резолвит его в `{ name, telegram_id }` через `user_profiles` и передаёт движку уже готовые `assignees[]` / `assignee_telegram_ids[]`.

**HTTP-коды ошибок:**
- 401 — нет заголовка / невалидный / протухший initData / пользователь не в allowed_users
- 403 — пользователь без воркспейса (group_id = null)
- 400 — плохое тело запроса
- 404 — задача не найдена или не принадлежит воркспейсу
- 500 — внутренняя ошибка

---

## Безопасность

- `group_id` берётся **только** из проверенной личности (initData → telegram_id → allowed_users). Из тела запроса не принимается.
- Каждая операция с задачами скоупится по `group_id` — пользователь не может видеть или менять задачи другого воркспейса.
- `service_role_key` только внутри swarm-api, фронтенду не передаётся.

---

## Переменные окружения

| Переменная | Обязательная | Описание |
|-----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | да | уже есть |
| `MINIAPP_ORIGIN` | рекомендуется | CORS origin Mini App (напр. `https://t.me`) |
| `INITDATA_MAX_AGE` | нет | свежесть initData в секундах (дефолт 86400) |

---

## Деплой

```bash
supabase secrets set MINIAPP_ORIGIN=https://t.me   # или нужный origin
supabase functions deploy swarm-api --no-verify-jwt
```

---

## Фронтенд Mini App — реализован (2026-06-01)

**Расположение:** `miniapp/`
**Деплой:** Cloudflare Pages — build command `npm run build`, output dir `out`
**Локальная разработка:** `cd miniapp && npm run dev` (с `NEXT_PUBLIC_DEV_MODE=true` в `.env.local`)

### Стек
- Next.js 16, `output: 'export'`, TypeScript
- Tailwind CSS v4 + shadcn/ui
- `@twa-dev/sdk` → `Telegram.WebApp.initData`
- Plain fetch + useEffect (поллинг 10 сек + visibilitychange)

### Ключевые файлы
| Файл | Назначение |
|------|-----------|
| `src/lib/api.ts` | Все запросы к swarm-api + DEV_MODE mock |
| `src/lib/telegram.ts` | getInitData, initApp |
| `src/components/KanbanBoard.tsx` | Главный компонент: табы, поллинг |
| `src/components/TaskCard.tsx` | Карточка задачи + кнопки статуса |
| `src/components/TaskModal.tsx` | Создание/редактирование задачи |

### Финальная проверка авторизации
DEV_MODE проверяет только UI/логику. Реальный `initData` и авторизацию
проверяй только открыв приложение из Telegram.
