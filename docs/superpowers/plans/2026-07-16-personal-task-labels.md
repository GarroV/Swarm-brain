# Personal Task Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю персональные смарт-метки для личных задач (метка = имя + пиктограмма; список метки авто-собирает задачи с ней) в веб-интерфейсе и через MCP, плюс пиктограммный пикер рынка.

**Architecture:** Метки хранятся в новой таблице `task_labels` (персональные, `owner_id`); членство — массивом `label_ids uuid[]` прямо на задаче (безопасно, т.к. метки только на личных задачах владельца). Общий движок `_shared/tasks` — единый DRY-чокпоинт, поверх которого тонкие обёртки: web-API (`swarm-api`) и MCP (`swarm-mcp`). Веб-UI добавляет секцию «Мои списки» в рельс и переиспользуемый `PictogramPicker` для меток и рынка.

**Tech Stack:** Supabase Postgres + Edge Functions (Deno/TypeScript), React (Next.js, каталог `miniapp/`), MCP JSON-RPC.

**Spec:** [docs/superpowers/specs/2026-07-16-personal-task-labels-design.md](../specs/2026-07-16-personal-task-labels-design.md)

## Global Constraints

- **Ветка:** только `sandbox_vas`. Коммитить мелко, пушить сразу после каждой задачи (`git push origin sandbox_vas`).
- **БД:** только безопасные операции — `CREATE TABLE`, `ADD COLUMN` с дефолтом. Никаких `DROP`/`RENAME`/`DELETE без WHERE`. Миграция кладётся и в `supabase/migrations/`, и в `supabase/schema/00_base_schema.sql`.
- **Доступ:** `SERVICE_ROLE_KEY` везде → RLS не работает. Вся проверка доступа — в коде: метки фильтруются `owner_id = telegram_id` (web) / `= requesting_user_id` (MCP); правка/удаление чужой метки → 403.
- **Метки — только на личных задачах** (`is_private = true` И `owner_id = вызывающий`). `PATCH /tasks/:id` с `label_ids` на не-личной/чужой задаче → **400** с понятным сообщением.
- **Проверка перед «готово»:** edge-функции — `deno check` (обязателен, гоняется pre-commit) + смоук реального эндпоинта; web — `npm run typecheck` + `npm run build` в `miniapp/` + ручной смоук в браузере (светлая И тёмная тема), НЕ «в Telegram».
- **Иконки меток** — только имена из набора RoyIcon: `search spark task book cal plus cleft cright filter globe clock link flag mic doc note meet team dots arrow x check home pdf pencil trash warn timeline board graph`.
- **Документация — часть DoD:** финальная задача синхронизирует `docs/ARCHITECTURE.md`, `docs/QUICK_REF.md`, `docs/BACKLOG.md`.
- **Тестирование:** у веба нет unit-раннера, edge-функции ходят в живой Supabase → строгий red-green TDD неприменим. Верификация = типчек/`deno check`/сборка + смоук реального флоу (это и есть «проверено» в Swarm). Где добавляется чистая Deno-функция — добавляем deno-тест (прецедент: `_shared/countries.test.ts`).

---

## Phase 1 — База данных

### Task 1: Миграция `task_labels` + `tasks.label_ids`

**Files:**
- Create: `supabase/migrations/20260716120000_task_labels.sql`
- Modify: `supabase/schema/00_base_schema.sql` (добавить те же объекты, чтобы проект поднимался с нуля)

**Interfaces:**
- Produces: таблица `public.task_labels(id uuid, group_id text, owner_id bigint, name text, icon text, color text, sort_order int, created_at timestamptz)`; колонка `public.tasks.label_ids uuid[] not null default '{}'`.

- [ ] **Step 1: Написать миграцию**

Создать `supabase/migrations/20260716120000_task_labels.sql`:

```sql
-- Персональные смарт-метки задач. owner_id NOT NULL = всегда чьи-то личные.
-- group_id зарезервирован под будущие общие списки (тогда owner_id станет nullable).
create table if not exists public.task_labels (
  id         uuid primary key default gen_random_uuid(),
  group_id   text references public.workspaces(id),
  owner_id   bigint not null references public.allowed_users(telegram_id),
  name       text not null,
  icon       text not null default 'tag',
  color      text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_labels_owner on public.task_labels(owner_id);

-- Членство «задача ↔ метки» массивом прямо на задаче (safe: только личные задачи владельца).
alter table public.tasks add column if not exists label_ids uuid[] not null default '{}';
create index if not exists idx_tasks_label_ids on public.tasks using gin (label_ids);
```

- [ ] **Step 2: Продублировать объекты в базовую схему**

В `supabase/schema/00_base_schema.sql`: рядом с определением `public.tasks` добавить колонку `label_ids uuid[] not null default '{}'` (в списке колонок таблицы, до закрывающей `);`), добавить `create index if not exists idx_tasks_label_ids on public.tasks using gin (label_ids);` рядом с прочими индексами `tasks`, и добавить блок `create table if not exists public.task_labels (...)` (тот же SQL, что в Step 1) после таблицы `tasks`.

- [ ] **Step 3: Применить миграцию**

Через Supabase MCP-инструмент `apply_migration` (name: `task_labels`, query: содержимое файла из Step 1) ИЛИ `supabase db push`.

- [ ] **Step 4: Проверить, что объекты созданы**

Выполнить (Supabase MCP `execute_sql` или `supabase db`):
```sql
select column_name from information_schema.columns
where table_name='tasks' and column_name='label_ids';
select to_regclass('public.task_labels') as tbl;
```
Ожидаемо: строка `label_ids` есть; `tbl` = `task_labels` (не null).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716120000_task_labels.sql supabase/schema/00_base_schema.sql
git commit -m "feat(db): таблица task_labels + tasks.label_ids для персональных смарт-меток"
git push origin sandbox_vas
```

---

## Phase 2 — Общий движок задач (`_shared/tasks`)

### Task 2: `label_ids` в типах, create/list

**Files:**
- Modify: `supabase/functions/_shared/tasks/types.ts`
- Modify: `supabase/functions/_shared/tasks/db.ts`

**Interfaces:**
- Consumes: таблица/колонка из Task 1.
- Produces:
  - `Task.label_ids: string[]`, `TaskInput.label_ids?: string[]`.
  - `createTask` вставляет `label_ids` (дефолт `[]`).
  - `listTasks(filters, groupId)` принимает `filters.labelIds?: string[]` → `overlaps("label_ids", …)`.
  - `updateTask(id, fields)` уже принимает `Partial<TaskInput>` → `label_ids` проходит без изменений.

- [ ] **Step 1: Добавить поле в типы**

В `supabase/functions/_shared/tasks/types.ts` в `type Task` добавить последней строкой перед `};`:
```ts
  label_ids: string[];
