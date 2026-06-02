# Tasks Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add task confirmation flow, "On Review" and "Today" views in the Telegram bot, tag-based targeting, broadcast pings on confirm, and fix MCP security bugs.

**Architecture:** Schema migration adds `confirmed`/`created_by_telegram_id` to `tasks`. Bot grows two new views (pending review, today) plus an enhanced task card with inline edit buttons. MCP gets workspace isolation enforced on all task tools. Broadcast sends Telegram messages to assignees at confirm time.

**Tech Stack:** Deno/TypeScript, Supabase Postgres, Telegram Bot API, Edge Functions (swarm-bot, swarm-mcp, swarm-api)

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/20260602_tasks_confirmed.sql` | **Create** — ADD COLUMN migration |
| `supabase/functions/_shared/tasks/types.ts` | **Modify** — add `confirmed`, `created_by_telegram_id` |
| `supabase/functions/_shared/tasks/db.ts` | **Modify** — `createTask` + `listTasks` new filters |
| `supabase/functions/swarm-bot/tasks/db.ts` | **Modify** — add `dbListPending`, `dbListToday` |
| `supabase/functions/swarm-bot/tasks/formatter.ts` | **Modify** — update `sendPendingTaskCard` full card |
| `supabase/functions/swarm-bot/tasks/handlers.ts` | **Modify** — main menu, pending/today callbacks, confirm broadcast, addtask sets confirmed |
| `supabase/functions/swarm-mcp/tasks/tools.ts` | **Modify** — security fixes + Telegram notify on add_task |
| `supabase/functions/swarm-mcp/index.ts` | **Modify** — `get_tasks` tool definition makes requesting_user_id required |
| `supabase/functions/swarm-api/index.ts` | **Modify** — POST /tasks sets confirmed=true, GET /tasks supports ?confirmed= |

---

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260602_tasks_confirmed.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260602_tasks_confirmed.sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_telegram_id bigint;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected output: migration applied, no errors.

- [ ] **Step 3: Verify columns exist**

```bash
supabase db diff
```

Expected: clean diff (no pending changes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602_tasks_confirmed.sql
git commit -m "feat(tasks): add confirmed and created_by_telegram_id columns"
git push origin sandbox_vas
```

---

### Task 2: Shared Types

**Files:**
- Modify: `supabase/functions/_shared/tasks/types.ts`

- [ ] **Step 1: Update Task and TaskInput**

Replace the full file content:

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
  group_id?: string | null;
  confirmed: boolean;
  created_by_telegram_id: number | null;
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
  group_id?: string | null;
  confirmed?: boolean;
  created_by_telegram_id?: number | null;
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/tasks/types.ts
git commit -m "feat(tasks): add confirmed and created_by_telegram_id to types"
git push origin sandbox_vas
```

---

### Task 3: Shared DB Layer

**Files:**
- Modify: `supabase/functions/_shared/tasks/db.ts`

- [ ] **Step 1: Update `createTask` to persist new fields**

In `createTask`, add `confirmed` and `created_by_telegram_id` to the insert:

```typescript
export async function createTask(input: TaskInput, groupId?: string): Promise<Task> {
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
    group_id: groupId ?? input.group_id ?? null,
    confirmed: input.confirmed ?? false,
    created_by_telegram_id: input.created_by_telegram_id ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Task;
}
```

- [ ] **Step 2: Update `listTasks` to support new filters**

Replace `listTasks` with:

```typescript
export async function listTasks(filters: {
  status?: string;
  country?: string;
  period?: string;
  telegramId?: number;
  assigneeText?: string;
  limit?: number;
  confirmed?: boolean;
  createdBy?: number;
  dueToday?: boolean;
}, groupId?: string): Promise<Task[]> {
  let q = supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (filters.confirmed !== undefined) {
    q = q.eq("confirmed", filters.confirmed);
  } else if (!filters.dueToday) {
    q = q.not("status", "in", '("done","cancelled","draft")');
  }

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.country) q = q.ilike("country", `%${filters.country}%`);
  if (filters.createdBy !== undefined) q = q.eq("created_by_telegram_id", filters.createdBy);

  if (filters.telegramId !== undefined) {
    q = q.contains("assignee_telegram_ids", [filters.telegramId]);
  }

  if (filters.dueToday) {
    const today = new Date().toISOString().split("T")[0];
    q = q.lte("due_date", today).eq("confirmed", true);
  }

  if (filters.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    q = q.gte("due_date", today).lte("due_date", end);
  }

  if (groupId) q = q.eq("group_id", groupId);

  const { data } = await q.limit(filters.limit ?? 200);
  let tasks = (data ?? []) as Task[];

  if (filters.assigneeText) {
    const lower = filters.assigneeText.toLowerCase();
    tasks = tasks.filter(t => t.assignees?.some(a => a.toLowerCase().includes(lower)));
  }

  return tasks;
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/tasks/db.ts
git commit -m "feat(tasks): createTask + listTasks support confirmed/createdBy/dueToday"
git push origin sandbox_vas
```

---

### Task 4: Bot DB Helpers

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/db.ts`

