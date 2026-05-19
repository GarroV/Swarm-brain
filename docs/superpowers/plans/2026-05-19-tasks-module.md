# Tasks Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor task logic into an isolated `tasks/` module inside `swarm-bot`, add `/addtask` dialog, add `add_task`/`update_task`/`delete_task` MCP tools, and extend the schema with `description`, `source`, `country`, `assignee_telegram_id`.

**Architecture:** Bot task logic moves from monolithic `handlers/tasks.ts` into `swarm-bot/tasks/` (types → db → matcher → formatter → handlers → index). MCP gains 3 new task tools in `swarm-mcp/tasks/tools.ts`. Both functions share the same Supabase `tasks` table. The `swarm-bot/index.ts` only imports from `./tasks/index.ts` — no task logic in the main file.

**Tech Stack:** Deno, TypeScript, Supabase Edge Functions, Supabase JS SDK, OpenAI gpt-4o-mini

---

## File Map

| Action | Path |
|--------|------|
| Create | `supabase/functions/swarm-bot/tasks/types.ts` |
| Create | `supabase/functions/swarm-bot/tasks/db.ts` |
| Create | `supabase/functions/swarm-bot/tasks/matcher.ts` |
| Create | `supabase/functions/swarm-bot/tasks/formatter.ts` |
| Create | `supabase/functions/swarm-bot/tasks/handlers.ts` |
| Create | `supabase/functions/swarm-bot/tasks/index.ts` |
| Create | `supabase/functions/swarm-mcp/tasks/tools.ts` |
| Modify | `supabase/functions/swarm-bot/index.ts` |
| Modify | `supabase/functions/swarm-bot/handlers/users.ts` |
| Modify | `supabase/functions/swarm-bot/handlers/knowledge.ts` |
| Modify | `supabase/functions/swarm-mcp/index.ts` |
| Delete | `supabase/functions/swarm-bot/handlers/tasks.ts` |

---

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/20260519_tasks_columns.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260519_tasks_columns.sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS country     text,
  ADD COLUMN IF NOT EXISTS assignee_telegram_id bigint;
```

- [ ] **Step 2: Apply migration via Supabase CLI**

```bash
supabase db push
```

Expected output: migration applied, no errors. If Supabase CLI asks to confirm — confirm.

- [ ] **Step 3: Verify columns exist**

```bash
supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name='tasks' ORDER BY column_name;"
```

Expected: `assignee_telegram_id`, `country`, `description`, `source` appear in the list.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260519_tasks_columns.sql
git commit -m "feat: add description, source, country, assignee_telegram_id to tasks"
```

---

### Task 2: `tasks/types.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/tasks/types.ts`

- [ ] **Step 1: Create the file**

```ts
export type Task = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_id: number | null;
  due_date: string | null;
  tags: string[];
  country: string | null;
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
  assignee_telegram_id?: number | null;
  due_date?: string | null;
  tags?: string[];
  country?: string | null;
  source?: string;
  status?: string;
  meeting_id?: string | null;
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/types.ts
git commit -m "feat: add tasks/types.ts"
```

---

### Task 3: `tasks/db.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/tasks/db.ts`

- [ ] **Step 1: Create the file**

```ts
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

  if (opts.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  const { data } = await q.limit(opts.limit ?? 200);
  let tasks = (data ?? []) as Task[];

  if (opts.telegramId !== undefined) {
    tasks = tasks.filter(t => t.assignee_telegram_id === opts.telegramId);
  } else if (opts.assignee) {
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
    assignee_telegram_id: input.assignee_telegram_id ?? null,
    due_date: input.due_date ?? null,
    tags: input.tags ?? [],
    country: input.country ?? null,
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

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/db.ts
git commit -m "feat: add tasks/db.ts with typed Supabase queries"
```

---

### Task 4: `tasks/matcher.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/tasks/matcher.ts`

- [ ] **Step 1: Create the file**

```ts
import { supabase } from "../lib/supabase.ts";

export type UserProfile = {
  id: number;
  name: string;
  username: string | null;
  role: string | null;
  markets: string[];
};

export async function getProfilesForPrompt(): Promise<UserProfile[]> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username, role, markets");

  return (data ?? []).map((p: {
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    role?: string;
    markets?: string[];
  }) => ({
    id: p.telegram_id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.telegram_id),
    username: p.username ?? null,
    role: p.role ?? null,
    markets: p.markets ?? [],
  }));
}

export function buildProfileMap(profiles: UserProfile[]): Record<number, string> {
  return Object.fromEntries(profiles.map(p => [p.id, p.name]));
}

export async function getAllUniqueMarkets(): Promise<string[]> {
  const { data } = await supabase.from("user_profiles").select("markets");
  const all = (data ?? []).flatMap((p: { markets?: string[] }) => p.markets ?? []);
  return [...new Set(all)].filter(Boolean).sort();
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/matcher.ts
git commit -m "feat: add tasks/matcher.ts for user profile lookup"
```

---

### Task 5: `tasks/formatter.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/tasks/formatter.ts`

- [ ] **Step 1: Create the file**

```ts
import { sendInlineMessage } from "../lib/telegram.ts";
import type { Task } from "./types.ts";

export const STATUS_LABEL: Record<string, string> = {
  pending:     "⏳ На подтверждении",
  open:        "📌",
  in_progress: "🔄",
  done:        "✅",
  cancelled:   "❌",
  draft:       "📝",
};

function formatDue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due + "T12:00:00");
  return `📅 до ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
}

