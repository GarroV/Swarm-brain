# Task Assignment Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить роли пользователей (marketing/bd/rnd), матчинг по почте/псевдонимам/имени через GPT, назначение задач нескольким исполнителям по логике роль+страна.

**Architecture:** Фиксированный enum ролей в `user_profiles` и `tasks`. GPT-резолюция исполнителей в промпте экстракции — передаём полные профили, получаем `assignee_ids[]` + `task_role`. Серверная функция `resolveAssignees` реализует каскадную логику: имя → роль+страна → страна → общий пул. `assignee_telegram_id` (int4) заменяется на `assignee_telegram_ids` (int4[]).

**Tech Stack:** Deno, Supabase Edge Functions, PostgreSQL, OpenAI GPT-4o-mini

---

## File Map

| Файл | Что меняется |
|------|-------------|
| `supabase/migrations/20260528120000_task_assignment_roles.sql` | CREATE — новые поля + миграция данных |
| `supabase/functions/swarm-bot/tasks/types.ts` | Task, TaskInput — новые поля |
| `supabase/functions/swarm-bot/tasks/matcher.ts` | UserProfile + email/aliases, resolveAssignees |
| `supabase/functions/swarm-bot/tasks/db.ts` | dbCreateTask, dbListTasks, dbUpdateTask |
| `supabase/functions/swarm-bot/tasks/handlers.ts` | analyzeAndCreateTasks промпт + callbacks |
| `supabase/functions/swarm-mcp/tasks/tools.ts` | matchAssignee + email/aliases, task_role в schema |
| `CHANGELOG.md` | Запись о фиче |
| `README.md` | Секция о ролях |

---

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260528120000_task_assignment_roles.sql`

- [ ] **Создать файл миграции**

```sql
-- user_profiles: роль, почта, псевдонимы
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS role         text CHECK (role IN ('marketing', 'bd', 'rnd')),
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS name_aliases text[] NOT NULL DEFAULT '{}';

-- tasks: роль задачи + массив исполнителей
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_role             text CHECK (task_role IN ('marketing', 'bd', 'rnd')),
  ADD COLUMN IF NOT EXISTS assignee_telegram_ids int4[] NOT NULL DEFAULT '{}';

-- Перенести существующие данные в массив
UPDATE tasks
  SET assignee_telegram_ids = ARRAY[assignee_telegram_id]
  WHERE assignee_telegram_id IS NOT NULL;

-- Убрать старое поле
ALTER TABLE tasks DROP COLUMN IF EXISTS assignee_telegram_id;
```

- [ ] **Применить миграцию**

```bash
supabase db push
```

Ожидаем: `Applying migration 20260528120000_task_assignment_roles.sql... ok`

- [ ] **Проверить схему**

```bash
supabase db diff
```

Ожидаем: пустой diff (миграция уже применена).

- [ ] **Коммит**

```bash
git add supabase/migrations/20260528120000_task_assignment_roles.sql
git commit -m "feat(db): add role/email/aliases to user_profiles, task_role + assignee_telegram_ids[] to tasks"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/types.ts`

- [ ] **Обновить типы**

Заменить весь файл:

```typescript
export type Task = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_ids: number[];
  due_date: string | null;
  tags: string[];
  country: string | null;
  task_role: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  meeting_id: string | null;
  url: string | null;
};

export type TaskInput = {
  title: string;
  description?: string | null;
  assignees?: string[];
  assignee_telegram_ids?: number[];
  due_date?: string | null;
  tags?: string[];
  country?: string | null;
  task_role?: string | null;
  source?: string;
  status?: string;
  meeting_id?: string | null;
};
```

- [ ] **Коммит**

```bash
git add supabase/functions/swarm-bot/tasks/types.ts
git commit -m "feat(tasks): update Task and TaskInput types for array assignees and task_role"
```

---

### Task 3: matcher.ts — UserProfile, getProfilesForPrompt, resolveAssignees

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/matcher.ts`

- [ ] **Обновить UserProfile, getProfilesForPrompt, добавить resolveAssignees**

Заменить весь файл:

```typescript
import { supabase } from "../lib/supabase.ts";

export type UserProfile = {
  id: number;
  name: string;
  username: string | null;
  role: string | null;
  markets: string[];
  email: string | null;
  name_aliases: string[];
};

export async function getProfilesForPrompt(): Promise<UserProfile[]> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username, role, markets, email, name_aliases");

  return (data ?? []).map((p: {
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    role?: string;
    markets?: string[];
    email?: string;
    name_aliases?: string[];
  }) => ({
    id: p.telegram_id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.telegram_id),
    username: p.username ?? null,
    role: p.role ?? null,
    markets: p.markets ?? [],
    email: p.email ?? null,
    name_aliases: p.name_aliases ?? [],
  }));
}

export function buildProfileMap(profiles: UserProfile[]): Record<number, string> {
  return Object.fromEntries(profiles.map(p => [p.id, p.name]));
}

export async function buildDisplayNameMap(telegramIds: number[]): Promise<Record<number, string>> {
  if (!telegramIds.length) return {};
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username")
    .in("telegram_id", telegramIds);
  const map: Record<number, string> = {};
  for (const p of (data ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string; username?: string }>) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || null;
    if (name) map[p.telegram_id] = name;
  }
  return map;
}

export async function getAllUniqueMarkets(): Promise<string[]> {
  const { data } = await supabase.from("user_profiles").select("markets");
  const all = (data ?? []).flatMap((p: { markets?: string[] }) => p.markets ?? []);
  return [...new Set(all)].filter((x): x is string => Boolean(x)).sort();
}

type ExtractedTask = {
  assignee_ids?: number[];
  task_role?: string | null;
  country?: string | null;
};

export function resolveAssignees(
  profiles: UserProfile[],
  extracted: ExtractedTask,
): { assignees: string[]; assignee_telegram_ids: number[] } {
  // 1. Явные IDs от GPT
  if (extracted.assignee_ids?.length) {
    const matched = profiles.filter(p => extracted.assignee_ids!.includes(p.id));
    if (matched.length) {
      return {
        assignees: matched.map(p => p.name),
        assignee_telegram_ids: matched.map(p => p.id),
      };
    }
  }

  const country = extracted.country?.toLowerCase() ?? null;
  const matchesCountry = (p: UserProfile) =>
    country !== null && p.markets.some(m =>
      m.toLowerCase() === country ||
      m.toLowerCase().includes(country) ||
      country.includes(m.toLowerCase())
    );

  // 2. Роль + страна
  if (extracted.task_role && country) {
    const matched = profiles.filter(p => p.role === extracted.task_role && matchesCountry(p));
    if (matched.length) {
      return {
        assignees: matched.map(p => p.name),
        assignee_telegram_ids: matched.map(p => p.id),
      };
    }
  }

  // 3. Только страна
  if (country) {
    const matched = profiles.filter(matchesCountry);
    if (matched.length) {
      return {
        assignees: matched.map(p => p.name),
        assignee_telegram_ids: matched.map(p => p.id),
      };
    }
  }

  // 4 & 5. Общий пул
  return { assignees: [], assignee_telegram_ids: [] };
}
```

- [ ] **Коммит**

```bash
git add supabase/functions/swarm-bot/tasks/matcher.ts
git commit -m "feat(tasks): add email/aliases to UserProfile, add resolveAssignees with role+country cascade"
```

---

### Task 4: db.ts — массив вместо одного ID

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/db.ts`

- [ ] **Обновить db.ts**

Заменить весь файл:

```typescript
import { supabase } from "../lib/supabase.ts";
import type { Task, TaskInput } from "./types.ts";

export async function dbGetTask(id: string): Promise<Task | null> {
  const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return data as Task | null;
}

export async function dbListTasks(opts: {
  assignee?: string;
  telegramId?: number;
  country?: string;
  status?: string;
  period?: string;
  limit?: number;
}): Promise<Task[]> {
  let q = supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (opts.status) {
    q = q.eq("status", opts.status);
  } else {
    q = q.not("status", "in", '("done","cancelled","draft")');
  }

  if (opts.country) q = q.ilike("country", `%${opts.country}%`);

  if (opts.telegramId !== undefined) {
    q = q.contains("assignee_telegram_ids", [opts.telegramId]);
  }

  if (opts.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  const { data } = await q.limit(opts.limit ?? 200);
  let tasks = (data ?? []) as Task[];

  if (opts.assignee) {
    const lower = opts.assignee.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(lower)));
  }

  return tasks;
}