- [ ] **Step 1: Add `dbListPending` and `dbListToday`**

Add after the existing exports:

```typescript
export async function dbListPending(createdBy: number, groupId?: string): Promise<Task[]> {
  return listTasks({ confirmed: false, createdBy, limit: 20 }, groupId);
}

export async function dbListToday(telegramId: number, groupId?: string): Promise<Task[]> {
  const today = new Date().toISOString().split("T")[0];
  // Tasks due today or overdue, assigned to me or tagged #all
  const [mine, allTag] = await Promise.all([
    listTasks({ dueToday: true, telegramId, limit: 30 }, groupId),
    listTasks({ dueToday: true, limit: 50 }, groupId),
  ]);
  const allFiltered = allTag.filter(t => (t.tags ?? []).includes("#all"));
  const seen = new Set<string>();
  return [...mine, ...allFiltered].filter(t => !seen.has(t.id) && seen.add(t.id));
}
```

Also add `dbListPending` and `dbListToday` to the imports line at top:

```typescript
import { createTask, getTask, listTasks, updateTask, deleteTask } from "../../_shared/tasks/db.ts";
```

(No change needed — `listTasks` is already imported.)

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/db.ts
git commit -m "feat(tasks): add dbListPending and dbListToday helpers"
git push origin sandbox_vas
```

---

### Task 5: Pending Task Card in Formatter

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/formatter.ts`

- [ ] **Step 1: Replace `sendPendingTaskCard` with full card**

Replace the existing `sendPendingTaskCard` function with:

```typescript
export async function sendPendingTaskCard(chatId: number, task: Task): Promise<void> {
  const who = task.assignees?.length
    ? `👤 ${task.assignees.join(", ")}`
    : "⚠️ Исполнитель не назначен";
  const country = task.country ? `🌍 ${task.country}` : "";
  const tags = (task.tags ?? []).filter(t => t.startsWith("#")).join(" ");
  const meta = [country, tags].filter(Boolean).join(" · ");
  const due = task.due_date
    ? `📅 ${new Date(task.due_date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`
    : "📅 Без дедлайна";

  const text = [
    `⏳ <b>${task.title}</b>`,
    who,
    meta || null,
    due,
  ].filter(Boolean).join("\n");

  const hasAssignee = (task.assignee_telegram_ids ?? []).length > 0 || (task.assignees ?? []).length > 0;

  await sendInlineMessage(chatId, text, [
    [
      { text: "✅ Подтвердить", callback_data: `tc_${task.id}` },
      { text: "🗑 Удалить", callback_data: `tdc_${task.id}` },
    ],
    [
      { text: hasAssignee ? "👤 Исполнитель" : "⚠️ Назначить", callback_data: `ta_${task.id}` },
      { text: "📅 Дедлайн", callback_data: `tdue_${task.id}` },
      { text: "🌍 Страна/теги", callback_data: `tctag_${task.id}` },
    ],
  ]);
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/formatter.ts
git commit -m "feat(tasks): sendPendingTaskCard full card with edit buttons"
git push origin sandbox_vas
```

---

### Task 6: Bot Handlers — Main Menu, Pending, Today

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/handlers.ts`

- [ ] **Step 1: Update imports at top of handlers.ts**

Change the db import line to include new helpers:

```typescript
import { dbGetTask, dbListTasks, dbCreateTask, dbUpdateTask, dbDeleteTask, dbListAllOpen, dbListPending, dbListToday } from "./db.ts";
```

- [ ] **Step 2: Replace `buildMainMenuMessage` to add ⏳ button**

Find the `buildMainMenuMessage` function (referenced in `tk_menu` callback) and either add it if missing or update it. Search for it first:

In `handlers.ts`, locate the function that builds the main menu keyboard. It is used at `"tk_menu"` callback. Replace/add `buildMainMenuMessage` so it returns three rows:

```typescript
function buildMainMenuMessage(): { text: string; keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    text: "📋 <b>Задачи</b>",
    keyboard: [
      [
        { text: "⏳ На проверке", callback_data: "tk_pending" },
        { text: "📅 На сегодня", callback_data: "tk_today" },
      ],
      [
        { text: "📌 Мои задачи", callback_data: "tk_mine" },
        { text: "👥 Все задачи", callback_data: "tk_all" },
      ],
      [{ text: "➕ Создать задачу", callback_data: "tk_add" }],
    ],
  };
}
```

- [ ] **Step 3: Add `tk_pending` callback handler**

Inside `handleTaskCallbacks`, after the `tk_add` block (around line 405), add:

```typescript
  // tk_pending — tasks awaiting my review
  if (data === "tk_pending") {
    const tasks = await dbListPending(userId, groupId);
    if (!tasks.length) {
      await editInlineMessage(
        chatId, cb.message.message_id,
        "✅ Задач на проверке нет.",
        [[{ text: "🔙 Назад", callback_data: "tk_menu" }]],
      );
      return true;
    }
    const buttons = tasks.map((t, i) => {
      const who = t.assignees?.length ? ` · ${t.assignees[0].split(" ")[0]}` : " · ⚠️";
      const due = t.due_date ? ` · ${t.due_date.slice(5)}` : "";
      return [{ text: `⏳ ${truncateTitle(t.title)}${who}${due}`, callback_data: `tk_pen_${t.id}` }];
    });
    buttons.push([{ text: "🔙 Назад", callback_data: "tk_menu" }]);
    await editInlineMessage(chatId, cb.message.message_id, `⏳ <b>На проверке (${tasks.length}):</b>`, buttons);
    return true;
  }
```

- [ ] **Step 4: Add `tk_pen_{taskId}` callback — open pending card**

After the `tk_pending` block:

```typescript
  // tk_pen_{taskId} — open single pending task card
  if (data.startsWith("tk_pen_")) {
    const taskId = data.replace("tk_pen_", "");
    const task = await dbGetTask(taskId);
    if (!task) {
      await editInlineMessage(chatId, cb.message.message_id, "Задача не найдена.", [[{ text: "🔙 Назад", callback_data: "tk_pending" }]]);
      return true;
    }
    await sendPendingTaskCard(chatId, task);
    return true;
  }
```

- [ ] **Step 5: Add `tk_today` callback handler**

After the `tk_pen_` block:

```typescript
  // tk_today — tasks due today or overdue assigned to me or #all
  if (data === "tk_today") {
    const tasks = await dbListToday(userId, groupId);
    if (!tasks.length) {
      await editInlineMessage(
        chatId, cb.message.message_id,
        "📅 Задач на сегодня нет. Отдыхай 🎉",
        [[{ text: "🔙 Назад", callback_data: "tk_menu" }]],
      );
      return true;
    }
    const today = new Date().toISOString().split("T")[0];
    const buttons = tasks.map(t => {
      const overdue = t.due_date && t.due_date < today;
      const icon = overdue ? "🔴" : "🟡";
      const dueSuffix = overdue ? ` · просрочена (${t.due_date!.slice(5)})` : ` · сегодня`;
      return [{ text: `${icon} ${truncateTitle(t.title)}${dueSuffix}`, callback_data: `tk_t_${t.id}` }];
    });
    buttons.push([{ text: "🔙 Назад", callback_data: "tk_menu" }]);
    await editInlineMessage(chatId, cb.message.message_id, `📅 <b>На сегодня (${tasks.length}):</b>`, buttons);
    return true;
  }
```

- [ ] **Step 6: Add `tdue_{taskId}` callback — edit deadline from pending card**

After `tdate_` handler block:

```typescript
  // tdue_{taskId} — prompt deadline edit (from pending card)
  if (data.startsWith("tdue_")) {
    const taskId = data.replace("tdue_", "");
    await setSession(chatId, "task_date", taskId);
    await sendMessage(chatId, "Новый дедлайн? (например: «15 июня», «следующая пятница» или «убрать»)");
    return true;
  }
```

- [ ] **Step 7: Add `tctag_{taskId}` callback — country/tags picker from pending card**

After the `tdue_` block:

```typescript
  // tctag_{taskId} — country and tag picker (from pending card)
  if (data.startsWith("tctag_")) {
    const taskId = data.replace("tctag_", "");
    const COUNTRIES = ["Serbia", "Bulgaria", "Croatia", "Hungary", "Moldova", "Romania"];
    const ROLES = ["#all", "#marketing", "#rnd", "#bd"];
    const countryButtons = COUNTRIES.map(c => [{ text: `🌍 ${c}`, callback_data: `tctagc_${taskId}:${c}` }]);
    const roleButtons = ROLES.map(r => [{ text: r, callback_data: `tctagr_${taskId}:${r}` }]);
    countryButtons.push([{ text: "❌ Без страны", callback_data: `tctagc_${taskId}:none` }]);
    await sendInlineMessage(chatId, "Страна:", countryButtons);
    await sendInlineMessage(chatId, "Теги (можно несколько):", roleButtons);
    return true;
  }

  // tctagc_{taskId}:{country|none} — set country
  if (data.startsWith("tctagc_")) {
    const rest = data.replace("tctagc_", "");
    const sep = rest.indexOf(":");
    const taskId = rest.slice(0, sep);
    const country = rest.slice(sep + 1);
    await dbUpdateTask(taskId, { country: country === "none" ? null : country });
    await sendMessage(chatId, country === "none" ? "🌍 Страна убрана." : `🌍 Страна: <b>${country}</b>`);
    return true;
  }

  // tctagr_{taskId}:{tag} — toggle tag
  if (data.startsWith("tctagr_")) {
    const rest = data.replace("tctagr_", "");
    const sep = rest.indexOf(":");
    const taskId = rest.slice(0, sep);
    const tag = rest.slice(sep + 1);
    const task = await dbGetTask(taskId);
    if (!task) { await sendMessage(chatId, "Задача не найдена."); return true; }
    const current = task.tags ?? [];
    const updated = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
    await dbUpdateTask(taskId, { tags: updated });
    await sendMessage(chatId, `🏷 Теги: <b>${updated.join(", ") || "нет"}</b>`);
    return true;
  }
```

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/handlers.ts
git commit -m "feat(tasks): pending/today views, tag picker, deadline edit from card"
git push origin sandbox_vas
```

---

### Task 7: Confirm with Broadcast

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/handlers.ts`

- [ ] **Step 1: Add broadcast helper function**

Add this helper near the top of `handlers.ts` (after the imports, before `handleTasks`):

```typescript
async function broadcastTaskAssigned(task: Task, groupId: string): Promise<void> {
  const BOT_TOKEN = TELEGRAM_BOT_TOKEN;
  let recipientIds: number[] = [...(task.assignee_telegram_ids ?? [])];

  // If #all tag — broadcast to entire workspace
  if ((task.tags ?? []).includes("#all")) {
    const { data } = await supabase
      .from("allowed_users")
      .select("telegram_id")
      .eq("group_id", groupId)
      .not("telegram_id", "is", null);
    const all = ((data ?? []) as Array<{ telegram_id: number }>).map(u => u.telegram_id);
    const seen = new Set(recipientIds);
    for (const id of all) if (!seen.has(id)) recipientIds.push(id);
  }

  if (!recipientIds.length) return;

  const due = task.due_date
    ? ` · до ${new Date(task.due_date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`
    : "";
  const country = task.country ? ` · ${task.country}` : "";
  const text = `📋 Тебе назначена задача: <b>${task.title}</b>${country}${due}`;

  await Promise.all(recipientIds.map(id =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML" }),
    })
  ));
}
```

- [ ] **Step 2: Update `tc_` callback to set `confirmed = true` and broadcast**

Find the `tc_` callback block (around line 519 in original) and replace:

```typescript
  // Task confirm pending → confirmed: tc_{taskId}
  if (data.startsWith("tc_")) {
    const taskId = data.replace("tc_", "");
    const task = await dbGetTask(taskId);
    if (!task) { await sendMessage(chatId, "Задача не найдена."); return true; }
    await dbUpdateTask(taskId, { confirmed: true, status: "open" });
    await sendMessage(chatId, `✅ Подтверждено: <b>${task.title}</b>`);
    const confirmedTask = { ...task, confirmed: true, status: "open" };
    await broadcastTaskAssigned(confirmedTask, groupId);
    return true;
  }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/handlers.ts
