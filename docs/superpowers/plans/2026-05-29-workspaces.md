# Workspaces (Multi-tenancy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate data between teams inside one bot — each user belongs to one workspace, all queries are scoped to their `group_id`.

**Architecture:** Add a `workspaces` table and `group_id` column to `allowed_users` and `tasks` (`entries.group_id` already exists). Resolve `group_id` once at the entry point in `index.ts` (from `allowed_users` by `telegram_id`) and thread it through every handler. The superadmin (ADMIN_USER_ID) is also workspace-scoped — they see only their own workspace's data; workspace management commands are gated separately.

**Tech Stack:** Deno, Supabase Edge Functions, Supabase Postgres, PostgREST

---

## Security design

- **Access gate**: `checkAllowedWithGroup(userId, username?)` returns `{ allowed, groupId }`. If `groupId` is null (user not assigned to any workspace), deny access.
- **Data isolation**: Every entries/tasks query gets `.eq("group_id", groupId)`. No query touches data outside the caller's workspace.
- **Workspace commands** (`/workspace *`): hard-gated to `userId === ADMIN_USER_ID` before any logic runs.
- **Private entries**: filtered by `owner_id`, not `group_id` — travel with the user when they move workspaces. All other (team) data stays in the old workspace.
- **Read.ai webhook**: hardcoded to `group_id = 'europa'` for now (single OAuth token, single account). Documented as known limitation.

## Reusability design

- `lib/workspace.ts` — single module owning all workspace logic: `getUserGroupId`, `checkAllowedWithGroup`, `getOrCreateWorkspaceId`. All other files import from here.
- `handlers/workspace.ts` — all `/workspace` admin commands in one file, no workspace logic leaking into `index.ts`.
- `groupId` is always a plain `string` (workspace slug). Never passes through as nullable after the entry-point check.

## Future-proofing

- Workspace ID is a slug string (`'europa'`, `'other'`) not an integer — human-readable, safe to add more.
- `workspaces` is a first-class table — can add `settings jsonb`, per-workspace config, etc. without schema changes.
- `getUserGroupId` is the single source of truth — if the lookup needs caching or multi-workspace support later, only one function changes.
- No business logic in migrations — migrations only add/remove columns, never encode rules.

---

## File map

**Create:**
- `supabase/migrations/20260529300000_workspaces.sql` — workspaces table + group_id columns
- `supabase/migrations/20260529400000_workspaces_backfill.sql` — initial Europa workspace + assign existing data
- `supabase/functions/swarm-bot/lib/workspace.ts` — getUserGroupId, checkAllowedWithGroup
- `supabase/functions/swarm-bot/handlers/workspace.ts` — /workspace admin commands

**Modify:**
- `supabase/functions/swarm-bot/index.ts` — resolve groupId, route /workspace, pass to handlers
- `supabase/functions/swarm-bot/handlers/knowledge.ts` — handleAdd, handleAsk, executeTool
- `supabase/functions/swarm-bot/handlers/media.ts` — handleVoice, handleDocument, handlePhoto, handleUrl
- `supabase/functions/swarm-bot/handlers/meetings.ts` — filter entries by group_id
- `supabase/functions/swarm-bot/handlers/granola.ts` — saveGranolaNote resolves groupId internally
- `supabase/functions/swarm-bot/handlers/digest.ts` — filter entries by group_id
- `supabase/functions/swarm-bot/handlers/users.ts` — filter allowed_users by group_id
- `supabase/functions/swarm-bot/tasks/db.ts` — filter tasks by group_id
- `supabase/functions/swarm-bot/tasks/types.ts` — add group_id to TaskInput
- `supabase/functions/granola-poller/index.ts` — pass group_id when sending for save (no-op: poller only notifies, saving is in swarm-bot)
- `supabase/functions/read-ai-webhook/index.ts` — hardcode group_id = 'europa'
- `supabase/functions/swarm-mcp/index.ts` — resolve groupId from requesting_user_id

---

## Task 1: Migration — workspaces table + group_id columns

**Files:**
- Create: `supabase/migrations/20260529300000_workspaces.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add group_id to allowed_users
ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES workspaces(id);

-- Add group_id to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES workspaces(id);

-- Wire the pre-existing group_id column in entries to the new workspaces table
-- (entries.group_id is TEXT and already exists; add the FK constraint only if not present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'entries' AND constraint_name = 'entries_group_id_fkey'
  ) THEN
    ALTER TABLE entries ADD CONSTRAINT entries_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES workspaces(id);
  END IF;
END $$;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: no errors. `\d allowed_users` in psql should show `group_id text`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260529300000_workspaces.sql
git commit -m "feat(workspaces): add workspaces table and group_id columns"
```

---

## Task 2: Migration — backfill existing data to Europa

**Files:**
- Create: `supabase/migrations/20260529400000_workspaces_backfill.sql`

- [ ] **Step 1: Create the backfill migration**

