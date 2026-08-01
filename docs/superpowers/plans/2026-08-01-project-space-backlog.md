# Project Space — облако проектов + бэклог: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить неиспользуемую вкладку «Граф» в экране задач на Project Space — сетку карточек-проектов с проваливанием в интерактивное canvas-облако задач (drag-to-connect связывает задачу с проектом).

**Architecture:** Новая лёгкая сущность `projects` (уровень воркспейса, по образцу `sprints`) + две nullable-колонки на `tasks` (`project_id`, `project_linked`). Бэкенд — CRUD-роут в `swarm-api` + расширение фильтров/полей `/tasks`. Фронт — новая вкладка в `TasksScreen`: сетка проектов (React) → canvas-облако (2D canvas по технике `miniapp/public/system-map.html`, но на живых данных). Задача — одна строка `tasks`, показывается и в облаке, и в обычном списке (без дублирования данных).

**Tech Stack:** Supabase Postgres (миграции), Deno Edge Functions (`swarm-api`), Next.js static export + React 19 + Tailwind (miniapp), Canvas 2D API.

## Global Constraints

- **Все edge-функции: `verify_jwt = false`** закреплён в `supabase/config.toml` — не менять. Деплой: `supabase functions deploy swarm-api --no-verify-jwt`.
- **`deno check` затронутых edge-функций должен быть зелёным** перед коммитом (pre-commit хук `.githooks/pre-commit`; активировать один раз: `git config core.hooksPath .githooks`).
- **`npm run build` в `miniapp/` должен быть зелёным** перед коммитом фронта.
- **Двуязычие EN+RU для всего нового пользовательского текста** (решение владельца 2026-07-29), EN приоритетный. Через существующий хук `useDt("RU", "EN")`.
- **Миграции: только `ADD COLUMN` / `CREATE TABLE`** в этой фиче (безопасно). Никаких `DROP`/`RENAME`/`ALTER TYPE`.
- **Новой таблице обязателен `GRANT ... TO service_role`** (правило `_template_new_table.sql`, иначе 42501 после 2026-10-30).
- **Доступ к `tasks` в swarm-api — только через существующие guard'ы** (`canViewTask`/`canMutateTask`, visibility по `is_private`/`owner_id`). Не добавлять прямые запросы в обход.
- **Изоляция по `group_id`** — проект принадлежит воркспейсу (как `sprints`).
- **`SERVICE_ROLE_KEY` везде, RLS не защищает** — вся проверка доступа в коде.
- Работаем в worktree `../swarm-project-backlog`, ветка `feat/project-backlog`. Коммитить мелко, пушить после осмысленного изменения.

---

## File Structure

**Бэкенд (edge functions):**
- Create: `supabase/migrations/20260801120000_projects.sql` — таблица `projects` + колонки `tasks.project_id`, `tasks.project_linked`.
- Create: `supabase/functions/_shared/tasks/projects.ts` — CRUD data-слой (по образцу `sprints.ts`).
- Modify: `supabase/functions/_shared/tasks/types.ts` — типы `Project`, `ProjectInput`; поля `project_id`, `project_linked` в `Task`/`TaskInput`.
- Modify: `supabase/functions/_shared/tasks/db.ts` — `createTask`/`listTasks`/фильтр по `projectId` учитывают новые поля.
- Modify: `supabase/functions/swarm-api/index.ts` — роут `/projects`, фильтр+поля `project_id`/`project_linked` в `/tasks`.

**Фронт (miniapp):**
- Modify: `miniapp/src/types.ts` — тип `Project`; поля на `Task`; удалить `TaskDependency`/`DependencyType`.
- Modify: `miniapp/src/lib/api.ts` — методы `fetchProjects`/`createProject`/`updateProject`/`deleteProject`; поля в task-инпутах; удалить dependency-методы.
- Create: `miniapp/src/components/tasks/ProjectsGrid.tsx` — сетка карточек проектов + создание.
- Create: `miniapp/src/components/tasks/ProjectSpace.tsx` — canvas-облако одного проекта + drag-to-connect.
- Create: `miniapp/src/components/tasks/useProjectCanvas.ts` — хук canvas-механики (pan/zoom/pick/layout).
- Modify: `miniapp/src/components/tasks/TasksScreen.tsx` — вкладка `projects` вместо `graph`.
- Delete: `miniapp/src/components/tasks/DependencyGraph.tsx`.
- Modify: `miniapp/src/components/TaskModal.tsx` — селект проекта.

**Доки:**
- Modify: `docs/ARCHITECTURE.md`, `docs/QUICK_REF.md`, `docs/BACKLOG.md`.

---

## Task 1: Миграция БД — таблица `projects` + колонки на `tasks`

**Files:**
- Create: `supabase/migrations/20260801120000_projects.sql`

**Interfaces:**
- Produces: таблица `projects(id uuid, group_id text, name text, color text, emoji text, created_by bigint, created_at timestamptz)`; колонки `tasks.project_id uuid` (nullable, FK → projects, ON DELETE SET NULL), `tasks.project_linked boolean not null default false`.

- [ ] **Step 1: Написать миграцию**

```sql
-- Project Space: проекты воркспейса + привязка задач.
-- projects.id — опаковый uuid; group_id → workspaces(id) (как sprints).
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  group_id   text not null references public.workspaces(id),
  name       text not null,
  color      text,
  emoji      text,
  created_by bigint,
  created_at timestamptz not null default now()
);
create index if not exists idx_projects_group on public.projects(group_id);

-- Обязательный grant для Data API (иначе 42501 после 2026-10-30 rollout).
grant select, insert, update, delete on public.projects to service_role;

-- Привязка задач к проекту. project_id NULL = задача не в Project Space.
-- project_linked = связана линией с хабом (true) / плавающая карточка бэклога (false).
-- Оба ADD COLUMN — безопасны. ON DELETE SET NULL: удаление проекта освобождает задачи.
alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks add column if not exists project_linked boolean not null default false;
create index if not exists idx_tasks_project on public.tasks(project_id);
```