git commit -m "feat(tasks): confirm sets confirmed=true, broadcasts to assignees"
git push origin sandbox_vas
```

---

### Task 8: Task Creation — Set confirmed and created_by

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/handlers.ts`

- [ ] **Step 1: Update `handleTaskSessionInput` signature to use userId**

Change the function signature to use `userId` (remove the underscore):

```typescript
export async function handleTaskSessionInput(
  chatId: number,
  userId: number,
  action: string,
  text: string,
  context?: string,
  groupId?: string,
): Promise<boolean> {
```

- [ ] **Step 2: Update `addtask_title` step to pass `created_by_telegram_id`**

In the `addtask_title` block, change `dbCreateTask` call to:

```typescript
    const task = await dbCreateTask({
      title,
      source: "manual",
      status: "draft",
      group_id: groupId ?? null,
      confirmed: false,
      created_by_telegram_id: userId,
    });
```

- [ ] **Step 3: Update `addtask_due` step to set `confirmed = true` on completion**

In the `addtask_due` block, both branches (skip and with date) call `dbUpdateTask`. Change them:

```typescript
    // skip branch:
    await dbUpdateTask(taskId, { status: "open", confirmed: true });

    // date branch:
    await dbUpdateTask(taskId, { due_date: due, status: "open", confirmed: true });
```