```
В `type TaskInput` добавить перед `};`:
```ts
  label_ids?: string[];
```

- [ ] **Step 2: Вставлять `label_ids` в createTask**

В `supabase/functions/_shared/tasks/db.ts` в объекте `.insert({ ... })` внутри `createTask` добавить строку рядом с `sprint_id`:
```ts
    label_ids: input.label_ids ?? [],
```

- [ ] **Step 3: Фильтр по меткам в listTasks**

В `db.ts` в типе параметра `filters` (рядом с `tags?: string[];`) добавить:
```ts
  labelIds?: string[];      // ANY-совпадение (overlaps по label_ids)
```
И в теле `listTasks`, сразу после строки с `filters.tags`, добавить:
```ts
  if (filters.labelIds && filters.labelIds.length > 0) q = q.overlaps("label_ids", filters.labelIds);
```

- [ ] **Step 4: Проверить типчек движка**

Run:
```bash
cd supabase/functions && deno check _shared/tasks/db.ts _shared/tasks/types.ts
```
Ожидаемо: без ошибок (exit 0).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/tasks/types.ts supabase/functions/_shared/tasks/db.ts
git commit -m "feat(tasks): label_ids в движке задач (create/list/типы)"
git push origin sandbox_vas
```

---

## Phase 3 — Web-API (`swarm-api`)

### Task 3: Модуль `task-labels.ts` + роутинг CRUD меток

**Files:**
- Create: `supabase/functions/swarm-api/task-labels.ts`
- Modify: `supabase/functions/swarm-api/index.ts` (импорт + диспатч)

**Interfaces:**
- Consumes: helpers `json(data,status,origin)`, `apiErr(status,msg,origin)` из `index.ts`; из хендлера доступны `supabase`, `telegram_id`, `groupId`, `origin`, `routePath`, `req`.
- Produces: `handleTaskLabelRoutes(supabase, req, routePath, telegramId, groupId, origin): Promise<Response | null>` — возвращает `Response` для путей `/task-labels*`, иначе `null` (тогда index.ts идёт дальше). Тип метки в ответе: `{ id, name, icon, color, sort_order, count }`.

- [ ] **Step 1: Написать модуль хендлера**

Создать `supabase/functions/swarm-api/task-labels.ts`:

```ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type LabelRow = { id: string; name: string; icon: string; color: string | null; sort_order: number };

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

// Роуты /task-labels и /task-labels/:id. Возвращает null, если путь не про метки.
export async function handleTaskLabelRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string | null,
  origin: string,
): Promise<Response | null> {
  // GET /task-labels — мои метки + счётчик задач в каждой
  if (routePath === "/task-labels" && req.method === "GET") {
    const { data: labels } = await supabase
      .from("task_labels")
      .select("id,name,icon,color,sort_order")
      .eq("owner_id", telegramId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const rows = (labels ?? []) as LabelRow[];
    // Счётчики: одним запросом тянем label_ids моих личных задач и считаем на месте.
    const { data: tasks } = await supabase
      .from("tasks")
      .select("label_ids")
      .eq("owner_id", telegramId)
      .eq("is_private", true);
    const counts = new Map<string, number>();
    for (const t of (tasks ?? []) as Array<{ label_ids: string[] | null }>) {
      for (const id of t.label_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return json(rows.map((r) => ({ ...r, count: counts.get(r.id) ?? 0 })), 200, origin);
  }

  // POST /task-labels { name, icon?, color? }
  if (routePath === "/task-labels" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { name?: string; icon?: string; color?: string };
    const name = (body.name ?? "").trim();
    if (!name) return json({ error: "Название метки обязательно" }, 400, origin);
    const { data, error } = await supabase
      .from("task_labels")
      .insert({ owner_id: telegramId, group_id: groupId, name, icon: body.icon ?? "tag", color: body.color ?? null })
      .select("id,name,icon,color,sort_order")
      .single();
    if (error) return json({ error: error.message }, 500, origin);
    return json({ ...(data as LabelRow), count: 0 }, 201, origin);
  }

  const m = routePath.match(/^\/task-labels\/([^/]+)$/);
  if (!m) return null;
  const labelId = m[1];

  // Проверка владения (правка/удаление — только своей метки)
  const { data: owned } = await supabase
    .from("task_labels").select("id").eq("id", labelId).eq("owner_id", telegramId).maybeSingle();
  if (!owned) return json({ error: "Метка не найдена" }, 404, origin);

  // PATCH /task-labels/:id
  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({})) as Partial<{ name: string; icon: string; color: string | null; sort_order: number }>;
    const fields: Record<string, unknown> = {};
    if (typeof body.name === "string") fields.name = body.name.trim();
    if (typeof body.icon === "string") fields.icon = body.icon;
    if ("color" in body) fields.color = body.color ?? null;
    if (typeof body.sort_order === "number") fields.sort_order = body.sort_order;
    const { data, error } = await supabase
      .from("task_labels").update(fields).eq("id", labelId).eq("owner_id", telegramId)
      .select("id,name,icon,color,sort_order").single();
    if (error) return json({ error: error.message }, 500, origin);
    return json(data, 200, origin);
  }

  // DELETE /task-labels/:id — вычистить id из моих задач, потом удалить метку
  if (req.method === "DELETE") {
    const { data: tasksWith } = await supabase
      .from("tasks").select("id,label_ids").eq("owner_id", telegramId).contains("label_ids", [labelId]);
    for (const t of (tasksWith ?? []) as Array<{ id: string; label_ids: string[] }>) {
      await supabase.from("tasks").update({ label_ids: t.label_ids.filter((x) => x !== labelId) }).eq("id", t.id);
    }
    await supabase.from("task_labels").delete().eq("id", labelId).eq("owner_id", telegramId);
    return json({ ok: true }, 200, origin);
  }

  return null;
}
```

- [ ] **Step 2: Подключить в index.ts**

В `supabase/functions/swarm-api/index.ts` добавить импорт рядом с прочими:
```ts
import { handleTaskLabelRoutes } from "./task-labels.ts";
```
Сразу перед блоком `// GET /tasks or POST /tasks` (`if (routePath === "/tasks")`) вставить диспатч:
```ts
  const labelResp = await handleTaskLabelRoutes(supabase, req, routePath, telegram_id, groupId, origin);
  if (labelResp) return labelResp;
```