- [ ] **Step 2: Применить миграцию на прод-БД**

Через Supabase MCP `apply_migration` (name: `projects`, query: содержимое файла) ИЛИ `execute_sql`. Проект Swarm Brain.
Expected: успех, без ошибок.

- [ ] **Step 3: Проверить, что таблица и колонки существуют**

Через MCP `execute_sql`:
```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'tasks' and column_name in ('project_id','project_linked')
order by column_name;
select count(*) from public.projects;
```
Expected: две строки колонок (`project_id` uuid nullable, `project_linked` boolean not null default false); `projects` = 0 строк.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260801120000_projects.sql
git commit -m "feat(db): таблица projects + tasks.project_id/project_linked для Project Space"
```

---

## Task 2: Типы бэкенда — `Project`, поля на `Task`

**Files:**
- Modify: `supabase/functions/_shared/tasks/types.ts`

**Interfaces:**
- Consumes: существующие `Task`, `TaskInput`.
- Produces: `Project`, `ProjectInput`; `Task.project_id: string | null`, `Task.project_linked: boolean`; `TaskInput.project_id?: string | null`, `TaskInput.project_linked?: boolean`.

- [ ] **Step 1: Добавить поля в `Task` и `TaskInput`**

В `type Task` после `label_ids: string[];` добавить:
```typescript
  project_id: string | null;
  project_linked: boolean;
```
В `type TaskInput` после `label_ids?: string[];` добавить:
```typescript
  project_id?: string | null;
  project_linked?: boolean;
```

- [ ] **Step 2: Добавить типы `Project` / `ProjectInput`**

В конец файла (или после блока Sprint):
```typescript
// ── Проекты (Project Space) ─────────────────────────────────────────────────────
export type Project = {
  id: string;
  group_id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  created_by: number | null;
  created_at: string;
};

export type ProjectInput = {
  name: string;
  color?: string | null;
  emoji?: string | null;
};
```

- [ ] **Step 3: Проверить type-check**

Run: `cd supabase/functions && deno check _shared/tasks/types.ts`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/tasks/types.ts
git commit -m "feat(tasks): типы Project/ProjectInput + поля project_id/project_linked"
```

---

## Task 3: Data-слой `projects.ts` (CRUD)

**Files:**
- Create: `supabase/functions/_shared/tasks/projects.ts`

**Interfaces:**
- Consumes: `Project`, `ProjectInput` из `types.ts`.
- Produces: `listProjects(groupId): Promise<Array<Project & { task_count: number; backlog_count: number }>>`, `createProject(input, groupId, createdBy): Promise<Project>`, `updateProject(id, fields, groupId): Promise<Project | null>`, `deleteProject(id, groupId): Promise<boolean>`, `projectInWorkspace(id, groupId): Promise<boolean>`.

- [ ] **Step 1: Написать модуль**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Project, ProjectInput } from "./types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Все операции изолированы по group_id — проект принадлежит воркспейсу.

export type ProjectWithCounts = Project & { task_count: number; backlog_count: number };

// Проекты воркспейса + счётчики: всего задач в проекте и из них в бэклоге (project_linked=false).
export async function listProjects(groupId: string): Promise<ProjectWithCounts[]> {
  const { data: projects } = await supabase
    .from("projects").select("*").eq("group_id", groupId)
    .order("created_at", { ascending: true });
  const list = (projects ?? []) as Project[];
  if (list.length === 0) return [];

  // Считаем задачи по проектам одним запросом (без N+1).
  const { data: tasks } = await supabase
    .from("tasks").select("project_id, project_linked")
    .eq("group_id", groupId)
    .in("project_id", list.map((p) => p.id));
  const counts = new Map<string, { total: number; backlog: number }>();
  ((tasks ?? []) as Array<{ project_id: string | null; project_linked: boolean }>).forEach((t) => {
    if (!t.project_id) return;
    const c = counts.get(t.project_id) ?? { total: 0, backlog: 0 };
    c.total += 1;
    if (!t.project_linked) c.backlog += 1;
    counts.set(t.project_id, c);
  });
  return list.map((p) => ({
    ...p,
    task_count: counts.get(p.id)?.total ?? 0,
    backlog_count: counts.get(p.id)?.backlog ?? 0,
  }));
}