After the "✅ Задача создана!" message in each branch, broadcast:

```typescript
    const task = await dbGetTask(taskId);
    if (task) {
      await sendMessage(chatId, "✅ Задача создана!");
      await sendTaskCard(chatId, task);
      await broadcastTaskAssigned(task, groupId ?? "");
    }
```

- [ ] **Step 4: Update `analyzeAndCreateTasks` to set `created_by_telegram_id`**

The function signature is `analyzeAndCreateTasks(content, chatId, entryId, groupId?)` — it doesn't receive `userId`. Add it:

Change signature to:
```typescript
export async function analyzeAndCreateTasks(content: string, chatId: number, userId: number, entryId: string, groupId?: string): Promise<void> {
```

Update the `dbCreateTask` call inside the loop:

```typescript
    await dbCreateTask({
      title: task.title,
      assignees: finalAssignees,
      assignee_telegram_ids: finalTelegramIds,
      task_role,
      country: task.country ?? null,
      due_date: task.due_date ?? null,
      source: "transcript",
      status: "pending",
      confirmed: false,
      created_by_telegram_id: userId,
      meeting_id: entryId,
      group_id: groupId ?? null,
    });
```

- [ ] **Step 5: Fix callers of `analyzeAndCreateTasks` in `swarm-bot/index.ts`**