export function formatTaskLine(task: Task): string {
  const country = task.country ? `🌍 ${task.country}` : "";
  const due = formatDue(task.due_date);
  const meta = [country, due].filter(Boolean).join(" | ");
  return [`📌 <b>${task.title}</b>`, meta].filter(Boolean).join("\n");
}

export async function sendTaskCard(chatId: number, task: Task): Promise<void> {
  const who = task.assignees?.length ? `👤 ${task.assignees.join(", ")}` : "";
  const country = task.country ? `🌍 ${task.country}` : "";
  const due = formatDue(task.due_date);
  const meta = [who, country, due].filter(Boolean).join(" | ");
  const text = [`📌 <b>${task.title}</b>`, meta].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, text, [[
    { text: "✅ Готово", callback_data: `ts_${task.id}_done` },
    { text: "🗑 Удалить", callback_data: `tdc_${task.id}` },
    { text: "📅 Дедлайн", callback_data: `tdate_${task.id}` },
  ]]);
}

export async function sendPendingTaskCard(chatId: number, task: Task): Promise<void> {
  const who = task.assignees?.length ? `👤 ${task.assignees.join(", ")}` : "";
  const due = formatDue(task.due_date);
  const meta = [who, due].filter(Boolean).join(" · ");
  const text = [`⏳ <b>${task.title}</b>`, meta].filter(Boolean).join("\n");

  await sendInlineMessage(chatId, text, [[
    { text: "✅ Подтвердить", callback_data: `tc_${task.id}` },
    { text: "👤 Назначить", callback_data: `ta_${task.id}` },
    { text: "🗑 Удалить", callback_data: `tdc_${task.id}` },
  ]]);
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/formatter.ts
git commit -m "feat: add tasks/formatter.ts with ТЗ card format"
```

---

### Task 6: `tasks/handlers.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/tasks/handlers.ts`

This replaces `handlers/tasks.ts` entirely. Contains all bot command handlers, callback handlers, and session input handlers.

- [ ] **Step 1: Create the file (part 1 — imports, constants, /tasks command)**

```ts
import { supabase, ADMIN_USER_ID } from "../lib/supabase.ts";
import { chatComplete } from "../lib/openai.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import { dbGetTask, dbListTasks, dbCreateTask, dbUpdateTask, dbDeleteTask, dbListAllOpen } from "./db.ts";
import { getProfilesForPrompt, buildProfileMap, getAllUniqueMarkets } from "./matcher.ts";
import { sendTaskCard, sendPendingTaskCard, STATUS_LABEL, formatTaskLine } from "./formatter.ts";
import type { Task } from "./types.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export const TASK_KEYWORDS = /задач|таск|task|сделать|выполнить|поручен|назначен|дедлайн|deadline|кто должен/i;

export { sendTaskCard };

export async function handleTasks(chatId: number, userId: number, filter: string): Promise<void> {
  const sub = filter.trim().toLowerCase();

  if (!sub) {
    // My tasks — filter by assignee_telegram_id
    const allMine = await dbListTasks({ telegramId: userId, limit: 200 });
    const pending = allMine.filter(t => t.status === "pending");
    const active = allMine.filter(t => !["pending", "done", "cancelled", "draft"].includes(t.status));

    if (!allMine.length) {
      await sendMessage(chatId, "У тебя нет активных задач. 🎉");
      return;
    }
    if (pending.length) {
      await sendMessage(chatId, `<b>⏳ На подтверждении: ${pending.length}</b>`);
      for (const t of pending) await sendPendingTaskCard(chatId, t);
    }
    if (active.length) {
      await sendMessage(chatId, `<b>📋 Мои задачи: ${active.length}</b>`);
      for (const t of active.slice(0, 15)) await sendTaskCard(chatId, t);
    }
    return;
  }

  if (sub === "все" || sub === "all") {
    const tasks = await dbListAllOpen();
    if (!tasks.length) { await sendMessage(chatId, "Открытых задач нет."); return; }

    const groups: Map<string, Task[]> = new Map();
    const noAssignee: Task[] = [];
    for (const t of tasks) {
      if (!t.assignees?.length) { noAssignee.push(t); continue; }
      const key = t.assignees[0];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }

    const lines: string[] = [`<b>📋 Все задачи (${tasks.length})</b>`];
    for (const [assignee, atasks] of groups) {
      lines.push(`\n<b>👤 ${assignee} (${atasks.length})</b>`);
      for (const t of atasks.slice(0, 10)) lines.push(formatTaskLine(t));
    }
    if (noAssignee.length) {
      lines.push(`\n<b>❓ Без исполнителя (${noAssignee.length})</b>`);
      for (const t of noAssignee.slice(0, 5)) lines.push(formatTaskLine(t));
    }
    await sendMessage(chatId, lines.join("\n"));
    return;
  }

  // Search by person name
  const tasks = await dbListTasks({ assignee: filter.trim(), limit: 200 });
  if (!tasks.length) { await sendMessage(chatId, `Задач для <b>${filter.trim()}</b> не найдено.`); return; }
  await sendMessage(chatId, `<b>👤 ${filter.trim()}: ${tasks.length} задач</b>`);
  for (const t of tasks.slice(0, 15)) await sendTaskCard(chatId, t);
}
```

- [ ] **Step 2: Append /addtask handler**

Append to `handlers.ts`:

```ts
export async function handleAddTask(chatId: number): Promise<void> {
  await setSession(chatId, "addtask_title");
  await sendMessage(chatId, "📌 <b>Новая задача</b>\n\nНазвание задачи?");
}
```

- [ ] **Step 3: Append analyzeAndCreateTasks**

Append to `handlers.ts`:

```ts
export async function analyzeAndCreateTasks(content: string, chatId: number, entryId: string): Promise<void> {
  const profiles = await getProfilesForPrompt();
  const profileMap = buildProfileMap(profiles);
  const userList = JSON.stringify(profiles.map(p => ({
    id: p.id, name: p.name, username: p.username, role: p.role, markets: p.markets,
  })));

  const raw = await chatComplete(
    `Ты анализируешь текст командной базы знаний. Извлеки задачи — только конкретные поручения/действия.\n` +
    `Члены команды (JSON): ${userList || "[]"}\n` +
    `Если в тексте упоминается страна/рынок — назначь задачу ответственному за этот рынок по полю markets.\n` +
    `Верни ТОЛЬКО JSON без markdown:\n` +
    `{"tasks":[{"title":"Название","assignee_id":123456789,"country":"Словения или null","due_date":"YYYY-MM-DD или null","confidence":0.9}]}\n` +
    `assignee_id — поле id из списка выше, или null если исполнитель неизвестен.\n` +
    `Создавай задачи только с confidence >= 0.7. Если задач нет — {"tasks":[]}.`,
    content.slice(0, 6000)
  );

  let tasks: Array<{ title: string; assignee_id: number | null; country: string | null; due_date: string | null; confidence: number }> = [];
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    tasks = (parsed.tasks ?? []).filter((t: { confidence: number }) => t.confidence >= 0.7);
  } catch { return; }
  if (!tasks.length) return;

  for (const task of tasks) {
    const assignees: string[] = [];
    let assignee_telegram_id: number | null = null;
    if (task.assignee_id != null && profileMap[task.assignee_id]) {
      assignees.push(profileMap[task.assignee_id]);
      assignee_telegram_id = task.assignee_id;
    }
    await dbCreateTask({
      title: task.title,
      assignees,
      assignee_telegram_id,
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

- [ ] **Step 4: Append smartTaskSearch**

Append to `handlers.ts`:

```ts
export async function smartTaskSearch(chatId: number, question: string): Promise<boolean> {
  if (!TASK_KEYWORDS.test(question)) return false;

  const raw = await chatComplete(
    `Из вопроса извлеки фильтр. Верни JSON: {"person":"Имя или null","country":"Страна или null","period":"week/null"}\nТолько JSON.`,
    question
  );

  let person: string | null = null;
  let country: string | null = null;
  let period: string | null = null;
  try {
    const p = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    person = p.person && p.person !== "null" ? p.person : null;
    country = p.country && p.country !== "null" ? p.country : null;
    period = p.period && p.period !== "null" ? p.period : null;
  } catch { /* ignore */ }

  const tasks = await dbListTasks({ assignee: person ?? undefined, country: country ?? undefined, period: period ?? undefined, limit: 10 });
  if (!tasks.length) return false;

  const lines = tasks.map(t => {
    const who = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` · до ${t.due_date}` : "";
    const c = t.country ? ` · ${t.country}` : "";
    return `• ${t.title} (${who}${due}${c})`;
  }).join("\n");

  await sendMessage(chatId, `<b>Задачи по запросу:</b>\n\n${lines}`);
  return true;
}
```

- [ ] **Step 5: Append handleTaskCallbacks**

Append to `handlers.ts`:

```ts
export async function handleTaskCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
): Promise<boolean> {
  const data = cb.data;

  // /addtask: assignee selection
  if (data.startsWith("tat_")) {
    const parts = data.split("_");
    const taskId = parts[1];
    const telegramId = Number(parts[2]);
    const profiles = await getProfilesForPrompt();
    const profileMap = buildProfileMap(profiles);
    const assigneeName = profileMap[telegramId] ?? String(telegramId);
    await dbUpdateTask(taskId, {
      assignee_telegram_id: telegramId,
      assignees: [assigneeName],
    });
    const markets = await getAllUniqueMarkets();
    const countryButtons = markets.map(m => [{ text: `🌍 ${m}`, callback_data: `tac_${taskId}_${m}` }]);
    countryButtons.push([{ text: "❌ Без рынка", callback_data: `tac_${taskId}_none` }]);
    countryButtons.push([{ text: "🚫 Отмена", callback_data: `tacx_${taskId}` }]);
    await sendInlineMessage(chatId, "Рынок?", countryButtons);
    return true;
  }

  // /addtask: cancel
  if (data.startsWith("tacx_")) {
    const taskId = data.replace("tacx_", "");
    await dbDeleteTask(taskId);
    await clearSession(chatId);
    await sendMessage(chatId, "❌ Создание задачи отменено.");
    return true;
  }

  // /addtask: country selection
  if (data.startsWith("tac_")) {
    const rest = data.replace("tac_", "");
    const sep = rest.indexOf("_");
    const taskId = rest.slice(0, sep);
    const country = rest.slice(sep + 1);
    await dbUpdateTask(taskId, { country: country === "none" ? null : country });
    await setSession(chatId, "addtask_due", taskId);
    await sendMessage(chatId, `Дедлайн? (ДД.ММ.ГГГГ или «пропустить»)`);
    return true;
  }

  // Task confirm pending → open
  if (data.startsWith("tc_")) {
    const taskId = data.replace("tc_", "");
    const task = await dbGetTask(taskId);
    await dbUpdateTask(taskId, { status: "open" });
    await sendMessage(chatId, `✅ Подтверждено: <b>${task?.title ?? ""}</b>`);
    return true;
  }

  // Delete with confirmation
  if (data.startsWith("tdc_")) {
    const taskId = data.replace("tdc_", "");
    const task = await dbGetTask(taskId);
    await sendInlineMessage(chatId, `Удалить <b>${task?.title ?? taskId}</b>?`, [[
      { text: "✅ Да", callback_data: `tdconf_${taskId}` },
      { text: "Отмена", callback_data: `tdcanc_${taskId}` },
    ]]);
    return true;
  }
  if (data.startsWith("tdconf_")) {
    const taskId = data.replace("tdconf_", "");
    const task = await dbGetTask(taskId);
    await dbDeleteTask(taskId);
    await sendMessage(chatId, `🗑 Удалено: <b>${task?.title ?? taskId}</b>`);
    return true;
  }
  if (data.startsWith("tdcanc_")) {
    await sendMessage(chatId, "Удаление отменено.");
    return true;
  }

  // Set due date prompt
  if (data.startsWith("tdate_")) {
    const taskId = data.replace("tdate_", "");
    await setSession(chatId, "task_date", taskId);
    await sendMessage(chatId, "Новый дедлайн? (ДД.ММ.ГГГГ или «убрать»)");
    return true;
  }

  // Assign user buttons
  if (data.startsWith("ta_")) {
    const taskId = data.replace("ta_", "");
    const profiles = await getProfilesForPrompt();
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    const profileMap = buildProfileMap(profiles);
    const seen = new Set<number>();
    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null as string | null },
      ...((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>),
    ].filter(u => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; });
    const buttons = allUsers.map(u => [{
      text: profileMap[u.telegram_id] || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`),
      callback_data: `tas_${taskId}_${u.telegram_id}`,
    }]);
    await sendInlineMessage(chatId, "Кому назначить?", buttons);
    return true;
  }

  // Assign confirm
  if (data.startsWith("tas_")) {
    const rest = data.replace("tas_", "");
    const sep = rest.lastIndexOf("_");
    const taskId = rest.slice(0, sep);
    const targetTgId = Number(rest.slice(sep + 1));
    const profiles = await getProfilesForPrompt();
    const profileMap = buildProfileMap(profiles);
    const name = profileMap[targetTgId] ?? `ID ${targetTgId}`;
    await dbUpdateTask(taskId, { assignees: [name], assignee_telegram_id: targetTgId, status: "open" });
    await sendMessage(chatId, `✅ Назначено: <b>${name}</b>`);
    return true;
  }

  // Status change
  if (data.startsWith("ts_")) {
    const parts = data.split("_");
    const taskId = parts[1];
    const newStatus = parts.slice(2).join("_");
    const task = await dbGetTask(taskId);
    if (!task) { await sendMessage(chatId, "Задача не найдена."); return true; }
    await dbUpdateTask(taskId, { status: newStatus });
    await supabase.from("task_history").insert({
      task_id: taskId,
      changed_by: username,
      old_status: task.status,
      new_status: newStatus,
    });
    await sendMessage(chatId, `${STATUS_LABEL[newStatus] ?? newStatus} <b>${task.title}</b>`);
    return true;
  }

  // Task list menu
  if (data.startsWith("tl_")) {
    await handleTaskListCallback(chatId, userId, username, data.replace("tl_", ""));
    return true;
  }

  return false;
}
```

- [ ] **Step 6: Append handleTaskListCallback (existing menu for pending/done/export)**

Append to `handlers.ts`:

```ts
async function handleTaskListCallback(chatId: number, userId: number, username: string, type: string): Promise<void> {
  if (type === "pending") {
    const { data } = await supabase.from("tasks").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(15);
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Задач на подтверждении нет. ✅"); return; }
    await sendMessage(chatId, `<b>⏳ На подтверждении: ${tasks.length}</b>`);
    for (const t of tasks) await sendPendingTaskCard(chatId, t);
  } else if (type === "done") {
    const { data } = await supabase.from("tasks").select("*").eq("status", "done").order("updated_at", { ascending: false }).limit(15);
    const tasks = (data ?? []) as Task[];
    if (!tasks.length) { await sendMessage(chatId, "Выполненных задач нет."); return; }
    await sendMessage(chatId, `<b>✅ Выполненные: ${tasks.length}</b>`);
    for (const t of tasks) await sendTaskCard(chatId, t);
  } else if (type === "export") {
    await handleTasksExport(chatId);
  }
}