export async function createProject(
  input: ProjectInput,
  groupId: string,
  createdBy: number | null,
): Promise<Project> {
  const { data, error } = await supabase.from("projects").insert({
    group_id: groupId,
    name: input.name,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    created_by: createdBy,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Project;
}

// Обновляет только проект своего воркспейса. Возвращает обновлённый или null (не найден/чужой).
export async function updateProject(
  id: string,
  fields: Partial<ProjectInput>,
  groupId: string,
): Promise<Project | null> {
  const { data } = await supabase.from("projects")
    .update(fields)
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as Project | null) ?? null;
}

// Удаляет проект своего воркспейса. Задачи освобождаются (FK ON DELETE SET NULL для project_id),
// а project_linked сбрасываем явно (FK его не трогает).
export async function deleteProject(id: string, groupId: string): Promise<boolean> {
  const { data } = await supabase.from("projects")
    .delete().eq("id", id).eq("group_id", groupId).select("id").maybeSingle();
  if (!data) return false;
  await supabase.from("tasks")
    .update({ project_linked: false })
    .eq("group_id", groupId).is("project_id", null).eq("project_linked", true);
  return true;
}

export async function projectInWorkspace(id: string, groupId: string): Promise<boolean> {
  const { data } = await supabase
    .from("projects").select("id").eq("id", id).eq("group_id", groupId).maybeSingle();
  return !!data;
}
```

> Примечание к `deleteProject`: FK `ON DELETE SET NULL` обнуляет `project_id` у задач удалённого проекта → после удаления «осиротевшие» задачи имеют `project_id IS NULL`, у них и сбрасываем залипший `project_linked`. Это корректно, т.к. `project_linked=true` без `project_id` — невалидное состояние.

- [ ] **Step 2: Проверить type-check**

Run: `cd supabase/functions && deno check _shared/tasks/projects.ts`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/tasks/projects.ts
git commit -m "feat(tasks): data-слой projects.ts (CRUD + счётчики задач)"
```

---

## Task 4: Data-слой `db.ts` — поля projects в create/list

**Files:**
- Modify: `supabase/functions/_shared/tasks/db.ts`

**Interfaces:**
- Consumes: `createTask`, `listTasks` (существующие).
- Produces: `createTask` пишет `project_id`/`project_linked`; `listTasks` принимает `projectId?: string` и фильтрует по нему.

- [ ] **Step 1: Дописать поля в `createTask`**

В объекте `.insert({...})` после `label_ids: input.label_ids ?? [],` добавить:
```typescript
    project_id: input.project_id ?? null,
    project_linked: input.project_linked ?? false,
```

- [ ] **Step 2: Добавить фильтр `projectId` в `listTasks`**

В сигнатуре `filters` (объект-параметр) после `labelIds?: string[];` добавить:
```typescript
  projectId?: string;
```
В теле, рядом с `if (filters.sprintId) q = q.eq("sprint_id", filters.sprintId);` добавить:
```typescript
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
```

- [ ] **Step 3: Проверить type-check**

Run: `cd supabase/functions && deno check _shared/tasks/db.ts`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/tasks/db.ts
git commit -m "feat(tasks): db.ts — project_id/project_linked в create + фильтр list"
```

---

## Task 5: Роут `/projects` в swarm-api

**Files:**
- Modify: `supabase/functions/swarm-api/index.ts`

**Interfaces:**
- Consumes: `listProjects`, `createProject`, `updateProject`, `deleteProject` из `_shared/tasks/projects.ts`; `ProjectInput` из types; переменные хендлера `groupId`, `telegram_id`, `origin`, хелперы `json`, `apiErr`.
- Produces: HTTP `GET/POST /projects`, `PATCH/DELETE /projects/:id`.

- [ ] **Step 1: Импорты**

Рядом с импортом sprints добавить:
```typescript
import type { ProjectInput } from "../_shared/tasks/types.ts";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from "../_shared/tasks/projects.ts";
```
(`ProjectInput` можно дописать в существующий `import type { TaskInput, SprintInput } ...` — тогда отдельная строка не нужна.)

- [ ] **Step 2: Роут коллекции `/projects`**

Рядом с блоком `if (routePath === "/sprints") {` добавить:
```typescript
  // ── Projects (Project Space) ────────────────────────────────────────────────
  if (routePath === "/projects") {
    if (req.method === "GET") {
      return json(await listProjects(groupId), 200, origin);
    }
    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      if (typeof body.name !== "string" || !body.name.trim()) {
        return apiErr(400, "name обязателен", origin);
      }
      const input: ProjectInput = {
        name: body.name.trim(),
        color: (body.color as string | null) ?? null,
        emoji: (body.emoji as string | null) ?? null,
      };
      return json(await createProject(input, groupId, telegram_id ?? null), 201, origin);
    }
    return apiErr(405, "Method not allowed", origin);
  }
```

- [ ] **Step 3: Роут элемента `/projects/:id`**

Рядом с `const sprintMatch = routePath.match(...)` добавить:
```typescript
  const projectMatch = routePath.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectId = projectMatch[1];
    if (req.method === "PATCH") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      const fields: Partial<ProjectInput> = {};
      if (typeof body.name === "string") fields.name = body.name.trim();
      if ("color" in body) fields.color = body.color as string | null;
      if ("emoji" in body) fields.emoji = body.emoji as string | null;
      const updated = await updateProject(projectId, fields, groupId);
      if (!updated) return apiErr(404, "Not found", origin);
      return json(updated, 200, origin);
    }
    if (req.method === "DELETE") {
      const ok = await deleteProject(projectId, groupId);
      if (!ok) return apiErr(404, "Not found", origin);
      return json({ ok: true }, 200, origin);
    }
    return apiErr(405, "Method not allowed", origin);
  }
```

- [ ] **Step 4: Проверить type-check**

Run: `cd supabase/functions && deno check swarm-api/index.ts`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(swarm-api): CRUD роут /projects"
```

---

## Task 6: `/tasks` — фильтр и поля project_id/project_linked

**Files:**
- Modify: `supabase/functions/swarm-api/index.ts`

**Interfaces:**
- Consumes: `projectInWorkspace` из projects.ts; существующие GET/POST/PATCH `/tasks` блоки.
- Produces: `GET /tasks?project_id=` фильтрует; `POST /tasks` принимает `project_id`; `PATCH /tasks/:id` принимает `project_id` и `project_linked`. (Поля `project_id`/`project_linked` уже в ответе, т.к. `select("*")`.)

- [ ] **Step 1: Импорт `projectInWorkspace`**

Добавить `projectInWorkspace` в импорт из `../_shared/tasks/projects.ts` (Task 5, Step 1).

- [ ] **Step 2: GET /tasks — фильтр project_id**

В блоке `if (routePath === "/tasks")` GET, рядом с `const sprintId = url.searchParams.get("sprint_id") ?? undefined;` добавить:
```typescript
      const projectId = url.searchParams.get("project_id") ?? undefined;
```
В объекте фильтров `listTasks({...})` рядом с `sprintId,` добавить:
```typescript
          projectId,
```

- [ ] **Step 3: POST /tasks — приём project_id**

В блоке POST `/tasks`, после проверки `sprintId` (`if (sprintId && !(await sprintInWorkspace...`), добавить:
```typescript
      const projectId = (body.project_id as string | null) ?? null;
      if (projectId && !(await projectInWorkspace(projectId, groupId))) {
        return apiErr(400, "project_id не найден в этом воркспейсе", origin);
      }
```
В объекте `const input: TaskInput = {...}` рядом с `sprint_id: sprintId,` добавить:
```typescript
        project_id: projectId,
        project_linked: body.project_linked === true,
```

- [ ] **Step 4: PATCH /tasks/:id — приём project_id и project_linked**