In `supabase/functions/swarm-bot/index.ts`, find all calls to `analyzeAndCreateTasks` and add `userId` as third argument:

```typescript
await analyzeAndCreateTasks(content, chatId, userId, entryId, groupId);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/handlers.ts supabase/functions/swarm-bot/index.ts
git commit -m "feat(tasks): set confirmed+created_by on creation, broadcast on addtask complete"
git push origin sandbox_vas
```

---

### Task 9: MCP Security Fixes + Notify Creator

**Files:**
- Modify: `supabase/functions/swarm-mcp/tasks/tools.ts`
- Modify: `supabase/functions/swarm-mcp/index.ts`

- [ ] **Step 1: Fix `toolGetTasks` — require requesting_user_id**

Replace `toolGetTasks`:

```typescript
export async function toolGetTasks(args: {
  assignee?: string;
  country?: string;
  status?: string;
  period?: string;
  requesting_user_id: number;
}): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";

  const tasks = await listTasks({
    status: args.status,
    country: args.country,
    period: args.period,
    assigneeText: args.assignee,
    limit: 30,
  }, groupId);

  if (!tasks.length) return "Задач не найдено.";

  return tasks.map(t => {
    const who = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` | дедлайн: ${t.due_date}` : "";
    const country = t.country ? ` | ${t.country}` : "";
    return `• [${t.status}] ${t.title}\n  Исполнитель: ${who}${due}${country}`;
  }).join("\n\n");
}
```

- [ ] **Step 2: Fix `toolDeleteTask` — add workspace check**

Replace `toolDeleteTask`:

```typescript
export async function toolDeleteTask(args: { id: string; requesting_user_id: number }): Promise<string> {
  const task = await getTask(args.id);
  if (!task) return `Задача ${args.id} не найдена.`;
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId || task.group_id !== groupId) return `Нет доступа: задача не принадлежит твоему воркспейсу.`;
  try {
    await deleteTask(args.id);
    return `✅ Задача «${task.title}» удалена.`;
  } catch (e) {
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }
}
```

- [ ] **Step 3: Fix `toolUpdateTask` — add workspace check**

Replace the full `toolUpdateTask` function:

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
  requesting_user_id: number;
}): Promise<string> {
  const task = await getTask(args.id);
  if (!task) return `Задача ${args.id} не найдена.`;
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId || task.group_id !== groupId) return `Нет доступа: задача не принадлежит твоему воркспейсу.`;

  const fields: Record<string, unknown> = {};

  if (args.title !== undefined) fields.title = args.title;
  if (args.description !== undefined) fields.description = args.description;
  if (args.country !== undefined) fields.country = args.country;
  if ("due_date" in args) fields.due_date = args.due_date ?? null;
  if (args.status !== undefined) fields.status = args.status;
  if (args.task_role !== undefined) fields.task_role = args.task_role;

  if (args.assignee_name !== undefined) {
    if (!args.assignee_name) {
      fields.assignees = [];
      fields.assignee_telegram_ids = [];
    } else {
      const match = await matchAssignee(args.assignee_name);
      if (match) {
        fields.assignees = [match.display_name];
        fields.assignee_telegram_ids = [match.telegram_id];
      } else {
        fields.assignees = [args.assignee_name];
        fields.assignee_telegram_ids = [];
      }
    }
  }

  try {
    await updateTask(args.id, fields);
    return `✅ Задача обновлена.`;
  } catch (e) {
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }
}
```

- [ ] **Step 4: Fix `toolAddTask` — set confirmed=false, created_by, notify creator**

Add a Telegram notify helper at the top of `tools.ts` (after imports):

```typescript
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