- [ ] **Step 3: Проверить типчек**

Run:
```bash
cd supabase/functions && deno check swarm-api/index.ts swarm-api/task-labels.ts
```
Ожидаемо: без ошибок.

- [ ] **Step 4: Задеплоить и смоук**

```bash
supabase functions deploy swarm-api --no-verify-jwt
```
Затем смоук с валидной web-сессией/cookie (или через браузерную сессию из веба на следующих фазах). Быстрая проверка логов:
Supabase MCP `get_logs` (service: edge-functions) — нет 500 на `/task-labels`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-api/task-labels.ts supabase/functions/swarm-api/index.ts
git commit -m "feat(swarm-api): CRUD персональных меток /task-labels"
git push origin sandbox_vas
```

### Task 4: `label_ids` в `PATCH /tasks/:id` (только личные задачи)

**Files:**
- Modify: `supabase/functions/swarm-api/index.ts` (обработчик `PATCH /tasks/:id`, район строк 570–650)

**Interfaces:**
- Consumes: `getTask`/`updateTask` из `_shared/tasks/db.ts`; `telegram_id`, `origin`.
- Produces: `PATCH /tasks/:id` принимает `body.label_ids: string[]` и применяет его только если задача личная и принадлежит вызывающему, и все id — метки вызывающего; иначе 400.

- [ ] **Step 1: Добавить обработку label_ids в PATCH**

В `index.ts` в блоке `PATCH /tasks/:id` (где формируется `fields`), после существующих присваиваний `fields.*`, добавить:
```ts
      if (Array.isArray(body.label_ids)) {
        const isOwnPrivate = task.is_private === true && task.owner_id === telegram_id;
        if (!isOwnPrivate) return apiErr(400, "Метки доступны только на личных задачах", origin);
        const ids = (body.label_ids as unknown[]).filter((x): x is string => typeof x === "string");
        if (ids.length > 0) {
          const { data: mine } = await supabase
            .from("task_labels").select("id").eq("owner_id", telegram_id).in("id", ids);
          const valid = new Set(((mine ?? []) as Array<{ id: string }>).map((r) => r.id));
          if (ids.some((id) => !valid.has(id))) return apiErr(400, "Неизвестная метка", origin);
        }
        fields.label_ids = ids;
      }
```
(Здесь `task` — уже загруженная в этом обработчике задача — то же имя, что в соседней строке `fields.owner_id = body.is_private ? (task.owner_id ?? telegram_id) : null;`; `body` — распарсенное тело запроса; `apiErr(status,msg,origin)` — существующий хелпер.)

- [ ] **Step 2: Типчек**

Run:
```bash
cd supabase/functions && deno check swarm-api/index.ts
```
Ожидаемо: без ошибок.

- [ ] **Step 3: Задеплоить**

```bash
supabase functions deploy swarm-api --no-verify-jwt
```

- [ ] **Step 4: Смоук через веб-сессию (после Phase 5) / логи**

Проверить, что `GET /tasks` отдаёт `label_ids` (select * → поле присутствует), а `PATCH /tasks/:id {label_ids}` на чужой/не-личной задаче даёт 400 (`get_logs`). Полный e2e — на Phase 5 из браузера.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(swarm-api): label_ids в PATCH /tasks/:id (только личные задачи)"
git push origin sandbox_vas
```

---

## Phase 4 — MCP (`swarm-mcp`)

### Task 5: Метки в MCP-тулзах

**Files:**
- Modify: `supabase/functions/swarm-mcp/tasks/tools.ts`
- Modify: `supabase/functions/swarm-mcp/index.ts` (диспатч + список тулз)

**Interfaces:**
- Consumes: `createTask`/`updateTask`/`getTask` из движка; локальные `supabase`, `resolveGroupId` в `tools.ts`.
- Produces:
  - `resolveLabelIds(ownerId, names, createMissing): Promise<string[]>` — имена → id личных меток владельца (авто-создание недостающих).
  - `toolListTaskLabels({ requesting_user_id }): Promise<string>`.
  - `toolAddTask`/`toolUpdateTask` принимают `labels?: string[]`; проставление меток делает задачу личной (`is_private:true, owner_id`).
  - `toolGetTasks` принимает `label?: string` (фильтр по имени).
  - `LABEL_TOOL_DEFINITIONS` (для `list_task_labels`) + `labels`/`label` в существующих def.

- [ ] **Step 1: Хелпер резолва меток**

В `supabase/functions/swarm-mcp/tasks/tools.ts` добавить после `resolveGroupId`:
```ts
// Имена меток → id личных меток владельца. createMissing=true — недостающие авто-создаются.
async function resolveLabelIds(ownerId: number, names: string[], createMissing: boolean): Promise<string[]> {
  const { data: existing } = await supabase
    .from("task_labels").select("id,name").eq("owner_id", ownerId);
  const byName = new Map<string, string>();
  for (const r of (existing ?? []) as Array<{ id: string; name: string }>) byName.set(r.name.toLowerCase(), r.id);
  const groupId = await resolveGroupId(ownerId);
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const hit = byName.get(name.toLowerCase());
    if (hit) { ids.push(hit); continue; }
    if (!createMissing) continue;
    const { data } = await supabase
      .from("task_labels").insert({ owner_id: ownerId, group_id: groupId, name, icon: "tag" })
      .select("id").single();
    if (data) { const id = (data as { id: string }).id; byName.set(name.toLowerCase(), id); ids.push(id); }
  }
  return ids;
}

export async function toolListTaskLabels(args: { requesting_user_id: number }): Promise<string> {
  const { data } = await supabase
    .from("task_labels").select("id,name").eq("owner_id", args.requesting_user_id).order("sort_order");
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  if (!rows.length) return "У тебя пока нет меток.";
  return rows.map((r) => `• ${r.name} (id: ${r.id})`).join("\n");
}
```

- [ ] **Step 2: `labels` в toolAddTask**

В `toolAddTask` расширить тип `args` полем `labels?: string[];`. Перед вызовом `createTask` добавить:
```ts
  const labelIds = args.labels?.length ? await resolveLabelIds(args.requesting_user_id ?? 0, args.labels, true) : [];
```
В объект `createTask({ ... })` добавить (метка ⇒ личная задача):
```ts
      label_ids: labelIds,
      is_private: labelIds.length > 0 ? true : undefined,
      owner_id: labelIds.length > 0 ? (args.requesting_user_id ?? null) : undefined,
```