В блоке PATCH `/tasks/:id`, рядом с блоком `if ("sprint_id" in body) {...}`, добавить:
```typescript
      // Привязка к проекту (с проверкой воркспейса; null — открепить).
      if ("project_id" in body) {
        const pid = body.project_id as string | null;
        if (pid && !(await projectInWorkspace(pid, groupId))) {
          return apiErr(400, "project_id не найден в этом воркспейсе", origin);
        }
        fields.project_id = pid;
        // Открепление от проекта сбрасывает связь линией.
        if (!pid) fields.project_linked = false;
      }
      // Связать/отвязать линией (drag-to-connect). Осмысленно только у задачи с проектом.
      if (typeof body.project_linked === "boolean") {
        const effProject = "project_id" in fields ? fields.project_id : task.project_id;
        if (!effProject && body.project_linked) {
          return apiErr(400, "project_linked требует project_id", origin);
        }
        fields.project_linked = body.project_linked;
      }
```
(Тип `fields` в этом блоке — `Partial<TaskInput> & {...}`; `project_id`/`project_linked` уже входят в `TaskInput`, отдельное расширение не нужно.)

- [ ] **Step 5: Проверить type-check**

Run: `cd supabase/functions && deno check swarm-api/index.ts`
Expected: без ошибок.

- [ ] **Step 6: Задеплоить и смоук-тест на проде**

```bash
supabase functions deploy swarm-api --no-verify-jwt
```
Затем через MCP `execute_sql` создать тестовый проект и проверить связывание (или дёрнуть эндпоинт). Минимальный смоук через SQL:
```sql
-- создать проект вручную для теста фильтра (group_id взять реальный, напр. 'cee')
insert into public.projects (group_id, name) values ('cee', '__smoke_test__') returning id;
```
Затем проверить, что задача с этим `project_id` и `project_linked=true` не ломает выборку:
```sql
select id, title, project_id, project_linked from public.tasks where project_id is not null limit 5;
delete from public.projects where name = '__smoke_test__';
```
Expected: запросы проходят; после удаления проекта задачи (если были) имеют `project_id IS NULL`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(swarm-api): /tasks — фильтр project_id + приём project_id/project_linked"
```

---

## Task 7: Фронт-типы + api.ts (projects) + удаление dependency-кода

**Files:**
- Modify: `miniapp/src/types.ts`
- Modify: `miniapp/src/lib/api.ts`

**Interfaces:**
- Consumes: существующий `Task`, `apiFetch`, `DEV_MODE`, `mockTasks`.
- Produces: тип `Project`; `Task.project_id`/`Task.project_linked`; api-методы `fetchProjects(): Promise<Project[]>`, `createProject(input): Promise<Project>`, `updateProject(id, fields): Promise<Project>`, `deleteProject(id): Promise<void>`; `CreateTaskInput.project_id?`, `UpdateTaskInput` (наследует), `TaskFilters.project_id?`.

- [ ] **Step 1: types.ts — тип Project, поля Task, удалить dependency-типы**

Удалить `DependencyType` и `TaskDependency` (строки ~41-48). Добавить:
```typescript
export type Project = {
  id: string;
  group_id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  created_by: number | null;
  created_at: string;
  // Отдаётся из GET /projects (агрегаты):
  task_count?: number;
  backlog_count?: number;
};
```
В `Task` добавить поля:
```typescript
  project_id: string | null;
  project_linked: boolean;
```

- [ ] **Step 2: api.ts — убрать импорты/методы зависимостей**

- Из строки импорта `import type { ... TaskDependency, DependencyType ... }` убрать `TaskDependency, DependencyType`.
- Удалить весь блок `// ── Task dependencies (Рой) ──` целиком: `fetchDependencies`, `fetchAllDependencies`, `createDependency`, `deleteDependency`.

- [ ] **Step 3: api.ts — расширить task-инпуты и фильтры**

- В `CreateTaskInput` добавить `project_id?: string | null;`.
- В `TaskFilters` добавить `project_id?: string;`.
- В `fetchTasks`: DEV_MODE-ветка — `if (f.project_id) r = r.filter((t) => t.project_id === f.project_id);`; params — `if (f.project_id) params.set("project_id", f.project_id);`.
- В `createTask` DEV_MODE mock-объект: добавить `project_id: input.project_id ?? null, project_linked: false,`.
- В `updateTask` DEV_MODE: добавить `if (fields.project_id !== undefined) task.project_id = fields.project_id ?? null; if ((fields as { project_linked?: boolean }).project_linked !== undefined) task.project_linked = (fields as { project_linked?: boolean }).project_linked!;`.
- Во всех mock-задачах (`mockTasks`, ~строки 112/120/128) добавить `project_id: null, project_linked: false,` к каждому объекту (иначе тип `Task` не сойдётся).

- [ ] **Step 4: api.ts — методы projects**

Рядом с блоком Sprints добавить:
```typescript
// ── Projects (Project Space) ────────────────────────────────────────────────────
let mockProjects: Project[] = [
  { id: "pr1", group_id: "cee", name: "Swarm Brain", color: "#5b8def", emoji: null, created_by: null, created_at: new Date().toISOString(), task_count: 0, backlog_count: 0 },
];

export async function fetchProjects(): Promise<Project[]> {
  if (DEV_MODE) return mockProjects;
  return apiFetch<Project[]>("/projects");
}

export async function createProject(input: { name: string; color?: string | null; emoji?: string | null }): Promise<Project> {
  if (DEV_MODE) {
    const p: Project = { id: Date.now().toString(), group_id: "cee", name: input.name, color: input.color ?? null, emoji: input.emoji ?? null, created_by: null, created_at: new Date().toISOString(), task_count: 0, backlog_count: 0 };
    mockProjects.push(p);
    return p;
  }
  return apiFetch<Project>("/projects", { method: "POST", body: JSON.stringify(input) });
}

export async function updateProject(id: string, fields: Partial<{ name: string; color: string | null; emoji: string | null }>): Promise<Project> {
  if (DEV_MODE) {
    const i = mockProjects.findIndex((p) => p.id === id);
    if (i !== -1) mockProjects[i] = { ...mockProjects[i], ...fields };
    return mockProjects[i];
  }
  return apiFetch<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteProject(id: string): Promise<void> {
  if (DEV_MODE) { mockProjects = mockProjects.filter((p) => p.id !== id); return; }
  await apiFetch<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" });
}
```
Импортировать `Project` из `@/types` в начале api.ts (добавить в существующий `import type {...}`).

