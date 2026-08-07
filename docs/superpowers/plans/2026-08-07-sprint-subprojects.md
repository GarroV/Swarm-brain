# Sprint Subprojects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать проекту на доске «Спринт» возможность содержать вложенные подпроекты, у каждого — свой канбан, в единой рамке группы.

**Architecture:** Самоссылка `projects.parent_id` (ровно 2 уровня). Верхнеуровневый проект с детьми = группа; без детей = обычная секция (как сейчас). Задачи остаются на `tasks.project_id`; прямые задачи группы рендерятся в ряду «Общее». Валидация вложенности — чистая функция в `_shared/tasks/projects.ts`, покрытая Deno-тестами.

**Tech Stack:** Postgres (миграция), Supabase Edge Functions (Deno + TypeScript), Next.js/React miniapp, Deno std assert для тестов.

## Global Constraints

- Ветка: `feat/sprint-subprojects` (git worktree `.claude/worktrees/sprint-subprojects`). Слить в `main` по готовности.
- Миграции: только аддитивный `ADD COLUMN` (безопасно); прогон локально `supabase db reset` перед прод.
- `deno check` затронутых edge-функций обязателен (pre-commit хук `.githooks/pre-commit`; красный не коммитим).
- Новый пользовательский текст — двуязычно через `dt()` (EN приоритет).
- `swarm-api/index.ts` содержит null-байт (issue #9) → искать по нему `rg -a`, не bash-grep.
- Доступ к БД для проверки: prod ref `vbqglndbxkpmreccpqmr` (или локально `supabase start`).
- Тесты Deno: `deno test <file>` из `supabase/functions/`; assert из `https://deno.land/std@0.224.0/assert/mod.ts`.

---

### Task 1: Миграция — `projects.parent_id`

**Files:**
- Create: `supabase/migrations/20260807120000_project_subprojects.sql`

**Interfaces:**
- Produces: колонка `public.projects.parent_id uuid null` (FK на `projects.id`, `on delete set null`) + индекс `idx_projects_parent`.

- [ ] **Step 1: Написать миграцию**

```sql
-- Вложенные подпроекты на доске «Спринт»: самоссылка проекта на родителя.
-- Ровно 2 уровня (группа → подпроект) — глубину гарантирует валидация в API.
-- Аддитивно и безопасно (ADD COLUMN). on delete set null: удаление группы
-- поднимает подпроекты на верхний уровень (данные не теряются).
alter table public.projects
  add column if not exists parent_id uuid references public.projects(id) on delete set null;
create index if not exists idx_projects_parent on public.projects(parent_id);
```

- [ ] **Step 2: Прогнать локально**

Run: `supabase db reset`
Expected: применяется без ошибок; `\d public.projects` показывает `parent_id` и индекс `idx_projects_parent`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807120000_project_subprojects.sql
git commit -m "feat(projects): миграция parent_id для вложенных подпроектов"
```

---

### Task 2: Тип `parent_id` + чистая валидация вложенности

**Files:**
- Modify: `supabase/functions/_shared/tasks/types.ts` (тип `Project`, `ProjectInput`)
- Modify: `supabase/functions/_shared/tasks/projects.ts` (добавить `validateParent`)
- Create: `supabase/functions/_shared/tasks/projects.test.ts`

**Interfaces:**
- Produces:
  - `Project.parent_id: string | null`
  - `ProjectInput.parent_id?: string | null`
  - `type ProjectRef = { id: string; parent_id: string | null }`
  - `validateParent(input: { projectId: string | null; parentId: string | null; all: ProjectRef[] }): { ok: true } | { ok: false; error: string }`
    - `projectId` — редактируемый проект (`null` при создании); `parentId` — желаемый родитель; `all` — все проекты воркспейса.
    - Правила: `parentId===null` → ok; иначе родитель должен существовать в `all`, быть верхнеуровневым (`parent_id===null`), не равняться `projectId`; редактируемый `projectId` не должен иметь детей в `all`. Иначе `{ ok:false, error }`.

- [ ] **Step 1: Написать падающий тест**

```ts
// Запуск: deno test supabase/functions/_shared/tasks/projects.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateParent } from "./projects.ts";

const A = { id: "a", parent_id: null };          // группа-кандидат (верхний уровень)
const B = { id: "b", parent_id: null };          // обычный проект (верхний уровень)
const C = { id: "c", parent_id: "a" };           // подпроект A
const all = [A, B, C];

Deno.test("validateParent: null родитель → ok (верхний уровень)", () => {
  assertEquals(validateParent({ projectId: "b", parentId: null, all }), { ok: true });
});

Deno.test("validateParent: вложить B под верхнеуровневый A → ok", () => {
  assertEquals(validateParent({ projectId: "b", parentId: "a", all }), { ok: true });
});

Deno.test("validateParent: родитель не существует → ошибка", () => {
  assertEquals(validateParent({ projectId: "b", parentId: "zzz", all }).ok, false);
});

Deno.test("validateParent: родитель сам подпроект (>2 уровня) → ошибка", () => {
  assertEquals(validateParent({ projectId: "b", parentId: "c", all }).ok, false);
});

Deno.test("validateParent: сам себе родитель → ошибка", () => {
  assertEquals(validateParent({ projectId: "a", parentId: "a", all }).ok, false);
});

Deno.test("validateParent: у проекта есть дети — нельзя делать подпроектом → ошибка", () => {
  assertEquals(validateParent({ projectId: "a", parentId: "b", all }).ok, false);
});

Deno.test("validateParent: создание (projectId=null) под верхнеуровневым → ok", () => {
  assertEquals(validateParent({ projectId: null, parentId: "a", all }), { ok: true });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `deno test supabase/functions/_shared/tasks/projects.test.ts`
Expected: FAIL — `validateParent` не экспортирован.

- [ ] **Step 3: Добавить типы и `validateParent`**

В `types.ts` — в тип `Project` добавить `parent_id: string | null;`, в `ProjectInput` добавить `parent_id?: string | null;`.

В `projects.ts` (верх файла, после импортов):

```ts
export type ProjectRef = { id: string; parent_id: string | null };

// Валидация вложенности проектов (ровно 2 уровня: группа → подпроект).
// Чистая, без БД: `all` — все проекты воркспейса. Вызывается create/updateProject.
export function validateParent(input: {
  projectId: string | null;
  parentId: string | null;
  all: ProjectRef[];
}): { ok: true } | { ok: false; error: string } {
  const { projectId, parentId, all } = input;
  if (parentId === null) return { ok: true };
  if (parentId === projectId) return { ok: false, error: "проект не может быть родителем самому себе" };
  const parent = all.find((p) => p.id === parentId);
  if (!parent) return { ok: false, error: "родитель не найден в воркспейсе" };
  if (parent.parent_id !== null) return { ok: false, error: "нельзя вкладывать глубже 2 уровней" };
  if (projectId !== null && all.some((p) => p.parent_id === projectId)) {
    return { ok: false, error: "у проекта есть подпроекты — его нельзя делать подпроектом" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `deno test supabase/functions/_shared/tasks/projects.test.ts`
Expected: PASS (все кейсы).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/tasks/types.ts supabase/functions/_shared/tasks/projects.ts supabase/functions/_shared/tasks/projects.test.ts
git commit -m "feat(projects): тип parent_id + чистая валидация вложенности validateParent"
```

---

### Task 3: CRUD — прокинуть `parent_id` в listProjects/create/update

**Files:**
- Modify: `supabase/functions/_shared/tasks/projects.ts` (`listProjects`, `createProject`, `updateProject`)

**Interfaces:**
- Consumes: `validateParent`, `ProjectInput.parent_id` (Task 2).
- Produces:
  - `createProject` вставляет `parent_id` и валидирует его (бросает `Error` при невалидном).
  - `updateProject` при наличии `parent_id` в fields валидирует и обновляет.
  - `listProjects` возвращает `parent_id` (select `*` уже его отдаёт — убедиться, что тип не режет).

- [ ] **Step 1: Обновить `createProject`**

В `createProject` перед `insert` — если `input.parent_id` задан, подгрузить refs и провалидировать:

```ts
export async function createProject(
  input: ProjectInput,
  groupId: string,
  createdBy: number | null,
): Promise<Project> {
  const parentId = input.parent_id ?? null;
  if (parentId !== null) {
    const { data: refs } = await supabase
      .from("projects").select("id, parent_id").eq("group_id", groupId);
    const v = validateParent({ projectId: null, parentId, all: (refs ?? []) as ProjectRef[] });
    if (!v.ok) throw new Error(v.error);
  }
  const { data, error } = await supabase.from("projects").insert({
    group_id: groupId,
    name: input.name,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    parent_id: parentId,
    created_by: createdBy,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Project;
}
```

- [ ] **Step 2: Обновить `updateProject`**

Разрешить `parent_id` в fields и валидировать:

```ts
export async function updateProject(
  id: string,
  fields: Partial<ProjectInput>,
  groupId: string,
): Promise<Project | null> {
  if ("parent_id" in fields) {
    const { data: refs } = await supabase
      .from("projects").select("id, parent_id").eq("group_id", groupId);
    const v = validateParent({ projectId: id, parentId: fields.parent_id ?? null, all: (refs ?? []) as ProjectRef[] });
    if (!v.ok) throw new Error(v.error);
  }
  const { data } = await supabase.from("projects")
    .update(fields)
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as Project | null) ?? null;
}
```

- [ ] **Step 3: Проверить `listProjects`** — селект `*` (строка 22 файла) уже возвращает `parent_id`; тип `ProjectWithCounts` наследует `Project`, значит поле пройдёт. Изменений кода не требуется, только визуальная сверка.

- [ ] **Step 4: Type-check**

Run: `cd supabase/functions/swarm-api && deno check index.ts`
Expected: `Check index.ts` без ошибок (импортирует projects.ts).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/tasks/projects.ts
git commit -m "feat(projects): parent_id в create/update с валидацией вложенности"
```

---

### Task 4: Роуты `/projects` — принять и провалидировать `parent_id`

**Files:**
- Modify: `supabase/functions/swarm-api/index.ts` (POST `/projects` ~L891-903; PATCH `/projects/:id` ~L910-919)

**Interfaces:**
- Consumes: `createProject`/`updateProject` бросают `Error` с текстом при невалидном `parent_id`.
- Produces: POST/PATCH принимают `parent_id`; ошибку валидации мапят в HTTP 400.

- [ ] **Step 1: POST `/projects` — принять `parent_id` и ловить ошибку валидации**

Найти блок через `rg -na '"/projects"' supabase/functions/swarm-api/index.ts`. В сборке `input` добавить `parent_id`, а `createProject` обернуть в try/catch → 400:

```ts
const input: ProjectInput = {
  name: body.name.trim(),
  color: (body.color as string | null) ?? null,
  emoji: (body.emoji as string | null) ?? null,
  parent_id: (body.parent_id as string | null) ?? null,
};
try {
  return json(await createProject(input, groupId, telegram_id ?? null), 201, origin);
} catch (e) {
  return apiErr(400, e instanceof Error ? e.message : "invalid parent", origin);
}
```

- [ ] **Step 2: PATCH `/projects/:id` — принять `parent_id` и ловить ошибку**

В сборке `fields` добавить приём `parent_id`, вызов `updateProject` обернуть в try/catch:

```ts
if ("parent_id" in body) fields.parent_id = (body.parent_id as string | null) ?? null;
let updated;
try {
  updated = await updateProject(projectId, fields, groupId);
} catch (e) {
  return apiErr(400, e instanceof Error ? e.message : "invalid parent", origin);
}
if (!updated) return apiErr(404, "Not found", origin);
return json(updated, 200, origin);
```

- [ ] **Step 3: Type-check**

Run: `cd supabase/functions/swarm-api && deno check index.ts`
Expected: `Check index.ts` без ошибок.

- [ ] **Step 4: Смоук эндпоинта локально**

Run (при поднятом `supabase start`, с валидной сессией):
`POST /projects {"name":"Sub","parent_id":"<id верхнего проекта>"}` → 201 с `parent_id`.
`POST /projects {"name":"Bad","parent_id":"<id подпроекта>"}` → 400.
Expected: как указано.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(projects): роуты POST/PATCH принимают parent_id (валидация → 400)"
```

---

### Task 5: miniapp API + DEV_MODE-моки

**Files:**
- Modify: `miniapp/src/types.ts` (`Project.parent_id`)
- Modify: `miniapp/src/lib/api.ts` (`createProject`/`updateProject` сигнатуры + `mockProjects` вложенный пример)

**Interfaces:**
- Consumes: серверные POST/PATCH `/projects` принимают `parent_id` (Task 4).
- Produces:
  - `Project.parent_id: string | null`
  - `createProject(input: { name: string; color?: string | null; emoji?: string | null; parent_id?: string | null })`
  - `updateProject(id, fields: Partial<{ name; color; emoji; parent_id: string | null }>)`

- [ ] **Step 1: Тип `Project`** — в `miniapp/src/types.ts` в тип `Project` добавить `parent_id: string | null;`.

- [ ] **Step 2: `createProject`/`updateProject`** в `api.ts` — расширить сигнатуры полем `parent_id`; в DEV_MODE-ветке класть `parent_id: input.parent_id ?? null` в мок; проброс в теле fetch уже идёт через `JSON.stringify(input/fields)`.

- [ ] **Step 3: DEV_MODE-моки** — в `mockProjects` (api.ts ~L481) добавить группу с подпроектами и «висящую» задачу группы, чтобы демо показывало фичу без авторизации:

```ts
let mockProjects: Project[] = [
  { id: "pr1", group_id: "cee", name: "Вайб код проекты", color: null, emoji: null, parent_id: null, created_by: null, created_at: new Date().toISOString(), task_count: 3, backlog_count: 1 },
  { id: "pr1a", group_id: "cee", name: "Бот по стройкам", color: null, emoji: null, parent_id: "pr1", created_by: null, created_at: new Date().toISOString(), task_count: 2, backlog_count: 1 },
  { id: "pr1b", group_id: "cee", name: "Дизайн-терминал", color: null, emoji: null, parent_id: "pr1", created_by: null, created_at: new Date().toISOString(), task_count: 1, backlog_count: 0 },
  { id: "pr2", group_id: "cee", name: "тест-2", color: null, emoji: null, parent_id: null, created_by: null, created_at: new Date().toISOString(), task_count: 0, backlog_count: 0 },
];
```

(Если у мок-задач есть `project_id`, привязать пару к `pr1a`/`pr1b` для наглядного канбана.)

- [ ] **Step 4: Build-check**

Run: `cd miniapp && npm run build`
Expected: сборка без ошибок типов.

- [ ] **Step 5: Commit**

```bash
git add miniapp/src/types.ts miniapp/src/lib/api.ts
git commit -m "feat(sprint): miniapp API + DEV_MODE-моки для вложенных подпроектов"
```

---

### Task 6: SprintBoard — дерево, рамка-группа, ряды подпроектов, «Общее»

**Files:**
- Modify: `miniapp/src/components/tasks/SprintBoard.tsx`

**Interfaces:**
- Consumes: `Project.parent_id`, `createProject({ name, parent_id })` (Task 5).
- Produces: доска рендерит группы с вложенными рядами-подпроектами; «+ Подпроект» в заголовке группы.

- [ ] **Step 1: Извлечь чистый билдер дерева**

В начале компонента (или рядом, до `return`) построить структуру:

```tsx
// Верхний уровень + его подпроекты. Проект без детей рендерится как обычная секция.
const topLevel = projects.filter((p) => !p.parent_id);
const childrenOf = (id: string) => projects.filter((p) => p.parent_id === id);
```

- [ ] **Step 2: Вынести рендер одного канбан-ряда в под-компонент**

Извлечь текущий рендер «4 колонки для набора задач» в локальную функцию/компонент `KanbanRow({ tasks, sectionId, label })`, где `sectionId` — id (под)проекта или `NO_SECTION`, а `tasks` — задачи этого ряда. Это переиспользуется и для обычной секции, и для ряда подпроекта, и для «Общее». Drag/quick-add работают по `sectionId` как сейчас (`applyDrop(taskId, sectionId, status)`).

- [ ] **Step 3: Рендер группы (рамка + ряды)**

Для каждого `sec` из `topLevel`:
- `const kids = childrenOf(sec.id);`
- если `kids.length === 0` → рендерить как сейчас (одна секция, `KanbanRow` c задачами `project_id === sec.id`, для «Без секции» — `!project_id`).
- если `kids.length > 0` → **рамка-группа**: заголовок (имя, суммарный счётчик = задачи всех kids + прямые задачи группы, сворачивание, «+ Подпроект», переименовать, удалить). Внутри, если развёрнуто:
  - прямые задачи группы (`project_id === sec.id`) — если есть, ряд с меткой `dt("Общее","General")` (тонкий разделитель);
  - по каждому `kid` — `KanbanRow` c задачами `project_id === kid.id`, метка = имя подпроекта, тонкий разделитель сверху; действия подпроекта (переименовать/удалить/«+ задача»).

Тонкий разделитель — `border-t border-line` на рядах кроме первого; вся группа — существующий стиль `section` (`rounded-2xl border border-line`), подпроекты БЕЗ собственной внешней рамки (единая рамка группы).

- [ ] **Step 4: «+ Подпроект»**

Кнопка в заголовке группы открывает тот же inline-инпут, что и «+ Секция», но вызывает `createProject({ name, parent_id: sec.id })` и добавляет в `projects`. Свернуть/развернуть — локальный `useState<Set<string>>` свёрнутых id (по умолчанию пусто = развёрнуто).

- [ ] **Step 5: Build-check**

Run: `cd miniapp && npm run build`
Expected: сборка без ошибок.

- [ ] **Step 6: Смоук в браузере (DEV_MODE)**

Run: `cd miniapp && npm run dev`, открыть доску «Спринт».
Expected: группа «Вайб код проекты» с рамкой и двумя подпроектами-рядами, у каждого свои 4 колонки; «тест-2» — как обычная секция; создать подпроект кнопкой «+ Подпроект»; перетащить задачу между колонками подпроекта; проверить светлую и тёмную тему.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src/components/tasks/SprintBoard.tsx
git commit -m "feat(sprint): рамка-группа с вложенными подпроектами и рядом «Общее»"
```

---

### Task 7: Обновить документацию

**Files:**
- Modify: `docs/ARCHITECTURE.md` (раздел про доску Спринт/проекты)
- Modify: `docs/QUICK_REF.md` (строка про «Проекты = секции доски Спринт»)

**Interfaces:**
- Consumes: финальное поведение из Task 1-6.

- [ ] **Step 1: QUICK_REF** — обновить запись «Проекты = секции доски Спринт»: добавить, что проект может быть группой с подпроектами через `projects.parent_id` (2 уровня), канбан у подпроекта, ряд «Общее» для прямых задач группы. Сверять с кодом, не по памяти.

- [ ] **Step 2: ARCHITECTURE** — в описании доски/таблиц отразить `projects.parent_id` (FK self, on delete set null), новый уровень группировки и рендер.

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/QUICK_REF.md
git commit -m "docs(sprint): вложенные подпроекты — parent_id, группы, ряд «Общее»"
```

---

## Self-Review

**Spec coverage:** §2 данные → Task 1-2; §3 совместимость → Task 3/6 (пустые дети = обычная секция); §4 API → Task 3-4; §5 UI → Task 5-6; §6 вне-v1 — не реализуем (осознанно); §8 проверка → шаги смоука/build/deno-test в задачах; §7 декомпозиция ↔ задачи; docs (правило проекта) → Task 7.

**Placeholder scan:** код в шагах реальный; смоук-шаги содержат конкретные ожидаемые результаты.

**Type consistency:** `validateParent({ projectId, parentId, all })` и `ProjectRef` едины в Task 2/3; `Project.parent_id`/`ProjectInput.parent_id` едины в Task 2 (backend) и Task 5 (miniapp — отдельный тип, то же поле); `KanbanRow({ tasks, sectionId, label })` и `childrenOf`/`topLevel` едины в Task 6.

## Известные развилки при исполнении

- Прод-проверка — на реальном окружении ПЕРЕД раскаткой (правило проекта): локальный `supabase start` → аккуратно прод. На команду — только после подтверждения.
- Потребители `_shared/tasks/*` (swarm-bot, swarm-mcp) — `parent_id` для них новое опциональное поле; убедиться, что их `deno check` не краснеет (входит в pre-commit).