```sql
-- Create the initial Europa workspace
INSERT INTO workspaces (id, name) VALUES ('europa', 'Европа')
  ON CONFLICT (id) DO NOTHING;

-- Add superadmin to allowed_users so getUserGroupId can resolve their workspace
-- (ADMIN_USER_ID = 744230399 is currently hardcoded but not in this table)
INSERT INTO allowed_users (telegram_id, group_id)
  VALUES (744230399, 'europa')
  ON CONFLICT (telegram_id) DO UPDATE SET group_id = 'europa';

-- Assign all existing entries to Europa
UPDATE entries SET group_id = 'europa' WHERE group_id IS NULL;

-- Assign all existing tasks to Europa
UPDATE tasks SET group_id = 'europa' WHERE group_id IS NULL;

-- Assign all existing users to Europa
UPDATE allowed_users SET group_id = 'europa' WHERE group_id IS NULL;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: runs cleanly, all rows in entries/tasks/allowed_users have `group_id = 'europa'`.

- [ ] **Step 3: Verify in Supabase dashboard**

Check: `SELECT count(*), group_id FROM entries GROUP BY group_id;` → one row, `europa`, N entries.
Check: `SELECT count(*), group_id FROM allowed_users GROUP BY group_id;` → all `europa`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260529400000_workspaces_backfill.sql
git commit -m "feat(workspaces): backfill existing data to Europa workspace"
```

---

## Task 3: lib/workspace.ts — core workspace module

**Files:**
- Create: `supabase/functions/swarm-bot/lib/workspace.ts`

- [ ] **Step 1: Create the module**

```typescript
import { supabase, ADMIN_USER_ID } from "./supabase.ts";

export async function getUserGroupId(userId: number): Promise<string | null> {
  const { data } = await supabase
    .from("allowed_users")
    .select("group_id")
    .eq("telegram_id", userId)
    .maybeSingle();
  return data?.group_id ?? null;
}

export async function checkAllowedWithGroup(
  userId: number,
  username?: string,
): Promise<{ allowed: boolean; groupId: string }> {
  // Look up the user row (includes superadmin who is now in allowed_users)
  const { data } = await supabase
    .from("allowed_users")
    .select("telegram_id, group_id")
    .eq("telegram_id", userId)
    .maybeSingle();

  if (data) {
    if (!data.group_id) return { allowed: false, groupId: "" };
    return { allowed: true, groupId: data.group_id };
  }

  // No row found — try username pending-invite resolution
  if (username) {
    const { data: pending } = await supabase
      .from("allowed_users")
      .select("id, group_id")
      .eq("username", username)
      .is("telegram_id", null)
      .limit(1);
    const row = pending?.[0];
    if (row) {
      await supabase.from("allowed_users")
        .update({ telegram_id: userId })
        .eq("id", row.id);
      if (!row.group_id) return { allowed: false, groupId: "" };
      return { allowed: true, groupId: row.group_id };
    }
  }

  return { allowed: false, groupId: "" };
}

// Workspace management (superadmin only)

export async function listWorkspaces(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at");
  return (data ?? []) as Array<{ id: string; name: string }>;
}

export async function createWorkspace(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("workspaces").insert({ id, name });
  if (error) throw new Error(error.message);
}

export async function assignUserToWorkspace(
  telegramId: number | null,
  username: string | null,
  workspaceId: string,
): Promise<"ok" | "not_found" | "workspace_not_found"> {
  // Verify workspace exists
  const { data: ws } = await supabase
    .from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!ws) return "workspace_not_found";

  if (telegramId) {
    const { error } = await supabase
      .from("allowed_users")
      .upsert({ telegram_id: telegramId, group_id: workspaceId }, { onConflict: "telegram_id" });
    if (error) throw new Error(error.message);
    return "ok";
  }

  if (username) {
    // May already be pending (no telegram_id yet)
    const { data: existing } = await supabase
      .from("allowed_users").select("id").eq("username", username).maybeSingle();
    if (existing) {
      await supabase.from("allowed_users").update({ group_id: workspaceId }).eq("username", username);
    } else {
      await supabase.from("allowed_users").insert({ username, group_id: workspaceId });
    }
    return "ok";
  }

  return "not_found";
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/lib/workspace.ts
git commit -m "feat(workspaces): add workspace.ts — getUserGroupId, checkAllowedWithGroup, CRUD"
```

---

## Task 4: handlers/workspace.ts — /workspace admin commands

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/workspace.ts`

- [ ] **Step 1: Create the handler**

```typescript
import { ADMIN_USER_ID } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";
import { listWorkspaces, createWorkspace, assignUserToWorkspace } from "../lib/workspace.ts";