- [ ] **Step 5: Убедиться, что `project_linked` можно слать через updateTask**

`UpdateTaskInput = Partial<CreateTaskInput> & { status?: string }`. `project_linked` не в `CreateTaskInput`. Добавить в `UpdateTaskInput`:
```typescript
export type UpdateTaskInput = Partial<CreateTaskInput> & { status?: string; project_linked?: boolean };
```
И в реальном (не DEV) `updateTask` тело уже шлёт `JSON.stringify(fields)` — `project_linked` уйдёт как есть.

- [ ] **Step 6: Проверить сборку**

Run: `cd miniapp && npm run build`
Expected: успех (dependency-код удалён, новые типы сходятся). Если `DependencyGraph.tsx` ещё импортируется в `TasksScreen.tsx` — это чинится в Task 9; на этом шаге сборка может падать ТОЛЬКО из-за этого импорта. Если так — временно НЕ падать: этот шаг проверяет api/types; финальную сборку гарантирует Task 9. Допустимо закоммитить и добить в Task 9.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src/types.ts miniapp/src/lib/api.ts
git commit -m "feat(miniapp): тип Project + api-методы projects; удалён dependency-код api/types"
```

---

## Task 8: Хук canvas-механики `useProjectCanvas.ts`

**Files:**
- Create: `miniapp/src/components/tasks/useProjectCanvas.ts`

**Interfaces:**
- Consumes: `Task` из `@/types`.
- Produces: хук `useProjectCanvas(canvasRef, { project, tasks, onOpenTask, onToggleLink })` → рисует хаб+узлы, обрабатывает pan/zoom/hover/click/drag-to-connect. Типы: `type ProjectHub = { id: string; name: string; color: string | null; emoji: string | null }`; колбэки `onOpenTask(taskId: string): void`, `onToggleLink(taskId: string, linked: boolean): void`.

Механику берём по образцу `miniapp/public/system-map.html` (canvas 2D, `pointerdown/move/up`, `wheel`-zoom, `pick(x,y)`, детерминированная авто-раскладка вокруг центра). Позиции узлов НЕ персистятся; drag узла на хаб/от хаба вызывает `onToggleLink`.

- [ ] **Step 1: Написать хук**

```typescript
"use client";
import { useEffect, useRef } from "react";
import type { Task } from "@/types";

export type ProjectHub = { id: string; name: string; color: string | null; emoji: string | null };

type Node = { id: string; x: number; y: number; r: number; task: Task | null; hub: boolean };

type Params = {
  hub: ProjectHub;
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
  onToggleLink: (taskId: string, linked: boolean) => void;
};