export async function dbCreateTask(input: TaskInput): Promise<Task> {
  const { data, error } = await supabase.from("tasks").insert({
    title: input.title,
    description: input.description ?? null,
    assignees: input.assignees ?? [],
    assignee_telegram_ids: input.assignee_telegram_ids ?? [],
    due_date: input.due_date ?? null,
    tags: input.tags ?? [],
    country: input.country ?? null,
    task_role: input.task_role ?? null,
    source: input.source ?? "manual",
    status: input.status ?? "open",
    meeting_id: input.meeting_id ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function dbUpdateTask(
  id: string,
  fields: Partial<TaskInput> & { status?: string; url?: string; due_date?: string | null },
): Promise<void> {
  await supabase.from("tasks")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function dbDeleteTask(id: string): Promise<void> {
  await supabase.from("task_history").delete().eq("task_id", id);
  await supabase.from("tasks").delete().eq("id", id);
}

export async function dbListAllOpen(): Promise<Task[]> {
  const { data } = await supabase.from("tasks").select("*")
    .not("status", "in", '("done","cancelled","draft","pending")')
    .order("assignees", { ascending: true })
    .limit(200);
  return (data ?? []) as Task[];
}
```

- [ ] **Коммит**

```bash
git add supabase/functions/swarm-bot/tasks/db.ts
git commit -m "feat(tasks): replace assignee_telegram_id with assignee_telegram_ids[] in db layer"
```

---

### Task 5: handlers.ts — обновить analyzeAndCreateTasks и callbacks

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/handlers.ts`

- [ ] **Обновить analyzeAndCreateTasks — новый промпт + resolveAssignees**

Найти функцию `analyzeAndCreateTasks` и заменить её целиком:

```typescript
export async function analyzeAndCreateTasks(content: string, chatId: number, entryId: string): Promise<void> {
  const profiles = await getProfilesForPrompt();
  const profileMap = buildProfileMap(profiles);
  const userList = JSON.stringify(profiles.map(p => ({
    id: p.id,
    name: p.name,
    aliases: p.name_aliases,
    email: p.email,
    role: p.role,
    markets: p.markets,
  })));

  const raw = await chatComplete(
    `Ты анализируешь текст командной базы знаний. Извлеки задачи — только конкретные поручения/действия.\n` +
    `Члены команды (JSON): ${userList || "[]"}\n\n` +
    `Роли команды:\n` +
    `- "marketing" — задачи по маркетингу, рекламе, соцсетям\n` +
    `- "rnd" — задачи по продукту, разработке, исследованиям\n` +
    `- "bd" — всё остальное: операционка, бизнес-процессы, сопровождение\n\n` +
    `Правила назначения:\n` +
    `1. Если упоминается конкретный человек (по имени, фамилии, псевдониму, email или сокращённому имени) — запиши его id из списка в assignee_ids\n` +
    `2. Если упоминается страна/рынок — заполни country\n` +
    `3. Если понятна роль исполнителя — заполни task_role\n` +
    `4. assignee_ids может содержать несколько id если задача явно для нескольких людей\n\n` +
    `Верни ТОЛЬКО JSON без markdown:\n` +
    `{"tasks":[{"title":"Название","assignee_ids":[123456789],"task_role":"bd или null","country":"Словения или null","due_date":"YYYY-MM-DD или null","confidence":0.9}]}\n` +
    `assignee_ids — массив полей id из списка выше, или [] если исполнитель неизвестен.\n` +
    `Создавай задачи только с confidence >= 0.7. Если задач нет — {"tasks":[]}.`,
    content.slice(0, 6000)
  );

  let tasks: Array<{
    title: string;
    assignee_ids: number[];
    task_role: string | null;
    country: string | null;
    due_date: string | null;
    confidence: number;
  }> = [];
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    tasks = (parsed.tasks ?? []).filter((t: { confidence: number }) => t.confidence >= 0.7);
  } catch { return; }
  if (!tasks.length) return;

  for (const task of tasks) {
    const { assignees, assignee_telegram_ids } = resolveAssignees(profiles, task);
    await dbCreateTask({
      title: task.title,
      assignees,
      assignee_telegram_ids,
      task_role: task.task_role ?? null,
      country: task.country ?? null,
      due_date: task.due_date ?? null,
      source: "transcript",
      status: "pending",
      meeting_id: entryId,
    });
  }

  const n = tasks.length;
  const word = n === 1 ? "задача" : n < 5 ? "задачи" : "задач";
  await sendMessage(chatId, `📋 Найдено <b>${n} ${word}</b> — проверь в <b>📋 Задачи → На подтверждении</b>.`);
}
```

Убедиться что в импортах наверху файла есть `resolveAssignees`:
```typescript
import { getProfilesForPrompt, buildProfileMap, buildDisplayNameMap, getAllUniqueMarkets, resolveAssignees } from "./matcher.ts";
```

- [ ] **Обновить callback `tat_` — заменить assignee_telegram_id на массив**

Найти строку:
```typescript
await dbUpdateTask(taskId, { assignee_telegram_id: telegramId, assignees: [assigneeName] });
```
Заменить на:
```typescript
await dbUpdateTask(taskId, { assignee_telegram_ids: [telegramId], assignees: [assigneeName] });
```

- [ ] **Обновить callback `tas_` — заменить assignee_telegram_id на массив**

Найти строку:
```typescript
await dbUpdateTask(taskId, { assignees: [name], assignee_telegram_id: targetTgId, status: "open" });
```
Заменить на:
```typescript
await dbUpdateTask(taskId, { assignees: [name], assignee_telegram_ids: [targetTgId], status: "open" });
```

- [ ] **Коммит**

```bash
git add supabase/functions/swarm-bot/tasks/handlers.ts
git commit -m "feat(tasks): GPT role-aware extraction with resolveAssignees, fix callbacks for array assignees"
```

---

### Task 6: swarm-mcp/tasks/tools.ts — email/aliases в матчинге, task_role в schema

**Files:**
- Modify: `supabase/functions/swarm-mcp/tasks/tools.ts`

- [ ] **Обновить тип TaskRow, matchAssignee и toolAddTask/toolUpdateTask**

Заменить `TaskRow` и `matchAssignee`:

```typescript
type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_ids: number[];
  due_date: string | null;
  country: string | null;
  task_role: string | null;
  source: string;
  status: string;
  created_at: string;
};

async function matchAssignee(name: string): Promise<{ telegram_id: number; display_name: string } | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username, email, name_aliases");

  if (!data?.length) return null;
  const lower = name.toLowerCase();
  const match = (data as Array<{
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    email?: string;
    name_aliases?: string[];
  }>).find(p => {
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ").toLowerCase();
    const uname = (p.username ?? "").toLowerCase();
    const email = (p.email ?? "").toLowerCase();
    const aliases = (p.name_aliases ?? []).map((a: string) => a.toLowerCase());
    return (
      fullName.includes(lower) || lower.includes(fullName) ||
      uname.includes(lower) ||
      (email && email.includes(lower)) ||
      aliases.some(a => a.includes(lower) || lower.includes(a))
    );
  });
  if (!match) return null;
  return {
    telegram_id: match.telegram_id,
    display_name: [match.first_name, match.last_name].filter(Boolean).join(" ") || match.username || String(match.telegram_id),
  };
}
```

- [ ] **Обновить toolAddTask — добавить task_role**

Найти в `toolAddTask` вставку в БД и добавить поле `task_role`:

```typescript
export async function toolAddTask(args: {
  title: string;
  description?: string;
  assignee_name?: string;
  country?: string;
  due_date?: string;
  task_role?: string;
  source: string;
  context_id?: string;
}): Promise<string> {
  const assignees: string[] = [];
  let assignee_telegram_ids: number[] = [];
  let matchWarning = "";

  if (args.assignee_name) {
    const match = await matchAssignee(args.assignee_name);
    if (match) {
      assignees.push(match.display_name);
      assignee_telegram_ids = [match.telegram_id];
    } else {
      assignees.push(args.assignee_name);
      matchWarning = " ⚠️ исполнитель не найден в профилях — записан как текст";
    }
  }

  const { data, error } = await supabase.from("tasks").insert({
    title: args.title,
    description: args.description ?? null,
    assignees,
    assignee_telegram_ids,
    country: args.country ?? null,
    due_date: args.due_date ?? null,
    task_role: args.task_role ?? null,
    source: args.source,
    status: "open",
    meeting_id: args.context_id ?? null,
    tags: [],
  }).select("id").single();

  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача создана (id: ${data.id})${matchWarning}.`;
}
```

- [ ] **Обновить toolUpdateTask — добавить task_role, заменить assignee_telegram_id**

```typescript
export async function toolUpdateTask(args: {
  id: string;
  title?: string;
  description?: string;
  assignee_name?: string;
  country?: string;
  due_date?: string | null;
  status?: string;
  task_role?: string;
}): Promise<string> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (args.title !== undefined) updates.title = args.title;
  if (args.description !== undefined) updates.description = args.description;
  if (args.country !== undefined) updates.country = args.country;
  if ("due_date" in args) updates.due_date = args.due_date ?? null;
  if (args.status !== undefined) updates.status = args.status;
  if (args.task_role !== undefined) updates.task_role = args.task_role;

  if (args.assignee_name !== undefined) {
    if (!args.assignee_name) {
      updates.assignees = [];
      updates.assignee_telegram_ids = [];
    } else {
      const match = await matchAssignee(args.assignee_name);
      if (match) {
        updates.assignees = [match.display_name];
        updates.assignee_telegram_ids = [match.telegram_id];
      } else {
        updates.assignees = [args.assignee_name];
        updates.assignee_telegram_ids = [];
      }
    }
  }

  const { error } = await supabase.from("tasks").update(updates).eq("id", args.id);
  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача обновлена.`;
}
```

- [ ] **Добавить task_role в TASK_TOOL_DEFINITIONS**

В `add_task` properties добавить:
```typescript
task_role: {
  type: "string",
  enum: ["marketing", "bd", "rnd"],
  description: "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)"
},
```

В `update_task` properties добавить то же поле.

- [ ] **Обновить toolGetTasks — убрать старое поле**

В `toolGetTasks` найти строку:
```typescript
const who = t.assignees?.join(", ") || "—";
```
Оставить как есть — `assignees` строковый массив, не меняется.

- [ ] **Коммит**

```bash
git add supabase/functions/swarm-mcp/tasks/tools.ts
git commit -m "feat(mcp): add email/aliases to matchAssignee, task_role to add_task/update_task schema"
```

---

### Task 7: Документация

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Добавить запись в CHANGELOG.md** (в начало файла, после заголовка):

```markdown
## 2026-05-28

### Задачи — роли и умное назначение
- Добавлены роли пользователей: `marketing`, `bd`, `rnd` (в `user_profiles`)
- Поле `task_role` в задачах — GPT проставляет при извлечении из транскрипта
- Поле `email` и `name_aliases` в профилях — матчинг исполнителей теперь учитывает почту и псевдонимы
- `assignee_telegram_id` → `assignee_telegram_ids[]` — задача может назначаться нескольким людям
- Каскадная резолюция исполнителя: имя → роль+страна → страна → общий пул
- Несколько BD/маркетологов в одной стране — задача уходит всем сразу
```

- [ ] **Добавить секцию в README.md** (после секции про задачи, если есть, или перед разделом про деплой):

```markdown
## Роли пользователей и назначение задач

Профили пользователей (`user_profiles`) имеют фиксированные роли:
- `marketing` — маркетинг
- `rnd` — продукт и разработка  
- `bd` — бизнес-девелопмент и операционка (catch-all)

При извлечении задач из транскрипта GPT определяет исполнителя по каскаду:
1. Конкретное имя/почта/псевдоним → конкретный человек
2. Роль + страна → все с этой ролью в этой стране
3. Только страна → все кто работает с этой страной
4. Только роль / ничего → общий пул

`email` и `name_aliases` задаются через админку профилей.
```

- [ ] **Коммит**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: document role-based task assignment in CHANGELOG and README"
```

---

### Task 8: Deploy

- [ ] **Задеплоить swarm-bot**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Ожидаем: `Deployed Functions swarm-bot`

- [ ] **Задеплоить swarm-mcp**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
```

Ожидаем: `Deployed Functions swarm-mcp`

- [ ] **Smoke test: проверить что бот отвечает**

Написать `/tasks` в боте. Ожидаем: список задач или сообщение "У тебя нет активных задач." — без ошибок.

- [ ] **Smoke test: проверить /tasks все**

Написать `/tasks все`. Ожидаем: все открытые задачи сгруппированные по исполнителю.