export async function handleWorkspace(
  chatId: number,
  userId: number,
  argText: string,
): Promise<void> {
  if (userId !== ADMIN_USER_ID) {
    await sendMessage(chatId, "Недостаточно прав.");
    return;
  }

  const parts = argText.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  if (!sub || sub === "list") {
    const workspaces = await listWorkspaces();
    if (!workspaces.length) {
      await sendMessage(chatId, "Воркспейсов нет.");
      return;
    }
    const lines = workspaces.map((w) => `• <code>${w.id}</code> — ${w.name}`).join("\n");
    await sendMessage(chatId, `<b>Воркспейсы:</b>\n\n${lines}`);
    return;
  }

  if (sub === "create") {
    // /workspace create europa Европа
    const id = parts[1];
    const name = parts.slice(2).join(" ");
    if (!id || !name) {
      await sendMessage(chatId, "Использование: <code>/workspace create &lt;id&gt; &lt;название&gt;</code>\nПример: <code>/workspace create europa Европа</code>");
      return;
    }
    try {
      await createWorkspace(id, name);
      await sendMessage(chatId, `✅ Воркспейс <code>${id}</code> — <b>${name}</b> создан.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sendMessage(chatId, msg.includes("duplicate") ? `Воркспейс <code>${id}</code> уже существует.` : `Ошибка: ${msg}`);
    }
    return;
  }

  if (sub === "add" || sub === "move") {
    // /workspace add @username europa
    // /workspace move @username other
    const target = parts[1];
    const workspaceId = parts[2];
    if (!target || !workspaceId) {
      await sendMessage(chatId, `Использование: <code>/workspace ${sub} @username &lt;workspace_id&gt;</code>`);
      return;
    }

    let telegramId: number | null = null;
    let username: string | null = null;
    if (/^\d+$/.test(target)) {
      telegramId = Number(target);
    } else {
      username = target.replace(/^@/, "");
    }

    const result = await assignUserToWorkspace(telegramId, username, workspaceId);
    if (result === "workspace_not_found") {
      await sendMessage(chatId, `Воркспейс <code>${workspaceId}</code> не найден. Создай его через <code>/workspace create</code>.`);
    } else if (result === "not_found") {
      await sendMessage(chatId, "Пользователь не найден.");
    } else {
      const label = sub === "move" ? "Перемещён" : "Добавлен";
      const who = telegramId ? `ID ${telegramId}` : `@${username}`;
      await sendMessage(chatId, `✅ ${label}: ${who} → воркспейс <code>${workspaceId}</code>.`);
    }
    return;
  }

  await sendMessage(chatId, "Подкоманды: <code>/workspace list</code> · <code>/workspace create &lt;id&gt; &lt;название&gt;</code> · <code>/workspace add @user &lt;id&gt;</code> · <code>/workspace move @user &lt;id&gt;</code>");
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/workspace.ts
git commit -m "feat(workspaces): add /workspace command handler (superadmin only)"
```

---

## Task 5: Update index.ts — workspace resolution + routing

**Files:**
- Modify: `supabase/functions/swarm-bot/index.ts`

The key change: replace `checkAllowed` with `checkAllowedWithGroup`, pass `groupId` to handlers. Currently `checkAllowed` is imported from `lib/storage.ts`. We replace it with `checkAllowedWithGroup` from `lib/workspace.ts`.

- [ ] **Step 1: Update imports at top of index.ts**

Old:
```typescript
import { checkAllowed, autoSyncProfile, getSession, clearSession } from "./lib/storage.ts";
```

New:
```typescript
import { autoSyncProfile, getSession, clearSession } from "./lib/storage.ts";
import { checkAllowedWithGroup } from "./lib/workspace.ts";
import { handleWorkspace } from "./handlers/workspace.ts";
```

- [ ] **Step 2: Update callback_query handler — replace checkAllowed**

Old (line ~93):
```typescript
if (!(await checkAllowed(userId))) return new Response("OK", { status: 200 });
```

New:
```typescript
const { allowed: cbAllowed, groupId: cbGroupId } = await checkAllowedWithGroup(userId);
if (!cbAllowed) return new Response("OK", { status: 200 });
```

Then pass `cbGroupId` where needed in the callback handlers (Tasks 6–11 will update those handlers to accept groupId; for now just resolve it here).

- [ ] **Step 3: Update message handler — replace checkAllowed**

Old (line ~124):
```typescript
const allowed = await checkAllowed(userId, message.from?.username);
if (!allowed) {
  await sendMessage(chatId, "Доступ запрещён. Обратитесь к администратору.");
  return new Response("OK", { status: 200 });
}
```

New:
```typescript
const { allowed, groupId } = await checkAllowedWithGroup(userId, message.from?.username);
if (!allowed) {
  await sendMessage(chatId, "Доступ запрещён. Обратитесь к администратору.");
  return new Response("OK", { status: 200 });
}
```

- [ ] **Step 4: Add /workspace command routing**

In the command dispatch block, add after `/broadcast`:
```typescript
} else if (command === "/workspace") {
  await handleWorkspace(chatId, userId, argText);
```

- [ ] **Step 5: Update handleAdd call to pass groupId**

Old:
```typescript
await handleAdd(chatId, username, content || text);
// and
await handleAdd(chatId, username, argText);
```

New (both occurrences):
```typescript
await handleAdd(chatId, username, content || text, groupId);
// and
await handleAdd(chatId, username, argText, groupId);
```

- [ ] **Step 6: Update handleAsk call to pass userId and groupId**

Old:
```typescript
await handleAsk(chatId, argText.trim() ? argText : "");
// and in session handler:
await handleAsk(chatId, text);
```

New:
```typescript
await handleAsk(chatId, argText.trim() ? argText : "", userId, groupId);
// and:
await handleAsk(chatId, text, userId, groupId);
```

- [ ] **Step 7: Update /meetings query to filter by groupId**

Find the `/meetings` command block in index.ts (around line 237). Update the query:

Old:
```typescript
const { data: meetings } = await supabase
  .from("entries")
  .select("id, metadata, created_at, source")
  .in("source", ["read_ai", "granola"])
  .or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false")
  .order("created_at", { ascending: false })
  .limit(20);
```

New:
```typescript
const { data: meetings } = await supabase
  .from("entries")
  .select("id, metadata, created_at, source")
  .eq("group_id", groupId)
  .in("source", ["read_ai", "granola"])
  .or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false")
  .order("created_at", { ascending: false })
  .limit(20);
```

- [ ] **Step 8: Update /status query to filter by groupId**

In the `/status` block, update all 5 parallel queries to add `.eq("group_id", groupId)`:

```typescript
supabase.from("entries").select("*", { count: "exact", head: true })
  .eq("group_id", groupId)
  .in("source", ["read_ai", "granola"]),
supabase.from("entries").select("id, metadata, created_at")
  .eq("group_id", groupId)
  .eq("source", "read_ai").eq("metadata->>confirmed", "false")
  .order("created_at", { ascending: false }),
supabase.from("entries").select("metadata, created_at, source")
  .eq("group_id", groupId)
  .in("source", ["read_ai", "granola"])
  .order("created_at", { ascending: false }).limit(1).maybeSingle(),
supabase.from("tasks").select("*", { count: "exact", head: true })
  .eq("group_id", groupId)
  .eq("status", "open"),
supabase.from("tasks").select("*", { count: "exact", head: true })
  .eq("group_id", groupId)
  .eq("status", "open").lt("due_date", new Date().toISOString().split("T")[0]),
```

- [ ] **Step 9: Update media handlers to pass groupId**

In the media dispatch block (lines ~133–144):
```typescript
if (message.voice) { await handleVoice(chatId, username, message.voice.file_id, message.voice.duration, groupId); ... }
if (message.audio) { await handleVoice(chatId, username, message.audio.file_id, 0, groupId); ... }
if (message.document) { await handleDocument(chatId, username, message.document, groupId); ... }
// For photo:
await handlePhoto(chatId, username, message.photo, groupId);
```

- [ ] **Step 10: Update /digest call to pass groupId**

Old:
```typescript
bgRun(generatePersonalDigest(chatId, userId), chatId);
```

New:
```typescript
bgRun(generatePersonalDigest(chatId, userId, 7, groupId), chatId);
```

- [ ] **Step 11: Update callback_query block to pass groupId to handlers that need it**

In the callback_query block, pass `cbGroupId` where needed:
```typescript
if (await handleTaskCallbacks(cb, chatId, userId, username, cbGroupId)) {
```
(Only tasks needs it explicitly; meetings/granola/users get groupId internally — see respective tasks below.)

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/swarm-bot/index.ts
git commit -m "feat(workspaces): resolve groupId at entry point, thread through handlers"
```

---

## Task 6: Update handlers/knowledge.ts

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/knowledge.ts`

- [ ] **Step 1: Update handleAdd signature**

Old:
```typescript
export async function handleAdd(chatId: number, username: string, text: string): Promise<void> {
```

New:
```typescript
export async function handleAdd(chatId: number, username: string, text: string, groupId: string): Promise<void> {
```

Inside `handleAdd`, update the `saveEntry` call:

Old:
```typescript
const entryId = await saveEntry(text, username, "telegram", {}, summary ?? undefined);
```

New:
```typescript
const entryId = await saveEntry(text, username, "telegram", {}, summary ?? undefined, groupId);
```

- [ ] **Step 2: Update handleAsk signature**

Old:
```typescript
export async function handleAsk(chatId: number, question: string): Promise<void> {
```

New:
```typescript
export async function handleAsk(chatId: number, question: string, userId: number, groupId: string): Promise<void> {
```

Inside `handleAsk`, find the call to `executeTool` (it passes `userId` already) and update to pass `groupId`:

Find where `executeTool` is called in the AI loop inside `handleAsk` and update:
```typescript
const toolResult = await executeTool(toolCall.function.name, args, userId, groupId);
```

- [ ] **Step 3: Update executeTool signature and all queries inside**

Old:
```typescript
export async function executeTool(name: string, args: Record<string, unknown>, userId = 0): Promise<string> {
```

New:
```typescript
export async function executeTool(name: string, args: Record<string, unknown>, userId = 0, groupId = ""): Promise<string> {
```

Inside `executeTool`, update every query against `entries` to add `.eq("group_id", groupId)`:

For `search_knowledge` — update the keyword and file queries:
```typescript
// keyword search
supabase.from("entries").select("id, content, summary, source, metadata")
  .or(searchTerms.map(w => `source.ilike.%${w}%,content.ilike.%${w}%,summary.ilike.%${w}%`).join(","))
  .eq("group_id", groupId)       // ADD THIS
  .or(visibilityFilter(userId || 0))
  .limit(5)

// file search
supabase.from("entries").select("id, content, summary, source, metadata")
  .or(words.map(w => `metadata->>file_name.ilike.%${w}%`).join(","))
  .eq("group_id", groupId)       // ADD THIS
  .not("metadata->>file_url", "is", null)
  .or(visibilityFilter(userId || 0))
  .limit(3)
```

For the `match_entries` RPC call:
```typescript
supabase.rpc("match_entries", {
  query_embedding: `[${emb.join(",")}]`,
  match_threshold: 0.1,
  match_count: 8,
  requesting_user_id: userId || null,
}).eq("group_id", groupId)   // ADD THIS
```

For `get_recent_by_country` — update the `recentDirect` query:
```typescript
supabase.from("entries")
  .select("id, content, summary, source, entry_date, created_at, metadata")
  .gte("created_at", since)
  .eq("group_id", groupId)   // ADD THIS
  .or(`metadata->>title.ilike.%${country}%,content.ilike.%${country}%,summary.ilike.%${country}%`)
  .or(visibilityFilter(userId || 0))
  .order("created_at", { ascending: false })
  .limit(20)
```

And the fetch for vecIds (where it fetches full entries by IDs), add `.eq("group_id", groupId)`.

For `save_shared` — update the `saveEntry` call:
```typescript
await saveEntry(text, "claude", "claude", {}, undefined, groupId, false);
```

For `save_private` — update the `saveEntry` call:
```typescript
await saveEntry(text, "claude", "claude", {}, undefined, groupId, true, userId);
```

For `list_meetings_by_country`:
```typescript
supabase.from("entries")
  .select("id, metadata, entry_date, created_at, summary")
  .eq("group_id", groupId)   // ADD THIS
  .in("source", ["read_ai", "granola"])
  ...
```

For `list_personal`:
```typescript
supabase.from("entries")
  .select(...)
  .eq("is_private", true)
  .eq("owner_id", userId)
  // No group_id filter here — personal entries travel with the user
  ...
```

For `export_entry` and `get_entry`:
```typescript
supabase.from("entries").select("content, metadata, source").eq("id", entryId).eq("group_id", groupId)...
```

- [ ] **Step 4: Update handleAsk call to smartTaskSearch to pass groupId**

Find where `smartTaskSearch(chatId, question)` is called inside `handleAsk` and update to pass groupId if that function accepts it. If not, defer to Task 9 to update.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/knowledge.ts
git commit -m "feat(workspaces): scope all knowledge queries to groupId"
```

---

## Task 7: Update handlers/media.ts

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/media.ts`

- [ ] **Step 1: Update function signatures**

Find the exported handler functions and add `groupId: string` parameter to each:

```typescript
export async function handleVoice(chatId: number, username: string, fileId: string, duration: number, groupId: string): Promise<void>
export async function handleDocument(chatId: number, username: string, doc: TgDocument, groupId: string): Promise<void>
export async function handlePhoto(chatId: number, username: string, photos: TgPhotoSize[], groupId: string): Promise<void>
export async function handleUrl(chatId: number, username: string, url: string, text: string, analyze: boolean, groupId: string): Promise<void>
```

- [ ] **Step 2: Update every saveEntry call inside each handler**

For each `saveEntry(...)` call inside the media handlers, add `groupId` as the 6th argument (after `summary`):

```typescript
// Before:
await saveEntry(content, username, "voice", metadata, summary);
// After:
await saveEntry(content, username, "voice", metadata, summary, groupId);
```

Do this for all sources: `"voice"`, `"pdf"`, `"document"`, `"photo"`, `"url"`, `"excel"`, etc.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/media.ts
git commit -m "feat(workspaces): pass groupId to all media saveEntry calls"
```

---

## Task 8: Update handlers/meetings.ts

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/meetings.ts`

- [ ] **Step 1: Find and update all entries queries**

Read the file and add `.eq("group_id", groupId)` to every `supabase.from("entries")` query. The main queries to update:

- The list query for unconfirmed meetings
- The detail query when opening a specific meeting
- Any update/delete also should verify ownership within workspace (add `.eq("group_id", groupId)` to updates/deletes as an extra safety check)

The `handleMeetings` function and `handleMeetingCallbacks` both query entries — add `groupId` parameter to both:

```typescript
export async function handleMeetings(chatId: number, userId: number, argText: string, groupId: string): Promise<void>

export async function handleMeetingCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
  groupId: string,
): Promise<boolean>
```

Inside callbacks, pass `groupId` to the queries. For reads:
```typescript
supabase.from("entries").select(...).eq("id", entryId).eq("group_id", groupId)
```

For updates (confirm, rename, date change):
```typescript
supabase.from("entries").update({...}).eq("id", entryId).eq("group_id", groupId)
```

For deletes:
```typescript
supabase.from("entries").delete().eq("id", entryId).eq("group_id", groupId)
```

- [ ] **Step 2: Update handleMeetingSessionInput if it queries entries**

Add `groupId` parameter and filter queries the same way.

- [ ] **Step 3: Update the calls in index.ts**

In the callback_query block in index.ts:
```typescript
} else if (await handleMeetingCallbacks(cb, chatId, userId, username, cbGroupId)) {
```

In the session handler in index.ts (this is in the **message** handler, so use `groupId` not `cbGroupId`):
```typescript
} else if (action && await handleMeetingSessionInput(chatId, action, text, groupId)) {
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/meetings.ts
git commit -m "feat(workspaces): scope meetings queries to groupId"
```

---

## Task 9: Update tasks — db.ts, types.ts, handlers

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/db.ts`
- Modify: `supabase/functions/swarm-bot/tasks/types.ts`

- [ ] **Step 1: Add group_id to TaskInput in types.ts**

In `tasks/types.ts`, find `TaskInput` and add:
```typescript
export type TaskInput = {
  // ... existing fields ...
  group_id?: string;
};
```

Also add `group_id?: string` to the `Task` type if it's defined there.

- [ ] **Step 2: Update dbListTasks to accept groupId**

Old:
```typescript
export async function dbListTasks(opts: {
  assignee?: string;
  telegramId?: number;
  country?: string;
  status?: string;
  period?: string;
  limit?: number;
}): Promise<Task[]>
```

New (add `groupId` to opts):
```typescript
export async function dbListTasks(opts: {
  assignee?: string;
  telegramId?: number;
  country?: string;
  status?: string;
  period?: string;
  limit?: number;
  groupId?: string;
}): Promise<Task[]>
```

Inside the function, add after `let q = supabase.from("tasks").select("*")...`:
```typescript
if (opts.groupId) q = q.eq("group_id", opts.groupId);
```

- [ ] **Step 3: Update dbListAllOpen to accept groupId**

Old:
```typescript
export async function dbListAllOpen(): Promise<Task[]>
```

New:
```typescript
export async function dbListAllOpen(groupId?: string): Promise<Task[]>
```

Inside, add:
```typescript
let q = supabase.from("tasks").select("*")
  .not("status", "in", '("done","cancelled","draft","pending")')
  .order("assignees", { ascending: true })
  .limit(200);
if (groupId) q = q.eq("group_id", groupId);
const { data } = await q;
return (data ?? []) as Task[];
```

- [ ] **Step 4: Update dbCreateTask to include group_id**

In the insert in `dbCreateTask`:
```typescript
const { data, error } = await supabase.from("tasks").insert({
  title: input.title,
  // ... existing fields ...
  group_id: input.group_id ?? null,
}).select().single();
```

- [ ] **Step 5: Update callers of dbListTasks / dbListAllOpen**

Find all files that call `dbListTasks` and `dbListAllOpen` (in `tasks/handlers.ts`, `tasks/index.ts`, `swarm-mcp/index.ts`) and pass `groupId`. For `tasks/handlers.ts`, add `groupId` parameter to the handler function and thread it through.

In `handleTaskCallbacks` and `handleTasks`, add `groupId: string` parameter:
```typescript
export async function handleTaskCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
  groupId: string,
): Promise<boolean>

export async function handleTasks(
  chatId: number,
  userId: number,
  argText: string,
  groupId: string,
): Promise<void>
```

Pass `groupId` to `dbListTasks({ ..., groupId })` and `dbListAllOpen(groupId)` throughout.

When creating tasks, include `group_id: groupId` in the `TaskInput`.

- [ ] **Step 6: Update index.ts calls for tasks**

```typescript
await handleTasks(chatId, userId, argText, groupId);
// and in callback:
if (await handleTaskCallbacks(cb, chatId, userId, username, cbGroupId)) {
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/swarm-bot/tasks/
git commit -m "feat(workspaces): scope all task queries to groupId"
```

---

## Task 10: Update handlers/granola.ts

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/granola.ts`

The granola handler does not receive `groupId` from `index.ts` for callbacks (callbacks come in without fresh context). Instead, `saveGranolaNote` will resolve `groupId` internally using `getUserGroupId(telegramId)`.

- [ ] **Step 1: Import getUserGroupId**

Add to imports at top of `granola.ts`:
```typescript
import { getUserGroupId } from "../lib/workspace.ts";
```

- [ ] **Step 2: Update saveGranolaNote to resolve groupId internally**

At the start of `saveGranolaNote`, before the insert, add:
```typescript
const groupId = await getUserGroupId(telegramId);
if (!groupId) {
  await sendMessage(chatId, "Ошибка: пользователь не привязан к воркспейсу.");
  return;
}
```

Then in the `supabase.from("entries").insert({...})` call, add:
```typescript
group_id: isPrivate ? null : groupId,
```
(Private entries don't use `group_id` for visibility — they use `owner_id`. Set `group_id` to groupId for private too for consistency, or null — either works since private filter uses `owner_id`. Recommend setting it to groupId for consistency.)

Actually set it to `groupId` for both private and public for consistency:
```typescript
group_id: groupId,
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/granola.ts
git commit -m "feat(workspaces): granola saveGranolaNote resolves groupId from telegramId"
```

---

## Task 11: Update handlers/digest.ts and handlers/users.ts

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/digest.ts`
- Modify: `supabase/functions/swarm-bot/handlers/users.ts`

- [ ] **Step 1: Update generatePersonalDigest signature**

Old:
```typescript
export async function generatePersonalDigest(chatId: number, userId: number, daysBack: number = 7): Promise<void>
```

New:
```typescript
export async function generatePersonalDigest(chatId: number, userId: number, daysBack = 7, groupId = ""): Promise<void>
```

Inside the function, add `.eq("group_id", groupId)` to the entries query:
```typescript
const { data: entries } = await supabase.from("entries")
  .select("summary, content, source, created_at")
  .eq("group_id", groupId)           // ADD THIS
  .gte("created_at", since)
  .not("source", "eq", "digest")
  .order("created_at", { ascending: false })
  .limit(50);
```

Also update `sendAllDigests` to pass groupId per user. In `sendAllDigests`, it fetches all users and sends digests. Update to resolve each user's `groupId`:
```typescript
// For each user in the digest loop:
import { getUserGroupId } from "../lib/workspace.ts";
// ...
const groupId = await getUserGroupId(user.telegram_id) ?? "";
await generatePersonalDigest(user.telegram_id, user.telegram_id, days, groupId);
```

- [ ] **Step 2: Update handleUsers to filter by groupId**

In `handlers/users.ts`, `handleUsers` currently shows all users. After workspaces, it should only show users in the same workspace.

Add `groupId: string` parameter to `handleUsers`:
```typescript
export async function handleUsers(chatId: number, adminId: number, argText: string, groupId: string): Promise<void>
```

In the list query, add the workspace filter:
```typescript
const { data, error } = await supabase
  .from("allowed_users")
  .select("telegram_id, username, group_id")
  .eq("group_id", groupId)   // ADD THIS
  .order("created_at");
```

Remove the hardcoded admin row insertion since the admin is now in `allowed_users`:
```typescript
// REMOVE this line:
const allUsers = [
  { telegram_id: ADMIN_USER_ID, username: null },
  ...(data ?? []).map(...),
];
// Replace with:
const allUsers = (data ?? []).map((u: { telegram_id: number; username: string | null }) => u);
```

For `handleUsers add` — when adding a user, default to admin's `groupId`:
```typescript
await supabase.from("allowed_users").insert({ telegram_id: null, username: uname, added_by: adminId, group_id: groupId });
```

Update `handleBroadcast` to only broadcast to users in the admin's workspace:
```typescript
const { data: users } = await supabase
  .from("allowed_users")
  .select("telegram_id")
  .eq("group_id", groupId)       // ADD THIS
  .not("telegram_id", "is", null)
  .neq("telegram_id", adminId);
```

- [ ] **Step 3: Update calls in index.ts**

```typescript
await handleUsers(chatId, userId, argText, groupId);
await handleBroadcast(chatId, userId, argText, groupId);
```

Update `handleBroadcast` signature too:
```typescript
export async function handleBroadcast(chatId: number, adminId: number, text: string, groupId: string): Promise<void>
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/digest.ts supabase/functions/swarm-bot/handlers/users.ts
git commit -m "feat(workspaces): scope digest and users to groupId"
```

---

## Task 12: Update read-ai-webhook

**Files:**
- Modify: `supabase/functions/read-ai-webhook/index.ts`

The Read.ai integration uses a single global OAuth token (stored in `app_settings`). All meetings from Read.ai belong to the Europa workspace until multi-account Read.ai support is added.

- [ ] **Step 1: Add group_id to the entry insert in read-ai-webhook**

Find the `supabase.from("entries").insert({...})` call (or equivalent) in `read-ai-webhook/index.ts` and add:
```typescript
group_id: "europa",
```

This is a hardcoded constant — add a comment explaining why:
```typescript
// Read.ai uses a single OAuth token tied to the Europa workspace.
// To support multiple workspaces, Read.ai auth would need to be per-workspace.
group_id: "europa",
```

- [ ] **Step 2: Deploy read-ai-webhook**

```bash
supabase functions deploy read-ai-webhook --no-verify-jwt
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/read-ai-webhook/index.ts
git commit -m "feat(workspaces): hardcode group_id=europa for Read.ai webhook (single OAuth)"
```

---

## Task 13: Update swarm-mcp

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts`

The MCP server has its own copy of `visibilityFilter`. It accepts `requesting_user_id` to identify the caller. We resolve `groupId` from the DB using `requesting_user_id` and filter all queries.

- [ ] **Step 1: Add getUserGroupId helper to swarm-mcp**

The MCP server doesn't import from `swarm-bot/lib/`, so add a local helper at the top of `swarm-mcp/index.ts`:

```typescript
async function getUserGroupId(userId: number): Promise<string | null> {
  const { data } = await supabase
    .from("allowed_users")
    .select("group_id")
    .eq("telegram_id", userId)
    .maybeSingle();
  return data?.group_id ?? null;
}
```

- [ ] **Step 2: Update search_knowledge tool**

Find the `search_knowledge` tool handler. Currently it uses `requesting_user_id` for visibility. Add workspace scoping:

```typescript
case "search_knowledge": {
  const query = String(params.query ?? "");
  const limit = Math.min(Number(params.limit ?? 5), 20);
  const reqUserId = Number(params.requesting_user_id ?? 0);
  const groupId = reqUserId ? (await getUserGroupId(reqUserId) ?? "") : "";

  const embedding = await getEmbedding(query);
  let q = supabase.rpc("match_entries", {
    query_embedding: `[${embedding.join(",")}]`,
    match_threshold: 0.2,
    match_count: limit * 2,
    requesting_user_id: reqUserId || null,
  });
  if (groupId) q = q.eq("group_id", groupId);   // ADD THIS
  const { data } = await q;
  // ... rest unchanged
```

- [ ] **Step 3: Update add_knowledge tool**

Find the `add_knowledge` handler and add `group_id` to the insert:

```typescript
case "add_knowledge": {
  const reqUserId = Number(params.owner_telegram_id ?? params.requesting_user_id ?? 0);
  const groupId = reqUserId ? (await getUserGroupId(reqUserId) ?? "") : "";
  // ... existing logic ...
  const { error } = await supabase.from("entries").insert({
    // ... existing fields ...
    group_id: isPrivate ? groupId : groupId,   // always set groupId
  });
```

- [ ] **Step 4: Update list_entries tool**

Add workspace filter:
```typescript
case "list_entries": {
  const reqUserId = Number(params.requesting_user_id ?? 0);
  const groupId = reqUserId ? (await getUserGroupId(reqUserId) ?? "") : "";
  let q = supabase.from("entries").select(...);
  if (groupId) q = q.eq("group_id", groupId);
  if (reqUserId) q = q.or(visibilityFilter(reqUserId));
  // ... rest
```

- [ ] **Step 5: Update get_meetings and get_tasks tools**

For `get_meetings`:
```typescript
const groupId = reqUserId ? (await getUserGroupId(reqUserId) ?? "") : "";
let q = supabase.from("entries").select(...)...;
if (groupId) q = q.eq("group_id", groupId);
```

For `get_tasks` — find the task query and add:
```typescript
const groupId = reqUserId ? (await getUserGroupId(reqUserId) ?? "") : "";
let q = supabase.from("tasks").select("*")...;
if (groupId) q = q.eq("group_id", groupId);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(workspaces): scope all swarm-mcp queries to caller's groupId"
```

---

## Task 14: Deploy and verify

- [ ] **Step 1: Deploy swarm-bot**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

- [ ] **Step 2: Deploy swarm-mcp**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
```

- [ ] **Step 3: Smoke test existing user (Europa)**

In Telegram, as yourself:
1. `/ask что последнее по Сербии` — should return results (Europa data visible)
2. `/add Тест воркспейса: запись из Европы` — should save with `group_id = 'europa'`
3. `/tasks` — should show existing tasks
4. `/status` — should show correct counts

- [ ] **Step 4: Smoke test workspace commands**

```
/workspace list           → should show "europa — Европа"
/workspace create other Остальные страны
/workspace list           → should show both workspaces
/workspace add @testuser other
```

- [ ] **Step 5: Verify data isolation**

Add a test user to "other" workspace, have them `/ask` — should return empty (no data in "other" yet).
Have them `/add Тест из другого воркспейса`.
Have yourself `/ask` — should NOT see the test entry.

- [ ] **Step 6: Verify private entries travel with user**

1. Create a private entry as yourself: `/add` then choose "В личное"
2. Check it's visible via `/ask моё личное`
3. Move yourself to another workspace: `/workspace move @you other`
4. Check private entry is still visible (filtered by `owner_id`, not `group_id`)
5. Move back: `/workspace move @you europa`

- [ ] **Step 7: Final commit and update ARCHITECTURE.md**

Update `ARCHITECTURE.md`:
- Add `workspaces` table to the tables section
- Add `group_id` column notes for `entries`, `tasks`, `allowed_users`
- Add `/workspace` to the commands list
- Add the workspace isolation rule to the "Контроль доступа" section

```bash
git add ARCHITECTURE.md CHANGELOG.md
git commit -m "docs: update ARCHITECTURE.md and CHANGELOG.md for workspaces feature"
```

---

## Known limitations (document, don't fix now)

1. **Read.ai**: single OAuth token hardcoded to Europa. Multi-workspace Read.ai requires per-workspace OAuth storage in `app_settings`.
2. **`match_entries` RPC**: the Postgres function likely has its own visibility logic. Adding `.eq("group_id", groupId)` at the application layer is correct but ideally the RPC would also accept `group_id` natively.
3. **`granola-poller`**: the poller only sends notifications, saving happens in swarm-bot. But note: if the poller is ever updated to save directly, it must resolve `group_id` per user.