async function notifyCreator(telegramId: number, taskTitle: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  const text = `📋 Новая задача на проверке: <b>${taskTitle}</b>\n\nОткрой /tasks → ⏳ На проверке чтобы подтвердить.`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId, text, parse_mode: "HTML" }),
  });
}
```

In `toolAddTask`, after `const task = await createTask(...)`, add:

```typescript
    if (args.requesting_user_id) {
      await notifyCreator(args.requesting_user_id, args.title);
    }
```

Also pass `confirmed: false` and `created_by_telegram_id` in the `createTask` call:

```typescript
    const task = await createTask({
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
      confirmed: false,
      created_by_telegram_id: args.requesting_user_id ?? null,
    }, groupId ?? undefined);
```

- [ ] **Step 5: Update MCP tool definitions for `get_tasks`, `delete_task`, `update_task`**

In `swarm-mcp/index.ts`, update `get_tasks` definition to mark `requesting_user_id` as required:

```typescript
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
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу" },
      },
      required: ["requesting_user_id"],
    },
  },
```

In `TASK_TOOL_DEFINITIONS` in `swarm-mcp/tasks/tools.ts`, update `delete_task` and `update_task` to add `requesting_user_id` to properties and required:

```typescript
  // delete_task:
  {
    name: "delete_task",
    description: "Удалить задачу по ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["id", "requesting_user_id"],
    },
  },
  // update_task — add to required:
  required: ["id", "requesting_user_id"],
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-mcp/tasks/tools.ts supabase/functions/swarm-mcp/index.ts
git commit -m "security(mcp): workspace isolation for get/delete/update task; add_task notifies creator"
git push origin sandbox_vas
```

---

### Task 10: swarm-api — confirmed on POST

**Files:**
- Modify: `supabase/functions/swarm-api/index.ts`

- [ ] **Step 1: Set `confirmed: true` in POST /tasks**

In the `POST /tasks` handler (around line 252), change `createTask(input, groupId)` to pass confirmed:

```typescript
      const task = await createTask({ ...input, confirmed: true, created_by_telegram_id: telegram_id ?? null }, groupId);
```

- [ ] **Step 2: Add `?confirmed=` filter to GET /tasks**

In the `GET /tasks` handler, after `const limit = ...` line, add:

```typescript
      const confirmedParam = url.searchParams.get("confirmed");
      const confirmedFilter = confirmedParam === "true" ? true : confirmedParam === "false" ? false : undefined;
```

Pass it to `listTasks`:

```typescript
      const tasks = await listTasks(
        {
          status,
          country,
          assigneeText,
          telegramId: mine ? telegram_id : undefined,
          limit,
          confirmed: confirmedFilter,
        },
        groupId,
      );
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(tasks): swarm-api sets confirmed=true on POST, supports ?confirmed= filter"
git push origin sandbox_vas
```

---

### Task 11: Deploy

- [ ] **Step 1: Deploy swarm-bot**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Expected: `Deployed Function swarm-bot`

- [ ] **Step 2: Deploy swarm-mcp**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
```

Expected: `Deployed Function swarm-mcp`

- [ ] **Step 3: Deploy swarm-api**

```bash
supabase functions deploy swarm-api --no-verify-jwt
```

Expected: `Deployed Function swarm-api`

- [ ] **Step 4: Smoke test in Telegram**

1. Send `/tasks` to bot → verify menu shows ⏳ На проверке, 📅 На сегодня, 📌 Мои задачи, 👥 Все задачи
2. Tap «⏳ На проверке» → verify list shows unconfirmed tasks (or «нет задач»)
3. Tap «📅 На сегодня» → verify today's tasks
4. Create task via `/addtask` → verify it does NOT appear in «На проверке» (confirmed=true immediately)
5. Confirm a pending task → verify assignee gets a broadcast ping

- [ ] **Step 5: Final commit if any hotfixes**

```bash
git add -A
git commit -m "fix(tasks): post-deploy hotfixes"
git push origin sandbox_vas
```