- [ ] **Step 3: `labels` в toolUpdateTask**

В `toolUpdateTask` расширить `args` полем `labels?: string[];`. После загрузки `task` и проверки доступа, перед `updateTask`, добавить:
```ts
  if (args.labels !== undefined) {
    if (!(task.is_private && task.owner_id === args.requesting_user_id)) {
      return "Метки доступны только на твоих личных задачах.";
    }
    fields.label_ids = await resolveLabelIds(args.requesting_user_id, args.labels, true);
  }
```

- [ ] **Step 4: `label` в toolGetTasks**

В `toolGetTasks` расширить `args` полем `label?: string;`. Перед `listTasks(...)` добавить резолв и прокинуть фильтр:
```ts
  const labelIds = args.label ? await resolveLabelIds(args.requesting_user_id, [args.label], false) : [];
```
В объект фильтра `listTasks({ ... })` добавить:
```ts
    labelIds: labelIds.length ? labelIds : undefined,
    viewerId: args.requesting_user_id,
```

- [ ] **Step 5: Определения тулз**

В `tools.ts` в конце добавить экспорт и включить новые поля в существующие def. Добавить `labels` в `properties` у `add_task` и `update_task`:
```ts
        labels: { type: "array", items: { type: "string" }, description: "Имена личных смарт-меток (папок). Задача с метками становится личной." },
```
Добавить `label` в `properties` у `get_tasks`… (get_tasks def в index.ts, см. Step 6). И добавить:
```ts
export const LABEL_TOOL_DEFINITIONS = [
  {
    name: "list_task_labels",
    description: "Показать твои личные смарт-метки (папки) задач: имя + id.",
    inputSchema: {
      type: "object",
      properties: { requesting_user_id: { type: "number", description: "Твой Telegram user ID" } },
      required: ["requesting_user_id"],
    },
  },
];
```

- [ ] **Step 6: Диспатч и регистрация в index.ts**

В `supabase/functions/swarm-mcp/index.ts`:
- В импорт из `./tasks/tools.ts` добавить `toolListTaskLabels, LABEL_TOOL_DEFINITIONS`.
- В массив `TOOLS` рядом с `...TASK_TOOL_DEFINITIONS` добавить `...LABEL_TOOL_DEFINITIONS`.
- В def тула `get_tasks` (в этом файле) добавить в `properties`: `label: { type: "string", description: "Имя смарт-метки для фильтра" }`.
- В обновлённых кастах `args` для `add_task`/`update_task`/`get_tasks` добавить соответствующие поля (`labels?: string[]` / `label?: string`).
- В цепочку `if (name === ...)` добавить ветку:
```ts
      } else if (name === "list_task_labels") {
        result = await toolListTaskLabels(args as { requesting_user_id: number });
```

- [ ] **Step 7: Типчек**

Run:
```bash
cd supabase/functions && deno check swarm-mcp/index.ts swarm-mcp/tasks/tools.ts
```
Ожидаемо: без ошибок.

- [ ] **Step 8: Задеплоить + смоук**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
```
Смоук: из Claude вызвать `list_task_labels`, затем `add_task` с `labels:["Айти"]`, затем `get_tasks label:"Айти"` — задача возвращается. Проверить `get_logs` на отсутствие ошибок.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/swarm-mcp/tasks/tools.ts supabase/functions/swarm-mcp/index.ts
git commit -m "feat(swarm-mcp): смарт-метки — list_task_labels, labels в add/update, label-фильтр"
git push origin sandbox_vas
```

---

## Phase 5 — Веб-интерфейс (`miniapp/`)

### Task 6: Типы и API-клиент меток

**Files:**
- Modify: `miniapp/src/types.ts`
- Modify: `miniapp/src/lib/api.ts`

**Interfaces:**
- Produces:
  - `Task.label_ids: string[]` (в `miniapp/src/types.ts`).
  - `type TaskLabel = { id: string; name: string; icon: string; color: string | null; sort_order: number; count: number }`.
  - `fetchTaskLabels(): Promise<TaskLabel[]>`, `createTaskLabel(input): Promise<TaskLabel>`, `updateTaskLabel(id, fields): Promise<TaskLabel>`, `deleteTaskLabel(id): Promise<void>`.
  - `CreateTaskInput`/`UpdateTaskInput` получают `label_ids?: string[]`; `TaskFilters` получает `label_id?: string`.

- [ ] **Step 1: Поле в Task**

В `miniapp/src/types.ts` в `export type Task` добавить перед `};`:
```ts
  label_ids: string[];
```

- [ ] **Step 2: Тип TaskLabel и CRUD в api.ts**