async function handleTasksExport(chatId: number): Promise<void> {
  const { data } = await supabase.from("tasks").select("*")
    .not("status", "in", '("draft")')
    .order("due_date", { ascending: true })
    .limit(500);
  const tasks = (data ?? []) as Task[];
  if (!tasks.length) { await sendMessage(chatId, "Задач для экспорта нет."); return; }

  const lines = ["Задача\tИсполнители\tРынок\tДедлайн\tСтатус\tИсточник\tСоздана"];
  for (const t of tasks) {
    lines.push([
      t.title,
      (t.assignees ?? []).join("; "),
      t.country ?? "",
      t.due_date ?? "",
      t.status,
      t.source ?? "",
      t.created_at.slice(0, 10),
    ].join("\t"));
  }

  const csv = lines.join("\n");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([csv], { type: "text/plain" }), `tasks_${new Date().toISOString().slice(0, 10)}.tsv`);
  form.append("caption", `Экспорт задач · ${tasks.length} шт.`);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
}
```

- [ ] **Step 7: Append handleTaskSessionInput**

Append to `handlers.ts`:

```ts
export async function handleTaskSessionInput(
  chatId: number,
  _userId: number,
  action: string,
  text: string,
  context?: string,
): Promise<boolean> {
  // /addtask step 1: title received
  if (action === "addtask_title") {
    await clearSession(chatId);
    const title = text.trim();
    if (!title) { await sendMessage(chatId, "Название не может быть пустым. Попробуй ещё раз."); await setSession(chatId, "addtask_title"); return true; }
    const task = await dbCreateTask({ title, source: "manual", status: "draft" });
    const profiles = await getProfilesForPrompt();
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    const profileMap = buildProfileMap(profiles);
    const seen = new Set<number>();
    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null as string | null },
      ...((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>),
    ].filter(u => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; });
    const buttons = allUsers.map(u => [{
      text: profileMap[u.telegram_id] || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`),
      callback_data: `tat_${task.id}_${u.telegram_id}`,
    }]);
    buttons.push([{ text: "❌ Без исполнителя", callback_data: `tac_${task.id}_none_country` }]);
    buttons.push([{ text: "🚫 Отмена", callback_data: `tacx_${task.id}` }]);
    await sendInlineMessage(chatId, `📌 <b>${title}</b>\n\nКому назначить?`, buttons);
    return true;
  }

  // /addtask step 3: due date received
  if (action === "addtask_due" && context) {
    await clearSession(chatId);
    const taskId = context;
    if (text.trim().toLowerCase() === "пропустить" || text.trim().toLowerCase() === "skip") {
      await dbUpdateTask(taskId, { status: "open" });
      const task = await dbGetTask(taskId);
      if (task) await sendTaskCard(chatId, task);
      return true;
    }
    const today = new Date().toISOString().split("T")[0];
    const parsed = await chatComplete(
      `Сегодня ${today}. Преобразуй дату из текста пользователя в формат ГГГГ-ММ-ДД. Только дату, без пояснений. Если не распознал — верни "null".`,
      text.trim()
    );
    const due = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
    if (!due) {
      await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз или напиши «пропустить».");
      await setSession(chatId, "addtask_due", taskId);
      return true;
    }
    await dbUpdateTask(taskId, { due_date: due, status: "open" });
    const task = await dbGetTask(taskId);
    if (task) {
      await sendMessage(chatId, "✅ Задача создана!");
      await sendTaskCard(chatId, task);
    }
    return true;
  }

  // Edit due date for existing task
  if (action === "task_date" && context) {
    await clearSession(chatId);
    const taskId = context;
    if (text.trim().toLowerCase() === "убрать") {
      await dbUpdateTask(taskId, { due_date: null });
      await sendMessage(chatId, "📅 Дедлайн убран.");
      return true;
    }
    const today = new Date().toISOString().split("T")[0];
    const parsed = await chatComplete(
      `Сегодня ${today}. Преобразуй дату в формат ГГГГ-ММ-ДД. Только дату. Если не распознал — "null".`,
      text.trim()
    );
    const due = /^\d{4}-\d{2}-\d{2}$/.test(parsed.trim()) ? parsed.trim() : null;
    if (!due) { await sendMessage(chatId, "Не удалось распознать дату. Попробуй ещё раз."); await setSession(chatId, "task_date", taskId); return true; }
    await dbUpdateTask(taskId, { due_date: due });
    const dueFmt = new Date(due + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    await sendMessage(chatId, `📅 Дедлайн: <b>${dueFmt}</b>`);
    return true;
  }

  return false;
}
```

- [ ] **Step 8: Fix the `tac_` callback for "no assignee" path**

The "Без исполнителя" button uses `tac_${task.id}_none_country` which doesn't match the `tac_` handler pattern. Fix by using a separate callback prefix `tatx_` for "skip assignee":

In `handleTaskCallbacks`, the `tac_` handler currently parses `taskId` and `country` by splitting on first `_`. The country value can contain `_` if the market name has one. Let's use a cleaner separator.

Replace the `tac_` handling block in `handleTaskCallbacks` with:

```ts
  if (data.startsWith("tac_")) {
    // format: tac_{taskId}:{country_or_none}
    const rest = data.replace("tac_", "");
    const sep = rest.indexOf(":");
    if (sep === -1) return false;
    const taskId = rest.slice(0, sep);
    const country = rest.slice(sep + 1);
    await dbUpdateTask(taskId, { country: country === "none" ? null : country });
    await setSession(chatId, "addtask_due", taskId);
    await sendMessage(chatId, `Дедлайн? (ДД.ММ.ГГГГ или «пропустить»)`);
    return true;
  }
```

And update all `tac_` callback_data to use `:` separator instead of `_`:

In the `tat_` handler (step 5), replace:
```ts
const countryButtons = markets.map(m => [{ text: `🌍 ${m}`, callback_data: `tac_${taskId}_${m}` }]);
countryButtons.push([{ text: "❌ Без рынка", callback_data: `tac_${taskId}_none` }]);
```
With:
```ts
const countryButtons = markets.map(m => [{ text: `🌍 ${m}`, callback_data: `tac_${taskId}:${m}` }]);
countryButtons.push([{ text: "❌ Без рынка", callback_data: `tac_${taskId}:none` }]);
```

In `handleTaskSessionInput`, "Без исполнителя" button:
Replace `callback_data: \`tac_${task.id}_none_country\`` with `callback_data: \`tac_${task.id}:none\``.

- [ ] **Step 9: Commit handlers.ts**

```bash
git add supabase/functions/swarm-bot/tasks/handlers.ts
git commit -m "feat: add tasks/handlers.ts with /tasks, /addtask, callbacks, session handlers"
```

---

### Task 7: `tasks/index.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/tasks/index.ts`

- [ ] **Step 1: Create the file**

```ts
export {
  TASK_KEYWORDS,
  handleTasks,
  handleAddTask,
  handleTaskCallbacks,
  handleTaskSessionInput,
  analyzeAndCreateTasks,
  smartTaskSearch,
  sendTaskCard,
} from "./handlers.ts";
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/index.ts
git commit -m "feat: add tasks/index.ts public API"
```

---

### Task 8: Update `swarm-bot/index.ts`

**Files:**
- Modify: `supabase/functions/swarm-bot/index.ts`

- [ ] **Step 1: Replace the tasks import (line 7)**

Replace:
```ts
import { handleTaskCallbacks, handleTasks } from "./handlers/tasks.ts";
```
With:
```ts
import { handleTaskCallbacks, handleTasks, handleAddTask, handleTaskSessionInput } from "./tasks/index.ts";
```

- [ ] **Step 2: Update handleTasks call to pass userId (line ~199)**

Replace:
```ts
} else if (command === "/tasks" || text === "📋 Задачи") {
  await handleTasks(chatId, argText);
```
With:
```ts
} else if (command === "/tasks" || text === "📋 Задачи") {
  await handleTasks(chatId, userId, argText);
```

- [ ] **Step 3: Add /addtask command handler after the /tasks block**

After the `/tasks` block, add:
```ts
} else if (command === "/addtask") {
  await handleAddTask(chatId);
```

- [ ] **Step 4: Wire task session input handler in the session router**

In the session router block (around line 154), add task session handling after user session:
```ts
} else if (action && await handleMeetingSessionInput(chatId, action, text)) {
  // meeting session handled
} else if (action && await handleUserSessionInput(chatId, userId, action, text)) {
  // user session handled
} else if (action && await handleTaskSessionInput(chatId, userId, action, text, session?.context ?? undefined)) {
  // task session handled
```

- [ ] **Step 5: Type-check**

```bash
deno check supabase/functions/swarm-bot/index.ts
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-bot/index.ts
git commit -m "feat: wire tasks module into main bot — /addtask, task sessions"
```

---

### Task 9: Update `handlers/users.ts` import

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/users.ts:5`

- [ ] **Step 1: Update import path**

Replace:
```ts
import { sendTaskCard } from "./tasks.ts";
```
With:
```ts
import { sendTaskCard } from "../tasks/index.ts";
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/users.ts
git commit -m "fix: update sendTaskCard import path in users.ts"
```

---

### Task 10: Clean up `handlers/knowledge.ts`

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/knowledge.ts`

- [ ] **Step 1: Check what's in knowledge.ts around TASK_KEYWORDS**

```bash
grep -n "TASK_KEYWORDS\|smartTaskSearch\|analyzeAndCreateTasks" supabase/functions/swarm-bot/handlers/knowledge.ts
```

- [ ] **Step 2: Replace local TASK_KEYWORDS and smartTaskSearch with import**

Add at the top of `knowledge.ts` imports:
```ts
import { TASK_KEYWORDS, smartTaskSearch } from "../tasks/index.ts";
```

Remove the local definitions of `TASK_KEYWORDS` and `smartTaskSearch` from `knowledge.ts`.

- [ ] **Step 3: Type-check**

```bash
deno check supabase/functions/swarm-bot/handlers/knowledge.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/knowledge.ts
git commit -m "refactor: use tasks module TASK_KEYWORDS/smartTaskSearch in knowledge.ts"
```

---

### Task 11: Delete old `handlers/tasks.ts`

**Files:**
- Delete: `supabase/functions/swarm-bot/handlers/tasks.ts`

- [ ] **Step 1: Verify nothing imports from the old file**

```bash
grep -rn "handlers/tasks" supabase/functions/swarm-bot/
```

Expected: no results (all imports updated in tasks 8-10).

- [ ] **Step 2: Delete the file**

```bash
rm supabase/functions/swarm-bot/handlers/tasks.ts
```

- [ ] **Step 3: Full type-check of the bot function**

```bash
deno check supabase/functions/swarm-bot/index.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A supabase/functions/swarm-bot/
git commit -m "refactor: remove monolithic handlers/tasks.ts — replaced by tasks/ module"
```

---

### Task 12: MCP task tools — `swarm-mcp/tasks/tools.ts`

**Files:**
- Create: `supabase/functions/swarm-mcp/tasks/tools.ts`

- [ ] **Step 1: Create the file**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_id: number | null;
  due_date: string | null;
  country: string | null;
  source: string;
  status: string;
  created_at: string;
};

async function matchAssignee(name: string): Promise<{ telegram_id: number; display_name: string } | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username");

  if (!data?.length) return null;
  const lower = name.toLowerCase();
  const match = (data as Array<{ telegram_id: number; first_name?: string; last_name?: string; username?: string }>)
    .find(p => {
      const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ").toLowerCase();
      const uname = (p.username ?? "").toLowerCase();
      return fullName.includes(lower) || lower.includes(fullName) || uname.includes(lower);
    });
  if (!match) return null;
  return {
    telegram_id: match.telegram_id,
    display_name: [match.first_name, match.last_name].filter(Boolean).join(" ") || match.username || String(match.telegram_id),
  };
}

export async function toolAddTask(args: {
  title: string;
  description?: string;
  assignee_name?: string;
  country?: string;
  due_date?: string;
  source: string;
  context_id?: string;
}): Promise<string> {
  const assignees: string[] = [];
  let assignee_telegram_id: number | null = null;

  if (args.assignee_name) {
    const match = await matchAssignee(args.assignee_name);
    if (match) {
      assignees.push(match.display_name);
      assignee_telegram_id = match.telegram_id;
    } else {
      assignees.push(args.assignee_name);
    }
  }

  const { data, error } = await supabase.from("tasks").insert({
    title: args.title,
    description: args.description ?? null,
    assignees,
    assignee_telegram_id,
    country: args.country ?? null,
    due_date: args.due_date ?? null,
    source: args.source,
    status: "open",
    meeting_id: args.context_id ?? null,
    tags: [],
  }).select("id").single();

  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача создана (id: ${data.id})${assignee_telegram_id ? "" : args.assignee_name ? " ⚠️ исполнитель не найден в профилях — записан как текст" : ""}.`;
}

export async function toolUpdateTask(args: {
  id: string;
  title?: string;
  description?: string;
  assignee_name?: string;
  country?: string;
  due_date?: string | null;
  status?: string;
}): Promise<string> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (args.title !== undefined) updates.title = args.title;
  if (args.description !== undefined) updates.description = args.description;
  if (args.country !== undefined) updates.country = args.country;
  if ("due_date" in args) updates.due_date = args.due_date ?? null;
  if (args.status !== undefined) updates.status = args.status;

  if (args.assignee_name !== undefined) {
    if (!args.assignee_name) {
      updates.assignees = [];
      updates.assignee_telegram_id = null;
    } else {
      const match = await matchAssignee(args.assignee_name);
      if (match) {
        updates.assignees = [match.display_name];
        updates.assignee_telegram_id = match.telegram_id;
      } else {
        updates.assignees = [args.assignee_name];
        updates.assignee_telegram_id = null;
      }
    }
  }

  const { error } = await supabase.from("tasks").update(updates).eq("id", args.id);
  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача обновлена.`;
}

export async function toolDeleteTask(args: { id: string }): Promise<string> {
  const { data: task } = await supabase.from("tasks").select("title").eq("id", args.id).maybeSingle();
  if (!task) return `Задача ${args.id} не найдена.`;
  await supabase.from("task_history").delete().eq("task_id", args.id);
  const { error } = await supabase.from("tasks").delete().eq("id", args.id);
  if (error) return `Ошибка: ${error.message}`;
  return `✅ Задача «${task.title}» удалена.`;
}

export async function toolGetTasks(args: {
  assignee?: string;
  country?: string;
  status?: string;
  period?: string;
}): Promise<string> {
  let query = supabase.from("tasks").select("*").order("due_date", { ascending: true });

  if (args.status) {
    query = query.eq("status", args.status);
  } else {
    query = query.not("status", "in", '("done","cancelled","draft")');
  }
  if (args.country) query = query.ilike("country", `%${args.country}%`);
  if (args.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    query = query.gte("due_date", today).lte("due_date", end);
  }

  const { data, error } = await query.limit(30);
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Задач не найдено.";

  let tasks = data as TaskRow[];
  if (args.assignee) {
    const lower = args.assignee.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(lower)));
  }

  return tasks.map(t => {
    const who = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` | дедлайн: ${t.due_date}` : "";
    const country = t.country ? ` | ${t.country}` : "";
    return `• [${t.status}] ${t.title}\n  Исполнитель: ${who}${due}${country}`;
  }).join("\n\n");
}