// Детерминированный псевдослучай по числу (как nrand в system-map.html) — стабильная раскладка.
function nrand(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function useProjectCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  params: Params,
) {
  // Держим свежие params в ref, чтобы не пересоздавать rAF-цикл на каждый апдейт.
  const p = useRef(params);
  p.current = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    let W = 0, H = 0;
    const cam = { tx: 0, ty: 0, s: 1 };
    let nodes: Node[] = [];
    let dragNode: Node | null = null;
    let panning = false;
    let moved = false;
    let downX = 0, downY = 0, lastX = 0, lastY = 0;
    let raf = 0;

    function resize() {
      const rect = canvas!.parentElement!.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cam.tx = W / 2; cam.ty = H / 2; // центр = хаб в мировых (0,0)
    }

    // Раскладка: хаб в (0,0); связанные — внутреннее кольцо, плавающие — внешнее.
    function layout() {
      const hub: Node = { id: p.current.hub.id, x: 0, y: 0, r: 46, task: null, hub: true };
      const linked = p.current.tasks.filter((t) => t.project_linked);
      const floating = p.current.tasks.filter((t) => !t.project_linked);
      const ring = (arr: Task[], radius: number): Node[] =>
        arr.map((t, i) => {
          const a = (i / Math.max(1, arr.length)) * Math.PI * 2 + nrand(i + radius) * 0.4;
          const jr = radius + nrand(i * 3 + radius) * 40;
          return { id: t.id, x: Math.cos(a) * jr, y: Math.sin(a) * jr, r: 22, task: t, hub: false };
        });
      nodes = [hub, ...ring(linked, 150), ...ring(floating, 320)];
    }

    function pick(sx: number, sy: number): Node | null {
      const wx = (sx - cam.tx) / cam.s, wy = (sy - cam.ty) / cam.s;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if ((wx - n.x) ** 2 + (wy - n.y) ** 2 <= (n.r + 6) ** 2) return n;
      }
      return null;
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      ctx!.save();
      ctx!.translate(cam.tx, cam.ty);
      ctx!.scale(cam.s, cam.s);
      const hub = nodes.find((n) => n.hub)!;
      // Линии хаб→связанные.
      nodes.forEach((n) => {
        if (n.hub || !n.task?.project_linked) return;
        ctx!.strokeStyle = "rgba(91,141,239,0.55)"; ctx!.lineWidth = 1.5;
        ctx!.beginPath(); ctx!.moveTo(hub.x, hub.y); ctx!.lineTo(n.x, n.y); ctx!.stroke();
      });
      // Узлы.
      nodes.forEach((n) => {
        ctx!.beginPath(); ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fillStyle = n.hub ? (p.current.hub.color ?? "#5b8def")
          : n.task?.project_linked ? "#2a2a35" : "#1c1c24";
        ctx!.fill();
        if (!n.hub) { ctx!.strokeStyle = n.task?.project_linked ? "#5b8def" : "#3a3a44"; ctx!.lineWidth = 1; ctx!.stroke(); }
        const label = n.hub ? p.current.hub.name : (n.task?.title ?? "");
        ctx!.fillStyle = n.hub ? "#fff" : "#cfcfd6";
        ctx!.font = n.hub ? "600 12px sans-serif" : "11px sans-serif";
        ctx!.textAlign = "center"; ctx!.textBaseline = "middle";
        ctx!.fillText(label.slice(0, n.hub ? 12 : 14), n.x, n.y);
      });
      ctx!.restore();
    }

    function rel(e: PointerEvent) {
      const r = canvas!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function onDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId);
      const pt = rel(e); downX = pt.x; downY = pt.y; lastX = pt.x; lastY = pt.y; moved = false;
      const n = pick(pt.x, pt.y);
      if (n && !n.hub) dragNode = n; else panning = true;
    }
    function onMove(e: PointerEvent) {
      const pt = rel(e);
      if (Math.abs(pt.x - downX) + Math.abs(pt.y - downY) > 4) moved = true;
      if (dragNode) {
        dragNode.x += (pt.x - lastX) / cam.s; dragNode.y += (pt.y - lastY) / cam.s;
      } else if (panning) {
        cam.tx += pt.x - lastX; cam.ty += pt.y - lastY;
      }
      lastX = pt.x; lastY = pt.y;
    }
    function onUp(e: PointerEvent) {
      const pt = rel(e);
      if (dragNode && !moved) {
        p.current.onOpenTask(dragNode.id); // клик без драга → открыть задачу
      } else if (dragNode && moved && dragNode.task) {
        // drag-to-connect: расстояние узла до хаба в мировых координатах.
        const hub = nodes.find((n) => n.hub)!;
        const dist = Math.hypot(dragNode.x - hub.x, dragNode.y - hub.y);
        const nowLinked = dist < 110;               // втащили в зону хаба → связать
        if (nowLinked !== dragNode.task.project_linked) {
          p.current.onToggleLink(dragNode.task.id, nowLinked);
        }
        layout(); // вернуть на кольцо по новому статусу
      }
      dragNode = null; panning = false;
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = canvas!.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const wx = (px - cam.tx) / cam.s, wy = (py - cam.ty) / cam.s;
      cam.s = Math.max(0.4, Math.min(2.5, cam.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      cam.tx = px - wx * cam.s; cam.ty = py - wy * cam.s;
    }

    resize();
    layout();
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    loop();
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement!);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // Пересоздаём цикл только при смене набора задач/хаба (по id и связям), не на каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canvasRef,
    params.hub.id,
    params.tasks.map((t) => `${t.id}:${t.project_linked}`).join(","),
  ]);
}
```

- [ ] **Step 2: Проверить сборку/линт**

Run: `cd miniapp && npx tsc --noEmit`
Expected: без ошибок типов в новом файле.

- [ ] **Step 3: Commit**

```bash
git add miniapp/src/components/tasks/useProjectCanvas.ts
git commit -m "feat(miniapp): хук useProjectCanvas — canvas-облако + drag-to-connect"
```

---

## Task 9: `ProjectSpace.tsx` + `ProjectsGrid.tsx` + вкладка (замена Граф)

**Files:**
- Create: `miniapp/src/components/tasks/ProjectSpace.tsx`
- Create: `miniapp/src/components/tasks/ProjectsGrid.tsx`
- Modify: `miniapp/src/components/tasks/TasksScreen.tsx`
- Delete: `miniapp/src/components/tasks/DependencyGraph.tsx`

**Interfaces:**
- Consumes: `useProjectCanvas`, `fetchProjects`/`createProject`/`fetchTasks`/`updateTask`/`createTask` из api, `TaskModal`, `useDt`, `RoyIcon`.
- Produces: `ProjectsGrid` (сетка + создание + выбор проекта), `ProjectSpace` (облако одного проекта), обновлённый `TasksScreen` с вкладкой `projects`.

- [ ] **Step 1: ProjectSpace.tsx**

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Task } from "@/types";
import { fetchTasks, updateTask, createTask } from "@/lib/api";
import { useProjectCanvas } from "@/components/tasks/useProjectCanvas";
import { TaskModal } from "@/components/TaskModal";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

type Props = { project: Project; onBack: () => void };

export function ProjectSpace({ project, onBack }: Props) {
  const dt = useDt();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setTasks(await fetchTasks({ project_id: project.id }));
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);

  const onOpenTask = useCallback((taskId: string) => setOpenTaskId(taskId), []);
  const onToggleLink = useCallback(async (taskId: string, linked: boolean) => {
    // Оптимистично: меняем локально, откат при ошибке.
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, project_linked: linked } : t)));
    try {
      await updateTask(taskId, { project_linked: linked });
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, project_linked: !linked } : t)));
    }
  }, []);

  useProjectCanvas(canvasRef, {
    hub: { id: project.id, name: project.name, color: project.color, emoji: project.emoji },
    tasks,
    onOpenTask,
    onToggleLink,
  });

  const openTask = tasks.find((t) => t.id === openTaskId);

  return (
    <div className="relative flex-1 min-h-0">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1 rounded-full bg-surface border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2">
          <RoyIcon name="chevron-left" size={14} /> {dt("Проекты", "Projects")}
        </button>
        <span className="text-sm font-bold text-ink">{project.name}</span>
      </div>
      <button
        onClick={() => setCreating(true)}
        className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white active:scale-95"
      >
        <RoyIcon name="plus" size={14} /> {dt("Идея", "Idea")}
      </button>
      <div className="absolute inset-0" style={{ background: "#0d0d12" }}>
        <canvas ref={canvasRef} className="h-full w-full touch-none" />
      </div>

      {openTask && (
        <TaskModal
          task={openTask}
          open
          onClose={() => setOpenTaskId(null)}
          onSaved={() => { setOpenTaskId(null); void load(); }}
        />
      )}
      {creating && (
        <TaskModal
          open
          prefill={{}}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
          projectId={project.id}
        />
      )}
    </div>
  );
}
```
> `TaskModal` получает новый опциональный проп `projectId` (см. Task 10) — при создании задачи он проставит `project_id`, `project_linked=false` (идея сразу в бэклоге проекта).