В `miniapp/src/lib/api.ts`:
- В `CreateTaskInput` добавить `label_ids?: string[];` (в теле типа).
- В `TaskFilters` добавить `label_id?: string;`.
- В функции `fetchTasks` в блоке DEV_MODE добавить фильтр `if (f.label_id) r = r.filter((t) => t.label_ids?.includes(f.label_id!));`, а в сборке `params` — `if (f.label_id) params.set("label_id", f.label_id);` (примечание: серверная фильтрация задач по метке для веба опциональна — рельс фильтрует на клиенте; параметр оставляем для симметрии/будущего).
- Добавить блок функций (рядом с задачными):
```ts
export type TaskLabel = { id: string; name: string; icon: string; color: string | null; sort_order: number; count: number };

const MOCK_LABELS: TaskLabel[] = [
  { id: "l-it", name: "Айти", icon: "task", color: null, sort_order: 0, count: 0 },
];

export async function fetchTaskLabels(): Promise<TaskLabel[]> {
  if (DEV_MODE) return MOCK_LABELS;
  return apiFetch<TaskLabel[]>("/task-labels");
}

export async function createTaskLabel(input: { name: string; icon?: string; color?: string | null }): Promise<TaskLabel> {
  if (DEV_MODE) { const l = { id: `l-${Date.now()}`, name: input.name, icon: input.icon ?? "tag", color: input.color ?? null, sort_order: MOCK_LABELS.length, count: 0 }; MOCK_LABELS.push(l); return l; }
  return apiFetch<TaskLabel>("/task-labels", { method: "POST", body: JSON.stringify(input) });
}

export async function updateTaskLabel(id: string, fields: Partial<{ name: string; icon: string; color: string | null; sort_order: number }>): Promise<TaskLabel> {
  if (DEV_MODE) { const l = MOCK_LABELS.find((x) => x.id === id)!; Object.assign(l, fields); return l; }
  return apiFetch<TaskLabel>(`/task-labels/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteTaskLabel(id: string): Promise<void> {
  if (DEV_MODE) { const i = MOCK_LABELS.findIndex((x) => x.id === id); if (i >= 0) MOCK_LABELS.splice(i, 1); return; }
  await apiFetch<void>(`/task-labels/${id}`, { method: "DELETE" });
}
```
- В DEV_MODE-объекте `createTask` (mockTasks.push) и в mock-задачах убедиться, что у Task есть `label_ids: input.label_ids ?? []` — добавить это поле в создаваемый mock-объект и в существующие моки, чтобы тип совпадал.

- [ ] **Step 3: Типчек**

Run:
```bash
cd miniapp && npm run typecheck
```
Ожидаемо: без ошибок (может потребоваться добавить `label_ids: []` во все mock-Task — исправить, пока зелено).

- [ ] **Step 4: Commit**

```bash
git add miniapp/src/types.ts miniapp/src/lib/api.ts
git commit -m "feat(web): типы и API-клиент персональных меток"
git push origin sandbox_vas
```

### Task 7: Чистая логика фильтра/счётчиков по метке

**Files:**
- Modify: `miniapp/src/lib/smartLists.ts`

**Interfaces:**
- Produces:
  - `filterByLabel(tasks: Task[], labelId: string): Task[]` — незавершённые задачи с меткой, отсортированные `chain(byDueAsc, byPriorityDesc, byCreatedDesc)`.
  - `countByLabel(tasks: Task[], labelId: string): number`.
  - Активный фильтр рельса моделируется в компоненте состоянием `activeLabelId: string | null` (см. Task 9), отдельного union-типа не вводим.

- [ ] **Step 1: Добавить чистые функции**

В `miniapp/src/lib/smartLists.ts` добавить в конец:
```ts
// Незавершённые задачи с меткой (папка авто-собирает их). Сортировка как у today/upcoming/all.
export function filterByLabel(tasks: Task[], labelId: string, now: Date = new Date()): Task[] {
  void now;
  return tasks
    .filter((t) => !isDone(t) && (t.label_ids?.includes(labelId) ?? false))
    .sort(chain(byDueAsc, byPriorityDesc, byCreatedDesc));
}

export function countByLabel(tasks: Task[], labelId: string): number {
  return tasks.filter((t) => !isDone(t) && (t.label_ids?.includes(labelId) ?? false)).length;
}
```

- [ ] **Step 2: Типчек**

Run:
```bash
cd miniapp && npm run typecheck
```
Ожидаемо: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add miniapp/src/lib/smartLists.ts
git commit -m "feat(web): чистый фильтр/счётчик задач по метке"
git push origin sandbox_vas
```

### Task 8: Компонент `PictogramPicker`

**Files:**
- Create: `miniapp/src/components/tasks/PictogramPicker.tsx`

**Interfaces:**
- Consumes: `RoyIcon`, `RoyIconName`; портал-механику копируем из `QuickPickPopover.tsx`.
- Produces: компонент `PictogramPicker` с props:
  - `triggerIcon: RoyIconName`, `ariaLabel: string`.
  - `options: { id: string; label: string; icon?: RoyIconName; flag?: string }[]`.
  - `selected: string[]` (для single — массив 0/1).
  - `multi: boolean`.
  - `onToggle: (id: string) => void`.
  - опц. `footer?: ReactNode` (кнопка «Новый список»).

- [ ] **Step 1: Добавить иконку `tag` в набор RoyIcon**

В `miniapp/src/components/roy/icons.tsx` в объект `ROY_ICON_PATHS` добавить строку (viewBox 20×20, stroke-based, круглые концы; `h.01` = точка-отверстие тега):
```ts
  tag: "M4 4h6l6 6-6 6-6-6V4z M6.5 6.5h.01",
```
Дефолт иконки метки в БД/MCP = `tag`, поэтому иконка обязана существовать до рендера веба. `tag` теперь валидное значение `RoyIconName`.

- [ ] **Step 2: Написать компонент**

Создать `miniapp/src/components/tasks/PictogramPicker.tsx`:

```tsx
"use client";
// Пиктограммный пикер: иконка-триггер + портал с сеткой пиктограмм (метки/флаги), тап = вкл/выкл.
// Портал-механика (fixed по триггеру, флип у края, клик-вне, Escape, репозиция) — как в QuickPickPopover.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";

export type PictoOption = { id: string; label: string; icon?: RoyIconName; flag?: string };

type Props = {
  triggerIcon: RoyIconName;
  ariaLabel: string;
  options: PictoOption[];
  selected: string[];
  multi: boolean;
  onToggle: (id: string) => void;
  footer?: ReactNode;
};

const W = 248, H = 320;

export function PictogramPicker({ triggerIcon, ariaLabel, options, selected, multi, onToggle, footer }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const has = (id: string) => selected.includes(id);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - W - 8);
    const below = r.bottom + 6;
    const top = below + H > window.innerHeight - 8 && r.top > H ? r.top - H - 6 : below;
    setPos({ left: Math.max(8, left), top });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const pick = (id: string) => { onToggle(id); if (!multi) setOpen(false); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        style={{ width: 26, height: 26, color: selected.length ? "var(--accent-ink)" : "var(--ink-soft)" }}
      >
        <RoyIcon name={triggerIcon} size={15} strokeWidth={1.9} />
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, maxHeight: H }}
          className="z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 ${has(o.id) ? "text-accent-ink" : "text-ink"}`}
                style={{ fontSize: 13 }}
              >
                <span className="flex size-[18px] shrink-0 items-center justify-center">
                  {o.flag ? <span style={{ fontSize: 15 }}>{o.flag}</span> : o.icon ? <RoyIcon name={o.icon} size={15} strokeWidth={1.9} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {has(o.id) && <RoyIcon name="check" size={14} strokeWidth={2.2} className="shrink-0" />}
              </button>
            ))}
            {options.length === 0 && (
              <div className="px-2.5 py-3 text-center text-ink-mute" style={{ fontSize: 12 }}>Пусто</div>
            )}
          </div>
          {footer && <div className="shrink-0 border-t border-line p-1">{footer}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
```

- [ ] **Step 3: Типчек**

Run:
```bash
cd miniapp && npm run typecheck
```
Ожидаемо: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add miniapp/src/components/roy/icons.tsx miniapp/src/components/tasks/PictogramPicker.tsx
git commit -m "feat(web): иконка tag + переиспользуемый PictogramPicker (метки/флаги)"
git push origin sandbox_vas
```

### Task 9: Рельс «Мои списки» + активный фильтр по метке

**Files:**
- Modify: `miniapp/src/components/tasks/useReminderTasks.ts`
- Modify: `miniapp/src/components/tasks/SmartListNav.tsx`
- Modify: `miniapp/src/components/tasks/RemindersTasks.tsx`

**Interfaces:**
- Consumes: `fetchTaskLabels`, `TaskLabel` из api; `filterByLabel`, `countByLabel`, `ActiveFilter` из smartLists.
- Produces:
  - В хуке: `labels: TaskLabel[]`, `activeFilter: ActiveFilter`, `setActiveFilter`, `activeLabelId: string | null`; `visible` учитывает активную метку; `reloadLabels()`.
  - `SmartListNav` (rail) получает пропсы `labels`, `activeLabelId`, `onSelectLabel(id)`, `onCreateLabel()`.

- [ ] **Step 1: Хук — грузим метки и держим активный фильтр**

В `useReminderTasks.ts`:
- Импорт: `import { fetchTaskLabels, type TaskLabel } from "@/lib/api";` и `filterByLabel, countByLabel` из `@/lib/smartLists`.
- Добавить состояние:
```ts
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
```
- В `load` после `Promise.all` добавить загрузку меток:
```ts
      fetchTaskLabels().then(setLabels).catch(() => {});
```
- Активная метка «перебивает» смарт-список для `visible`. После вычисления `visible` добавить:
```ts
  const labelCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of labels) m[l.id] = countByLabel(list, l.id);
    return m;
  }, [labels, list]);
  const visibleByLabel = useMemo(
    () => (activeLabelId ? filterByLabel(list, activeLabelId).filter(matchesQuery) : []),
    [activeLabelId, list, matchesQuery],
  );
```
- В возвращаемом объекте добавить: `labels, activeLabelId, setActiveLabelId, labelCounts, visibleByLabel, reloadLabels: () => fetchTaskLabels().then(setLabels).catch(() => {})`.
- При выборе метки сбрасываем смарт-группировку: логику «если activeLabelId != null — показываем visibleByLabel» реализуем в компоненте (Step 3).

- [ ] **Step 2: SmartListNav — секция «Мои списки»**

В `SmartListNav.tsx` расширить `SmartListNavProps` (только для `variant "rail"`):
```ts
  labels?: { id: string; name: string; icon: string }[];
  labelCounts?: Record<string, number>;
  activeLabelId?: string | null;
  onSelectLabel?: (id: string) => void;
  onCreateLabel?: () => void;
```
В rail-разметке, после блока смарт-списков и перед админским `onAllStaff`, добавить:
```tsx
      {labels && labels.length >= 0 && onSelectLabel && (
        <>
          <div className="my-1.5 border-t border-line" />
          <div className="px-2.5 pb-1 font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Мои списки</div>
          {labels.map((l) => {
            const on = activeLabelId === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onSelectLabel(l.id)}
                className={cn("flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold transition-colors",
                  on ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-surface")}
                style={{ fontSize: 13.5 }}
              >
                <RoyIcon name={(l.icon as RoyIconName) || "tag"} size={16} strokeWidth={on ? 2.1 : 1.8} />
                <span className="flex-1 text-left">{l.name}</span>
                {(labelCounts?.[l.id] ?? 0) > 0 && (
                  <span className={`font-mono ${on ? "text-accent-ink" : "text-ink-mute"}`} style={{ fontSize: 11.5 }}>{labelCounts![l.id]}</span>
                )}
              </button>
            );
          })}
          {onCreateLabel && (
            <button type="button" onClick={onCreateLabel}
              className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface" style={{ fontSize: 13.5 }}>
              <RoyIcon name="plus" size={16} strokeWidth={2} />
              <span className="flex-1 text-left">Новый список</span>
            </button>
          )}
        </>
      )}
```
Добавить импорт типа: `import { SMART_LISTS, type SmartListId } from "@/lib/smartLists";` уже есть — добавить `import { RoyIcon, type RoyIconName } from "@/components/roy/icons";` (RoyIcon уже импортируется; добавить `type RoyIconName`). Обёртки RoyIcon в rail-кнопках смарт-списков не трогаем.

- [ ] **Step 3: RemindersTasks — прокинуть метки и переключить рендер**

В `RemindersTasks.tsx`:
- В деструктуризацию `const r = useReminderTasks();` уже используется через `r.*` — добавить использование `r.labels`, `r.activeLabelId`, `r.setActiveLabelId`, `r.labelCounts`, `r.visibleByLabel`, `r.reloadLabels`.
- В `<SmartListNav variant="rail" ... />` добавить пропсы:
```tsx
        labels={r.labels}
        labelCounts={r.labelCounts}
        activeLabelId={r.activeLabelId}
        onSelectLabel={(id) => { r.setActiveLabelId(id); }}
        onCreateLabel={() => setLabelEditor("new")}
```
- При выборе смарт-списка сбрасывать метку: в `onSelect={r.setActiveList}` заменить на `onSelect={(id) => { r.setActiveLabelId(null); r.setActiveList(id); }}`.
- Заголовок и список задач: если `r.activeLabelId` — показывать имя метки и `r.visibleByLabel` вместо `activeDef.label`/`r.visible`. Ввести:
```tsx
  const activeLabel = r.labels.find((l) => l.id === r.activeLabelId) ?? null;
  const headerTitle = activeLabel ? activeLabel.name : activeDef.label;
  const rows = activeLabel ? r.visibleByLabel : (grouped ? [] : r.visible);
  const rowsTotal = activeLabel ? r.visibleByLabel.length : total;
```
и использовать `headerTitle`/`rows`/`rowsTotal` в разметке (в `<h1>`, счётчике, и в блоке `!r.loading && !grouped && rows.map(renderRow)` → заменить `r.visible` на `rows`; при активной метке `grouped` считать false). Инлайн-добавление в активной метке создаёт задачу и сразу вешает метку — в `submitDraft`/`quickAdd` добавить опциональный `labelId` (см. Step 4).
- Добавить состояние редактора метки: `const [labelEditor, setLabelEditor] = useState<TaskLabel | "new" | null>(null);` и отрисовать `<LabelEditor .../>` (Task 10).

- [ ] **Step 4: quickAdd с меткой (личная задача)**

В `useReminderTasks.ts` в `quickAdd` при активной метке создаём личную задачу и вешаем метку. Расширить сигнатуру: `quickAdd(title, labelId?)`. После `createTask(input)` (когда `labelId`) — задача создаётся; чтобы повесить метку, `createTask` в вебе не принимает label_ids на не-личную задачу → делаем задачу личной: в `input` добавить `is_private: true` при `labelId`, а метку проставить вторым шагом через `updateTask(created.id, { label_ids: [labelId] })`. Реализация:
```ts
  const quickAdd = useCallback(async (title: string, labelId?: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const input: CreateTaskInput = { title: trimmed };
    if (me) input.assignee_telegram_id = me.telegram_id;
    if (activeList === "today" && !labelId) input.due_date = todayISO(new Date());
    if (labelId) input.is_private = true;
    try {
      const created = await createTask(input);
      if (labelId) await updateTask(created.id, { label_ids: [labelId] });
    } finally { load(); }
  }, [me, activeList, load]);
```
(добавить импорт `type CreateTaskInput` из `@/lib/api`.) В `RemindersTasks.tsx` `submitDraft` при активной метке звать `r.quickAdd(v, r.activeLabelId ?? undefined)`.

- [ ] **Step 5: Типчек + сборка + смоук**

Run:
```bash
cd miniapp && npm run typecheck && npm run build
```
Ожидаемо: сборка успешна. Затем ручной смоук:
```bash
cd miniapp && NEXT_PUBLIC_DEV_MODE=true PORT=3999 npm run dev
```
Открыть `http://localhost:3999` → экран задач: видна секция «Мои списки» с меткой «Айти», клик фильтрует, «Новый список» открывает редактор. Проверить светлую и тёмную тему.

- [ ] **Step 6: Commit**

```bash
git add miniapp/src/components/tasks/useReminderTasks.ts miniapp/src/components/tasks/SmartListNav.tsx miniapp/src/components/tasks/RemindersTasks.tsx
git commit -m "feat(web): секция «Мои списки» в рельсе + фильтр по метке"
git push origin sandbox_vas
```

### Task 10: Редактор метки + пикер меток на задаче

**Files:**
- Create: `miniapp/src/components/tasks/LabelEditor.tsx`
- Modify: `miniapp/src/components/tasks/TaskQuickActions.tsx`
- Modify: `miniapp/src/components/TaskModal.tsx`

**Interfaces:**
- Consumes: `createTaskLabel`/`updateTaskLabel`/`deleteTaskLabel`, `TaskLabel`; `PictogramPicker`; `updateTask`.
- Produces:
  - `LabelEditor({ label, open, onClose, onSaved })` — модалка создания/правки метки (имя + выбор иконки из curated-набора + удаление).
  - В `TaskQuickActions` — `PictogramPicker` для меток (мультивыбор), доступен только для личных задач владельца.
  - `TaskModal` — блок меток в карточке.

- [ ] **Step 1: LabelEditor**

Создать `miniapp/src/components/tasks/LabelEditor.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { createTaskLabel, updateTaskLabel, deleteTaskLabel, type TaskLabel } from "@/lib/api";

// Curated-набор иконок для меток (из доступных RoyIcon).
const LABEL_ICONS: RoyIconName[] = ["tag", "task", "book", "flag", "note", "spark", "globe", "cal", "doc", "meet", "link", "home"];

type Props = { label: TaskLabel | "new"; open: boolean; onClose: () => void; onSaved: () => void };

export function LabelEditor({ label, open, onClose, onSaved }: Props) {
  const editing = label !== "new" ? label : null;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<RoyIconName>("tag");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setIcon(((editing?.icon as RoyIconName) || "tag"));
  }, [open, editing]);

  if (!open) return null;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (editing) await updateTaskLabel(editing.id, { name: name.trim(), icon });
      else await createTaskLabel({ name: name.trim(), icon });
      onSaved(); onClose();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try { await deleteTaskLabel(editing.id); onSaved(); onClose(); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-[360px] rounded-2xl border border-line bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-bold text-accent-ink" style={{ fontSize: 16 }}>{editing ? "Список" : "Новый список"}</h2>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="Название (напр. Айти)"
          className="mb-3 w-full rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-ink outline-none placeholder:text-ink-mute"
          style={{ fontSize: 14 }}
        />
        <div className="mb-4 grid grid-cols-6 gap-1.5">
          {LABEL_ICONS.map((n) => (
            <button key={n} type="button" onClick={() => setIcon(n)}
              className={`flex aspect-square items-center justify-center rounded-[9px] border transition-colors ${icon === n ? "border-primary bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"}`}>
              <RoyIcon name={n} size={16} strokeWidth={1.9} />
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          {editing ? (
            <button type="button" onClick={remove} className="text-destructive" style={{ fontSize: 13 }}>Удалить</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-3.5 py-1.5 text-ink-soft" style={{ fontSize: 13 }}>Отмена</button>
            <button type="button" onClick={save} disabled={!name.trim() || busy}
              className="rounded-full bg-primary px-3.5 py-1.5 font-semibold text-white disabled:opacity-50" style={{ fontSize: 13 }}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```
Отрисовать его в `RemindersTasks.tsx` (Task 9 Step 3): `{labelEditor && <LabelEditor label={labelEditor} open onClose={() => setLabelEditor(null)} onSaved={r.reloadLabels} />}`.

- [ ] **Step 2: Пикер меток в TaskQuickActions**

В `TaskQuickActions.tsx`:
- Добавить в пропсы `labels: TaskLabel[]` и прокинуть их из `RemindersTasks` (там уже грузятся `r.labels`; передать `<TaskQuickActions ... labels={r.labels} />`).
- Импорт: `PictogramPicker`, `TaskLabel`.
- Показывать пикер меток только для личной задачи владельца: `const canLabel = task.is_private && task.owner_id === /* me */;` — `me` пробросить пропсом или получить из уже загруженного контекста; проще пробросить `myId?: number` из `RemindersTasks` (`r.me?.telegram_id`).
- Разметка (перед закрывающим `</>`), когда `canLabel && labels.length`:
```tsx
      <PictogramPicker
        triggerIcon="tag"
        ariaLabel="Списки"
        multi
        options={labels.map((l) => ({ id: l.id, label: l.name, icon: (l.icon as RoyIconName) || "tag" }))}
        selected={task.label_ids ?? []}
        onToggle={(id) => {
          const cur = task.label_ids ?? [];
          const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
          commit({ label_ids: next });
        }}
      />
```
(Тип `UpdateTaskInput` должен допускать `label_ids` — добавлен в Task 6. `RoyIconName` импортировать.)

Примечание: иконка `tag` добавлена в Task 8 Step 1, поэтому `triggerIcon="tag"` и дефолт `|| "tag"` валидны.

- [ ] **Step 3: Метки в TaskModal**

В `TaskModal.tsx` добавить компактный блок «Списки» (виден только для личной задачи владельца): грузить `fetchTaskLabels()` (или принять пропсом), рендерить те же `PictogramPicker`/чипы и при изменении звать `updateTask(task.id, { label_ids })`. Разметку встроить рядом с полями страны/исполнителя карточки, следуя её текущему стилю (посмотреть существующие поля в файле и повторить паттерн).

- [ ] **Step 4: Типчек + сборка + смоук**

Run:
```bash
cd miniapp && npm run typecheck && npm run build
```
Ожидаемо: успешно. Смоук в DEV_MODE: создать список, повесить на задачу через пикер в строке и в карточке, снять; проверить, что задача появляется/исчезает в списке метки. Светлая и тёмная тема.

- [ ] **Step 5: Commit**

```bash
git add miniapp/src/components/tasks/LabelEditor.tsx miniapp/src/components/tasks/TaskQuickActions.tsx miniapp/src/components/TaskModal.tsx miniapp/src/components/tasks/RemindersTasks.tsx
git commit -m "feat(web): редактор списка + пикер меток на задаче"
git push origin sandbox_vas
```

---

## Phase 6 — Пиктограммный пикер рынка (независимая фаза)

### Task 11: `countryFlag` + пикер флагов вместо country-QuickPickPopover

**Files:**
- Modify: `miniapp/src/lib/countries.ts`
- Modify: `miniapp/src/components/tasks/TaskQuickActions.tsx`
- Modify: `miniapp/src/components/TaskModal.tsx` (если там свой country-пикер)

**Interfaces:**
- Produces: `countryFlag(code: string): string` — эмодзи-флаг из ISO alpha-2 (`countryCode` уже нормализует вход), фолбэк — пустая строка.

- [ ] **Step 1: countryFlag**

В `miniapp/src/lib/countries.ts` добавить:
```ts
// Эмодзи-флаг из ISO alpha-2 (регионально-индикаторные символы). Незнакомый код → "".
export function countryFlag(value: string): string {
  const code = countryCode(value).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 65, A + code.charCodeAt(1) - 65);
}
```

- [ ] **Step 2: Заменить country-пикер на флаги**

В `TaskQuickActions.tsx` заменить `<QuickPickPopover icon="globe" ... />` для страны на `PictogramPicker` (single):
```tsx
      <PictogramPicker
        triggerIcon="globe"
        ariaLabel="Рынок"
        multi={false}
        options={[
          { id: "", label: "Global", icon: "globe" },
          ...countryOpts.map((o) => ({ id: o.id, label: o.sub ?? o.id, flag: countryFlag(o.id) })),
        ]}
        selected={task.country ? [task.country] : [""]}
        onToggle={(code) => commit({ country: code || null })}
      />
```
(Импортировать `countryFlag`. `countryOpts` уже строится в файле. «Global» с `id:""` = снять рынок.)

- [ ] **Step 3: Типчек + сборка + смоук**

Run:
```bash
cd miniapp && npm run typecheck && npm run build
```
Смоук: тап по флагу ставит рынок, «Global» снимает; проверить, что линза «По рынкам» и группировка не сломались (значение `country` то же). Светлая/тёмная тема.

- [ ] **Step 4: Commit**

```bash
git add miniapp/src/lib/countries.ts miniapp/src/components/tasks/TaskQuickActions.tsx miniapp/src/components/TaskModal.tsx
git commit -m "feat(web): пиктограммный пикер рынка (флаги + Global)"
git push origin sandbox_vas
```

---

## Phase 7 — Документация (Definition of Done)

### Task 12: Синхронизировать доки

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/QUICK_REF.md`
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: ARCHITECTURE — таблицы, эндпоинты, MCP**

В `docs/ARCHITECTURE.md`:
- В инвентарь «Таблицы БД» добавить `task_labels` (персональные метки; колонки) и колонку `tasks.label_ids uuid[]`.
- В инвентарь эндпоинтов swarm-api добавить `GET/POST /task-labels`, `PATCH/DELETE /task-labels/:id`, и отметить, что `PATCH /tasks/:id` принимает `label_ids` (только личные задачи).
- В инвентарь MCP-тулз добавить `list_task_labels` и параметры `labels`/`label`.
Сверять с кодом (`./scripts/doc-inventory.sh endpoints`, `... tables`), не по памяти.

- [ ] **Step 2: QUICK_REF — навигация**

В `docs/QUICK_REF.md` в навигационный индекс (раздел «Задачи») добавить строку: смарт-метки — `swarm-api/task-labels.ts`, `_shared/tasks` (`label_ids`), веб `miniapp/src/components/tasks/{PictogramPicker,LabelEditor}.tsx`, `lib/smartLists.ts` (`filterByLabel`).

- [ ] **Step 3: BACKLOG — отметить/завести**

В `docs/BACKLOG.md`: отметить сделанным «персональные смарт-метки задач (веб + MCP)»; завести отложенное: (1) метки на командных/общих задачах, (2) общие списки на воркспейс, (3) метки в Telegram-боте.

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/QUICK_REF.md docs/BACKLOG.md
git commit -m "docs: смарт-метки задач — таблицы, эндпоинты, MCP, навигация, беклог"
git push origin sandbox_vas
```

---

## Итоговый смоук (после всех фаз)

Реальный e2e из браузера на проде (после деплоя swarm-api/swarm-mcp и авто-сборки Cloudflare Pages):
1. Веб → создать список «Айти» (иконка). Появился в рельсе.
2. Создать личную задачу, повесить «Айти» через пикер в строке → задача в списке «Айти».
3. Снять метку в карточке → исчезла из списка.
4. Удалить список → задача цела, метка снята.
5. Тап по флагу рынка / «Global» → `country` меняется, линза «По рынкам» работает.
6. MCP из Claude: `list_task_labels` → «Айти»; `add_task labels:["Айти"]`; `get_tasks label:"Айти"` возвращает задачу.
7. Негатив: `PATCH /tasks/:id {label_ids}` на командной задаче → 400 (`get_logs`).