export const TASK_TOOL_DEFINITIONS = [
  {
    name: "add_task",
    description: "Создать новую задачу. Используй после того как пользователь подтвердил список задач из транскрипта.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Название задачи" },
        description: { type: "string", description: "Описание или детали (опционально)" },
        assignee_name: { type: "string", description: "Имя, фамилия или ник исполнителя (опционально)" },
        country: { type: "string", description: "Рынок/страна (опционально)" },
        due_date: { type: "string", description: "Дедлайн в формате YYYY-MM-DD (опционально)" },
        source: { type: "string", enum: ["transcript", "claude", "manual"], description: "Источник задачи" },
        context_id: { type: "string", description: "ID записи в базе знаний (опционально)" },
      },
      required: ["title", "source"],
    },
  },
  {
    name: "update_task",
    description: "Обновить задачу по ID. Передай только поля которые нужно изменить. due_date: null — убрать дедлайн.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
        title: { type: "string" },
        description: { type: "string" },
        assignee_name: { type: "string", description: "Новый исполнитель. Пустая строка — убрать исполнителя." },
        country: { type: "string" },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD или null чтобы убрать" },
        status: { type: "string", enum: ["open", "in_progress", "done", "cancelled"] },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Удалить задачу по ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
      },
      required: ["id"],
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-mcp/tasks/tools.ts
git commit -m "feat: add MCP task tools — add_task, update_task, delete_task"
```

---

### Task 13: Update `swarm-mcp/index.ts`

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts`