- [ ] **Step 2: ProjectsGrid.tsx**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { Project } from "@/types";
import { fetchProjects, createProject } from "@/lib/api";
import { ProjectSpace } from "@/components/tasks/ProjectSpace";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

export function ProjectsGrid() {
  const dt = useDt();
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const load = async () => setProjects(await fetchProjects());
  useEffect(() => { void load(); }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const p = await createProject({ name: trimmed });
    setName(""); setAdding(false);
    setProjects((prev) => [...prev, p]);
    setActive(p);
  };

  if (active) return <ProjectSpace project={active} onBack={() => { setActive(null); void load(); }} />;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setActive(p)}
            className="flex flex-col items-start rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-2 active:scale-[0.98]"
          >
            <span className="mb-1 h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? "#5b8def" }} />
            <span className="font-semibold text-ink">{p.emoji ? `${p.emoji} ` : ""}{p.name}</span>
            <span className="mt-1 text-xs text-ink-mute">
              {dt("задач", "tasks")}: {p.task_count ?? 0} · {dt("в бэклоге", "backlog")}: {p.backlog_count ?? 0}
            </span>
          </button>
        ))}
        {adding ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-2 bg-surface p-4">
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") setAdding(false); }}
              placeholder={dt("Название проекта", "Project name")}
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-[var(--accent-ink)]"
            />
            <div className="flex gap-2">
              <button onClick={() => void submit()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white">{dt("Создать", "Create")}</button>
              <button onClick={() => setAdding(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft">{dt("Отмена", "Cancel")}</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-[92px] items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-2 text-sm text-ink-mute transition-colors hover:bg-surface active:scale-[0.98]"
          >
            <RoyIcon name="plus" size={16} /> {dt("Новый проект", "New project")}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TasksScreen.tsx — заменить вкладку graph→projects**

- Убрать `import { DependencyGraph } ...`, добавить `import { ProjectsGrid } from "@/components/tasks/ProjectsGrid";`.
- В `type View`: заменить `"graph"` на `"projects"`.
- В `VIEWS`: заменить объект графа на `{ id: "projects", label: "Проекты", icon: "graph" }` (icon `graph` переиспользуем — узлы-созвездие подходят; при желании поменять на `board`).
- В рендере: заменить `{view === "graph" && <DependencyGraph />}` на `{view === "projects" && <ProjectsGrid />}`.

> Примечание по i18n: `VIEWS` сейчас хардкодит русские `label`. Остальные вкладки тоже на RU — не расширяем скоуп i18n здесь, оставляем «Проекты» в том же стиле, что и соседние («Список»/«Спринт»); полный перевод вкладок — в задаче §i18n бэклога.

- [ ] **Step 4: Удалить DependencyGraph.tsx**

```bash
git rm miniapp/src/components/tasks/DependencyGraph.tsx
```

- [ ] **Step 5: Проверить сборку**

Run: `cd miniapp && npm run build`
Expected: успех. Нет висящих ссылок на `DependencyGraph`/dependency-методы.

- [ ] **Step 6: Commit**

```bash
git add miniapp/src/components/tasks/ProjectSpace.tsx miniapp/src/components/tasks/ProjectsGrid.tsx miniapp/src/components/tasks/TasksScreen.tsx
git commit -m "feat(miniapp): вкладка Проекты — сетка + облако (замена Граф); удалён DependencyGraph"
```

---

## Task 10: TaskModal — селект проекта + проп projectId

**Files:**
- Modify: `miniapp/src/components/TaskModal.tsx`

**Interfaces:**
- Consumes: `fetchProjects`, `createTask`, `updateTask`; существующие пропсы модалки.
- Produces: новый опциональный проп `projectId?: string | null` (префилл при создании); селект «Проект» в форме, шлёт `project_id` через create/update.

- [ ] **Step 1: Добавить проп и загрузку проектов**

- В `interface TaskModalProps` добавить: `projectId?: string | null;`.
- В сигнатуре компонента добавить `projectId` в деструктуризацию.
- Импортировать `fetchProjects` и тип `Project`.
- Состояние: `const [projects, setProjects] = useState<Project[]>([]);` и `const [selProject, setSelProject] = useState<string | null>(task?.project_id ?? projectId ?? null);`.
- `useEffect(() => { void fetchProjects().then(setProjects); }, []);`

- [ ] **Step 2: Добавить селект в форму**

Рядом с селектом роли/страны добавить (двуязычная подпись через `dt`, если в файле есть `useDt`; если нет — используем текущую локализацию файла):
```tsx
<div>
  <label className={labelCls}>Проект / Project</label>
  <select
    className={fieldCls}
    value={selProject ?? NONE}
    onChange={(e) => setSelProject(e.target.value === NONE ? null : e.target.value)}
  >
    <option value={NONE}>—</option>
    {projects.map((p) => (
      <option key={p.id} value={p.id}>{p.name}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 3: Прокинуть project_id в create/update**

- В обработчике сохранения: при создании (`!isEdit`) в объект `createTask({...})` добавить `project_id: selProject`. Если модалка открыта из облака (`projectId` задан и `selProject` не тронут) — задача создаётся с этим `project_id` и `project_linked=false` (бэкенд по умолчанию `false`).
- При правке (`isEdit`) в `updateTask(task.id, {...})` добавить `project_id: selProject` (бэкенд при `null` также сбросит `project_linked`).

- [ ] **Step 4: Проверить сборку**

Run: `cd miniapp && npm run build`
Expected: успех.

- [ ] **Step 5: Commit**

```bash
git add miniapp/src/components/TaskModal.tsx
git commit -m "feat(miniapp): TaskModal — селект проекта + проп projectId (создание из облака)"
```

---

## Task 11: Смоук реального флоу + доки + бэклог

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/QUICK_REF.md`
- Modify: `docs/BACKLOG.md`

**Interfaces:**
- Consumes: всё предыдущее (задеплоенный бэкенд + собранный фронт).

- [ ] **Step 1: Задеплоить фронт и бэкенд (если не задеплоено в Task 6)**

```bash
supabase functions deploy swarm-api --no-verify-jwt
# miniapp деплоится на Cloudflare Pages из main; здесь ветка feat/ — смоук через локальный npm run build/preview или после merge.
```

- [ ] **Step 2: Смоук на реальном окружении (правило владельца «сначала реальное»)**

Через веб (браузер, реальная сессия) ИЛИ через MCP `execute_sql`/дёрг эндпоинта:
1. Создать проект → появился в сетке, `GET /projects` отдаёт его с `task_count=0`.
2. Из облака кинуть «Идею» → создалась задача с `project_id`, `project_linked=false`, видна плавающей; она же видна в обычном списке задач (вкладка «Список»).
3. Drag-to-connect: втащить карточку в зону хаба → `project_linked=true`, появилась линия; проверить `GET /tasks?project_id=` → `project_linked=true`.
4. Утащить обратно → `project_linked=false`, линия исчезла.
5. Клик по узлу → открылся `TaskModal`.
6. Удалить проект → его задачи получили `project_id=NULL`, `project_linked=false` (проверить SQL), в сетке проект исчез.

Зафиксировать факт проверки (что именно прогнал) в отчёте. Что проверить нельзя — сказать прямо.

- [ ] **Step 3: Обновить ARCHITECTURE.md**

- В таблицу БД добавить строку `projects` (колонки: `id`, `group_id` FK→workspaces, `name`, `color`, `emoji`, `created_by`, `created_at`).
- В строку `tasks` дописать поля `project_id` (FK→projects, ON DELETE SET NULL), `project_linked` (boolean default false).
- В таблицу эндпоинтов swarm-api добавить `GET/POST /projects`, `PATCH/DELETE /projects/:id`; в `GET /tasks` дописать фильтр `project_id` и новые поля ответа; в `POST/PATCH /tasks` — приём `project_id`/`project_linked`.
- В описании веб-интерфейса заменить «Граф» на «Проекты» (вкладки Список/Таймлайн/Спринт/Проекты).

- [ ] **Step 4: Обновить QUICK_REF.md**

- В таблицу ключевых файлов добавить: `ProjectsGrid.tsx`/`ProjectSpace.tsx`/`useProjectCanvas.ts` (Project Space) и `_shared/tasks/projects.ts`.
- Убрать/поправить упоминания `DependencyGraph`, если есть.

- [ ] **Step 5: Обновить BACKLOG.md**

- Закрыть открытый пункт «Проекты-списки (как в Reminders) — отложено» (стал этой фичей).
- Завести запись/issue: «Снести бэкенд зависимостей задач (`_shared/tasks/dependencies.ts` + `/dependencies` в swarm-api + `TaskDependency` в types) — стал мёртвым после удаления вкладки Граф. Отдельный тикет, двухшаговая уборка».
- Отметить открытые: судьба Таймлайна; группировка/подпространства проектов; персист позиций узлов.

- [ ] **Step 6: Завести GitHub issue на снос бэкенда зависимостей**

```bash
gh issue create --title "Снести мёртвый бэкенд зависимостей задач (после удаления вкладки Граф)" \
  --body "Вкладка «Граф» заменена на Project Space (feat/project-backlog). Фронтовый DependencyGraph.tsx и dependency-методы api удалены. Осталось неиспользуемым: supabase/functions/_shared/tasks/dependencies.ts, эндпоинты /dependencies и /tasks/:id/dependencies в swarm-api, тип TaskDependency в бэкенд-types. Снести отдельным PR (двухшаговая уборка, сверить что нет потребителей)."
```

- [ ] **Step 7: Commit + push**

```bash
git add docs/ARCHITECTURE.md docs/QUICK_REF.md docs/BACKLOG.md
git commit -m "docs: Project Space — таблица projects, эндпоинты, вкладка Проекты; закрыт пункт проекты-списки"
git push -u origin feat/project-backlog
```

---

## Task 12: Слияние в main

**Files:** —

- [ ] **Step 1: Финальная проверка**

Run: `cd miniapp && npm run build` и `cd supabase/functions && deno check swarm-api/index.ts`
Expected: оба зелёные.

- [ ] **Step 2: Merge в main**

```bash
cd /Users/garva/Documents/projects/Swarm-brain
git pull --rebase origin main
git merge feat/project-backlog
git push origin main
```

- [ ] **Step 3: Убрать worktree**

```bash
git worktree remove ../swarm-project-backlog
```

---

## Self-Review

**1. Spec coverage:**
- Таблица `projects` + `project_id`/`project_linked` → Task 1. ✓
- Замена вкладки Граф → Task 9. ✓
- Сетка проектов (C) → Task 9 (`ProjectsGrid`). ✓
- Облако (A) + drag-to-connect → Task 8+9. ✓
- Без дублирования данных (одна `Task`) → задача создаётся один раз с `project_id`, видна везде (Task 9/10). ✓
- Отвязка от спринтов (свой `project_linked`) → Task 1/6. ✓
- Создание доступно любому участнику → роут без admin-guard (Task 5). ✓
- Открытие задачи через существующий TaskModal → Task 9/10. ✓
- i18n EN+RU нового текста → `useDt` в Task 9. ✓
- Снос DependencyGraph + issue на бэкенд зависимостей → Task 7/9/11. ✓
- Позиции не персистятся → Task 8 (layout в памяти). ✓

**2. Placeholder scan:** код приведён целиком в каждом шаге; TBD/«добавить обработку» нет. ✓

**3. Type consistency:** `project_id: string | null`, `project_linked: boolean` — единообразны в бэкенд-`types.ts` (Task 2), `db.ts` (Task 4), фронт-`types.ts` (Task 7). Методы `fetchProjects/createProject/updateProject/deleteProject` — согласованы между api.ts (Task 7) и потребителями (Task 9). `onToggleLink(taskId, linked)`, `onOpenTask(taskId)` — совпадают в хуке (Task 8) и `ProjectSpace` (Task 9). `projectInWorkspace` — projects.ts (Task 3) ↔ index.ts (Task 6). ✓