- [ ] **Step 1: Add import at top of file (after existing imports)**

Add after line 7 (`const supabase = ...`):
```ts
import { toolAddTask, toolUpdateTask, toolDeleteTask, toolGetTasks as toolGetTasksNew, TASK_TOOL_DEFINITIONS } from "./tasks/tools.ts";
```

- [ ] **Step 2: Add task tool definitions to TOOLS array**

Find the `const TOOLS = [` array (line ~66). Replace the existing `get_tasks` definition and add new tools:

Replace the existing `get_tasks` entry in TOOLS:
```ts
  {
    name: "get_tasks",
    description: "Получить задачи команды с фильтрами по исполнителю, стране или статусу.",
    inputSchema: {
      type: "object",
      properties: {
        assignee: { type: "string", description: "Имя исполнителя" },
        country: { type: "string", description: "Страна или рынок" },
        status: { type: "string", enum: ["open", "in_progress", "done", "cancelled"] },
        period: { type: "string", enum: ["week"], description: "Задачи на этой неделе" },
      },
    },
  },
  ...TASK_TOOL_DEFINITIONS,
```

- [ ] **Step 3: Wire new tools in the tools/call handler**

In the `if (method === "tools/call")` block, replace the existing `get_tasks` handler and add new ones:

Replace:
```ts
      } else if (name === "get_tasks") {
        result = await toolGetTasks(args as { assignee?: string; tag?: string; status?: string; period?: string });
```
With:
```ts
      } else if (name === "get_tasks") {
        result = await toolGetTasksNew(args as { assignee?: string; country?: string; status?: string; period?: string });
      } else if (name === "add_task") {
        result = await toolAddTask(args as { title: string; description?: string; assignee_name?: string; country?: string; due_date?: string; source: string; context_id?: string });
      } else if (name === "update_task") {
        result = await toolUpdateTask(args as { id: string; title?: string; description?: string; assignee_name?: string; country?: string; due_date?: string | null; status?: string });
      } else if (name === "delete_task") {
        result = await toolDeleteTask(args as { id: string });
```

- [ ] **Step 4: Remove the now-unused local `toolGetTasks` function**

Delete the `async function toolGetTasks(...)` function body from `index.ts` (lines ~197–223) since it's replaced by the imported version.

- [ ] **Step 5: Type-check**

```bash
deno check supabase/functions/swarm-mcp/index.ts
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts supabase/functions/swarm-mcp/tasks/tools.ts
git commit -m "feat: wire add_task, update_task, delete_task into swarm-mcp"
```

---

### Task 14: Deploy and verify

- [ ] **Step 1: Deploy swarm-bot**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Expected: all files uploaded, no errors.

- [ ] **Step 2: Deploy swarm-mcp**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
```

Expected: all files uploaded, no errors.

- [ ] **Step 3: Smoke-test bot — /tasks**

Send `/tasks` in Telegram. Expected: shows YOUR open tasks (filtered by telegram_id), or "У тебя нет активных задач."

- [ ] **Step 4: Smoke-test bot — /addtask**

Send `/addtask`. Expected: bot asks "Название задачи?". Type a title. Expected: shows user buttons. Click a user. Expected: shows country buttons. Click a country. Expected: asks for deadline. Type a date (e.g. `20.05.2026`). Expected: shows task card with ✅ Готово / 🗑 Удалить / 📅 Дедлайн buttons.

- [ ] **Step 5: Smoke-test bot — /tasks все**

Send `/tasks все`. Expected: all open tasks grouped by assignee in one message.

- [ ] **Step 6: Smoke-test MCP — add_task**

In Claude Desktop, ask: "Создай задачу: Подготовить отчёт по Словении, исполнитель — [твоё имя]". Expected: Claude calls `add_task`, responds "Добавлено".

- [ ] **Step 7: Update CHANGELOG**

```markdown
## 2026-05-19

### Tasks module — изолированный модуль задач
- `swarm-bot/tasks/` — новый изолированный модуль (types, db, matcher, formatter, handlers)
- `/addtask` — пошаговый диалог: название → исполнитель (кнопками) → рынок → дедлайн
- `/tasks` — мои задачи; `/tasks все` — все с разбивкой по исполнителям; `/tasks Имя` — задачи человека
- Новый формат карточки задачи: `📌 Название / 👤 Имя | 🌍 Рынок | 📅 до ДД.ММ`
- MCP: `add_task`, `update_task`, `delete_task` — Claude Desktop может управлять задачами
- Schema: добавлены колонки `description`, `source`, `country`, `assignee_telegram_id`
- `analyzeAndCreateTasks`: теперь заполняет `assignee_telegram_id` и `country` из транскрипта
```

- [ ] **Step 8: Commit CHANGELOG**

```bash
git add CHANGELOG.md
git commit -m "chore: update CHANGELOG for tasks module"
```
