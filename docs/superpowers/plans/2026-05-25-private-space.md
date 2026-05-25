# Private Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add personal private storage to Swarm Brain — entries marked as private are visible only to their owner, across both Telegram bot and Claude Desktop MCP.

**Architecture:** Add `is_private boolean` and `owner_id bigint` columns to the existing `entries` table. A single `visibilityFilter(userId)` helper centralizes access control. All query paths apply this filter. The MCP server accepts `requesting_user_id` as an explicit parameter (set via Claude Desktop project instructions).

**Tech Stack:** Deno, Supabase PostgreSQL, Supabase Edge Functions, Telegram Bot API, OpenAI GPT-4o-mini

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260525_private_space.sql` | CREATE | DB columns + updated match_entries RPC |
| `supabase/functions/swarm-bot/lib/storage.ts` | MODIFY | `visibilityFilter()`, updated `saveEntry()` |
| `supabase/functions/swarm-bot/handlers/knowledge.ts` | MODIFY | `save_private` tool, search paths pass userId |
| `supabase/functions/swarm-bot/handlers/granola.ts` | MODIFY | "🔒 В личное" button, `gcp_` callback |
| `supabase/functions/swarm-bot/handlers/meetings.ts` | MODIFY | Read.ai: prompt→save flow, private button |
| `supabase/functions/granola-poller/index.ts` | MODIFY | Add "🔒 В личное" to auto-notification buttons |
| `supabase/functions/swarm-mcp/index.ts` | MODIFY | `is_private` in add_knowledge, visibility filter in search/list/get_entry |
| `SETUP_CLAUDE_DESKTOP.md` | MODIFY | Instructions for private storage + Telegram ID |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260525_private_space.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add private space columns to entries
alter table entries
  add column if not exists is_private boolean not null default false,
  add column if not exists owner_id bigint references allowed_users(telegram_id);

create index if not exists entries_owner_id_idx on entries(owner_id);

-- Drop and recreate match_entries to add requesting_user_id parameter.
-- The original function returned all entries. New version filters:
--   - is_private = false (public), OR
--   - owner_id = requesting_user_id (owner's private entries)
-- If requesting_user_id is null, returns only public entries (safe default).

drop function if exists match_entries(vector, float, int);
drop function if exists match_entries(vector, float, int, bigint);

create or replace function match_entries(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  requesting_user_id bigint default null
)
returns table (
  id uuid,
  content text,
  summary text,
  source text,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    summary,
    source,
    metadata,
    created_at,
    1 - (embedding <=> query_embedding) as similarity
  from entries
  where
    1 - (embedding <=> query_embedding) > match_threshold
    and (
      is_private = false
      or (requesting_user_id is not null and owner_id = requesting_user_id)
    )
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

- [ ] **Step 2: Apply the migration**

```bash
supabase db push
```

Expected output: migration applied without errors. If `match_entries` signature differs in your project, check via Supabase Dashboard → Database → Functions and adjust the `drop function` statement accordingly.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525_private_space.sql
git commit -m "feat: add is_private + owner_id to entries, update match_entries RPC"
```

---

## Task 2: `visibilityFilter` and `saveEntry` in `storage.ts`

**Files:**
- Modify: `supabase/functions/swarm-bot/lib/storage.ts`

- [ ] **Step 1: Add `visibilityFilter` export after the existing imports**

Find the line:
```typescript
export async function extractEntryMeta(
```

Insert before it:
```typescript
// Returns an .or() filter string so callers see: public entries + their own private entries.
export function visibilityFilter(userId: number): string {
  return `is_private.eq.false,and(is_private.eq.true,owner_id.eq.${userId})`;
}
```

- [ ] **Step 2: Update `saveEntry` signature**

Replace the current signature:
```typescript
export async function saveEntry(content: string, addedBy: string, source: string, metadata: Record<string, unknown> = {}, summary?: string, groupId?: string): Promise<string> {
```

With:
```typescript
export async function saveEntry(content: string, addedBy: string, source: string, metadata: Record<string, unknown> = {}, summary?: string, groupId?: string, isPrivate = false, ownerId?: number): Promise<string> {
  if (isPrivate && !ownerId) throw new Error("saveEntry: ownerId required when isPrivate=true");
```

- [ ] **Step 3: Add `is_private` and `owner_id` to the insert**

Find the insert object in `saveEntry` (currently ends with `group_id: groupId ?? null`). Add two fields:

```typescript
    group_id: groupId ?? null,
    is_private: isPrivate,
    owner_id: ownerId ?? null,
```

- [ ] **Step 4: Deploy swarm-bot**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-bot/lib/storage.ts
git commit -m "feat(storage): add visibilityFilter helper, is_private/owner_id params to saveEntry"
```

---

## Task 3: `save_private` tool and search visibility in `knowledge.ts`

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/knowledge.ts`

- [ ] **Step 1: Add import for `visibilityFilter`**

Find:
```typescript
import { saveEntry, getSession, setSession, clearSession, generateSummary, autoSyncProfile, uploadToStorage } from "../lib/storage.ts";
```

Replace with:
```typescript
import { saveEntry, visibilityFilter, getSession, setSession, clearSession, generateSummary, autoSyncProfile, uploadToStorage } from "../lib/storage.ts";
```

- [ ] **Step 2: Add `save_private` to `KNOWLEDGE_TOOLS`**

At the end of the `KNOWLEDGE_TOOLS` array (before the closing `]`), add:

```typescript
  {
    type: "function" as const,
    function: {
      name: "save_private",
      description: "Save text to the user's PRIVATE personal storage. Use when user says 'личное', 'только для меня', 'не шерить', 'приватно', 'в личное хранилище', or any similar intent. Private entries are invisible to other team members.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text content to save privately" },
        },
        required: ["text"],
      },
    },
  },
```

- [ ] **Step 3: Update `executeTool` signature to accept `userId`**

Find:
```typescript
export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
```

Replace with:
```typescript
export async function executeTool(name: string, args: Record<string, unknown>, userId = 0): Promise<string> {
```

- [ ] **Step 4: Add `save_private` case in `executeTool`**

Inside the `switch (name)` block, add after the `export_entry` case (before the closing `default` or after the last case):

```typescript
      case "save_private": {
        const text = String(args.text ?? "");
        if (!text.trim()) return "Нечего сохранять — текст пустой.";
        if (!userId) return "Ошибка: не удалось определить пользователя.";
        const summary = await generateSummary(text);
        await saveEntry(text, String(userId), "telegram", {}, summary ?? undefined, undefined, true, userId);
        return "✅ Сохранено в личное хранилище.";
      }
```

- [ ] **Step 5: Add `visibilityFilter` to `search_knowledge` case — vector path**

Find inside `case "search_knowledge":`:
```typescript
          .then(emb => supabase.rpc("match_entries", {
            query_embedding: `[${emb.join(",")}]`,
            match_threshold: 0.1,
            match_count: 8,
          }).then(r => (r.data ?? []) as KbEntry[]))
```

Replace with:
```typescript
          .then(emb => supabase.rpc("match_entries", {
            query_embedding: `[${emb.join(",")}]`,
            match_threshold: 0.1,
            match_count: 8,
            requesting_user_id: userId || null,
          }).then(r => (r.data ?? []) as KbEntry[]))
```

- [ ] **Step 6: Add `visibilityFilter` to `search_knowledge` case — keyword path**

Find inside `case "search_knowledge":`:
```typescript
          ? supabase.from("entries").select("id, content, summary, source, metadata")
              .or(searchTerms.map(w => `source.ilike.%${w}%,content.ilike.%${w}%,summary.ilike.%${w}%`).join(","))
              .limit(5).then(r => (r.data ?? []) as KbEntry[]).catch(() => [] as KbEntry[])
```

Replace with:
```typescript
          ? supabase.from("entries").select("id, content, summary, source, metadata")
              .or(searchTerms.map(w => `source.ilike.%${w}%,content.ilike.%${w}%,summary.ilike.%${w}%`).join(","))
              .or(visibilityFilter(userId || 0))
              .limit(5).then(r => (r.data ?? []) as KbEntry[]).catch(() => [] as KbEntry[])
```

- [ ] **Step 7: Add `visibilityFilter` to `search_knowledge` case — file path**

Find inside `case "search_knowledge":`:
```typescript
          ? supabase.from("entries").select("id, content, summary, source, metadata")
              .or(words.map(w => `metadata->>file_name.ilike.%${w}%`).join(","))
              .not("metadata->>file_url", "is", null)
              .limit(3).then(r => (r.data ?? []) as KbEntry[]).catch(() => [] as KbEntry[])
```

Replace with:
```typescript
          ? supabase.from("entries").select("id, content, summary, source, metadata")
              .or(words.map(w => `metadata->>file_name.ilike.%${w}%`).join(","))
              .not("metadata->>file_url", "is", null)
              .or(visibilityFilter(userId || 0))
              .limit(3).then(r => (r.data ?? []) as KbEntry[]).catch(() => [] as KbEntry[])
```

- [ ] **Step 8: Add `visibilityFilter` to `get_recent_by_country` — both `match_entries` calls**

There are two `supabase.rpc("match_entries", ...)` calls in `get_recent_by_country`. Add `requesting_user_id: userId || null` to each, same pattern as Step 5.

Also find the follow-up `.from("entries")` queries in `get_recent_by_country` and add `.or(visibilityFilter(userId || 0))` to each, same pattern as Step 6.

- [ ] **Step 9: Update `handleAsk` to pass `chatId` as `userId` to `executeTool`**

Find inside `handleAsk` the tool call dispatch loop. Look for:
```typescript
          result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments) as Record<string, unknown>)
```

Replace with:
```typescript
          result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments) as Record<string, unknown>, chatId)
```

- [ ] **Step 10: Deploy and commit**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
git add supabase/functions/swarm-bot/handlers/knowledge.ts
git commit -m "feat(knowledge): add save_private tool, thread userId through search paths"
```

---

## Task 4: "🔒 В личное" button for Granola (bot handler)

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/granola.ts`

- [ ] **Step 1: Add private button to `sendNotesList` display**

Find in `sendNotesList` (the function that shows a list of notes to save manually):
```typescript
    await sendInlineMessage(chatId, text, [[
      { text: "✅ В базу", callback_data: `gc_${note.id}` },
      { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
    ]]);
```

Replace with:
```typescript
    await sendInlineMessage(chatId, text, [[
      { text: "✅ В базу", callback_data: `gc_${note.id}` },
      { text: "🔒 В личное", callback_data: `gcp_${note.id}` },
      { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
    ]]);
```

- [ ] **Step 2: Update `saveGranolaNote` to accept `isPrivate` flag**

Find:
```typescript
async function saveGranolaNote(noteId: string, telegramId: number, username: string, chatId: number): Promise<void> {
```

Replace with:
```typescript
async function saveGranolaNote(noteId: string, telegramId: number, username: string, chatId: number, isPrivate = false): Promise<void> {
```

- [ ] **Step 3: Pass `isPrivate` and `ownerId` into the `entries` insert in `saveGranolaNote`**

Find the `supabase.from("entries").insert({` block in `saveGranolaNote`. It ends with:
```typescript
    metadata: {
      granola_note_id: noteId,
      title,
      entry_date: entryDate,
      web_url: note.web_url,
      confirmed: false,
      added_by_telegram_id: telegramId,
    },
  });
```

Replace with:
```typescript
    metadata: {
      granola_note_id: noteId,
      title,
      entry_date: entryDate,
      web_url: note.web_url,
      confirmed: false,
      added_by_telegram_id: telegramId,
    },
    is_private: isPrivate,
    owner_id: isPrivate ? telegramId : null,
  });
```

- [ ] **Step 4: Update success message to distinguish private saves**

Find in `saveGranolaNote`:
```typescript
  await sendMessage(chatId, `📥 Встреча добавлена: <b>${title}</b>\n\nПроверь тезисы через /meetings`);
```

Replace with:
```typescript
  const label = isPrivate ? "🔒 Встреча добавлена в личное хранилище" : "📥 Встреча добавлена";
  await sendMessage(chatId, `${label}: <b>${title}</b>\n\nПроверь тезисы через /meetings`);
```

- [ ] **Step 5: Handle `gcp_` callback in `handleGranolaCallbacks`**

Find:
```typescript
  if (data.startsWith("gc_")) {
    await saveGranolaNote(data.replace("gc_", ""), userId, username, chatId);
    return true;
  }
```

Add after it:
```typescript
  if (data.startsWith("gcp_")) {
    await saveGranolaNote(data.replace("gcp_", ""), userId, username, chatId, true);
    return true;
  }
```

- [ ] **Step 6: Deploy and commit**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
git add supabase/functions/swarm-bot/handlers/granola.ts
git commit -m "feat(granola): add 'В личное' button and private save support"
```

---

## Task 5: "🔒 В личное" button for Granola poller (auto-notifications)

**Files:**
- Modify: `supabase/functions/granola-poller/index.ts`

- [ ] **Step 1: Add private button to auto-notification**

Find in `pollUser`:
```typescript
    await sendTelegram(integration.telegram_id, text, [[
      { text: "✅ В базу", callback_data: `gc_${note.id}` },
      { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
    ]]);
```

Replace with:
```typescript
    await sendTelegram(integration.telegram_id, text, [[
      { text: "✅ В базу", callback_data: `gc_${note.id}` },
      { text: "🔒 В личное", callback_data: `gcp_${note.id}` },
      { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
    ]]);
```

- [ ] **Step 2: Deploy and commit**

```bash
supabase functions deploy granola-poller --no-verify-jwt
git add supabase/functions/granola-poller/index.ts
git commit -m "feat(granola-poller): add 'В личное' button to auto-notifications"
```

---

## Task 6: "🔒 В личное" button for Read.ai meetings

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/meetings.ts`

The current flow: user taps meeting from list → `handleMeetingCallback` processes content and auto-saves. We change this to: process + show summary → show two buttons → save on button tap.

- [ ] **Step 1: Change `handleMeetingCallback` to not auto-save; store content in session instead**

Find the end of `handleMeetingCallback` where it saves and sends the result:
```typescript
  const entryId = await saveEntry(contentParts, username, "read_ai", { meeting_id: meetingId, title });
  await sendMessage(chatId, `<b>📋 ${title}</b>\n\n${gptResult}`);
  // DISABLED: await analyzeAndCreateTasks(contentParts, chatId, entryId);
```

Replace with:
```typescript
  // Store content in session; user chooses public or private before we save
  await setSession(chatId, `meeting_pending_${meetingId}`, JSON.stringify({ content: contentParts, title }));
  await sendMessage(chatId, `<b>📋 ${title}</b>\n\n${gptResult}`);
  await sendInlineMessage(chatId, "Сохранить встречу в базу знаний?", [[
    { text: "💾 В базу", callback_data: `meeting_save_pub_${meetingId}` },
    { text: "🔒 В личное", callback_data: `meeting_save_priv_${meetingId}` },
    { text: "🗑 Не сохранять", callback_data: `meeting_discard_${meetingId}` },
  ]]);
```

Make sure `setSession` and `sendInlineMessage` are imported. `setSession` comes from `../lib/storage.ts`, `sendInlineMessage` from `../lib/telegram.ts`. Check existing imports at the top of the file and add if missing.

- [ ] **Step 2: Add `userId` to `handleMeetingCallbacks` signature**

`handleMeetingCallbacks` currently takes `(cb, chatId, username)` — add `userId`:

```typescript
export async function handleMeetingCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
): Promise<boolean> {
  const data = cb.data;
```

And update the call in `index.ts` (find `handleMeetingCallbacks(cb, chatId, username)`, replace with):
```typescript
} else if (await handleMeetingCallbacks(cb, chatId, userId, username)) {
```

- [ ] **Step 3: Handle save callbacks in `handleMeetingCallbacks`**

Find:
```typescript
  if (data.startsWith("meeting_")) {
    await handleMeetingCallback(chatId, username, data.replace("meeting_", ""));
    return true;
  }
```

Replace with (new callbacks must come BEFORE the generic `meeting_` catch-all):
```typescript
  if (data.startsWith("meeting_save_pub_") || data.startsWith("meeting_save_priv_")) {
    const isPrivate = data.startsWith("meeting_save_priv_");
    const meetingId = data.replace("meeting_save_pub_", "").replace("meeting_save_priv_", "");
    const session = await getSession(chatId);
    if (!session?.action.startsWith("meeting_pending_")) {
      await sendMessage(chatId, "Данные встречи истекли. Открой встречу заново через /meetings.");
      return true;
    }
    const { content, title } = JSON.parse(session.context ?? "{}") as { content: string; title: string };
    await clearSession(chatId);
    await saveEntry(content, username, "read_ai", { meeting_id: meetingId, title }, undefined, undefined, isPrivate, isPrivate ? userId : undefined);
    const label = isPrivate ? "🔒 Встреча сохранена в личное хранилище" : "💾 Встреча сохранена в базу знаний";
    await sendMessage(chatId, `${label}: <b>${title}</b>`);
    return true;
  }

  if (data.startsWith("meeting_discard_")) {
    await clearSession(chatId);
    await sendMessage(chatId, "Встреча не сохранена.");
    return true;
  }

  if (data.startsWith("meeting_")) {
    await handleMeetingCallback(chatId, username, data.replace("meeting_", ""));
    return true;
  }
```

- [ ] **Step 3: Import `getSession`, `clearSession`, `sendInlineMessage` if not already present**

Check existing imports at top of `meetings.ts`. Add any missing:
```typescript
import { saveEntry, visibilityFilter, getSession, setSession, clearSession } from "../lib/storage.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
```

- [ ] **Step 4: Deploy and commit**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
git add supabase/functions/swarm-bot/handlers/meetings.ts
git commit -m "feat(meetings): change Read.ai save to prompt flow with private option"
```

---

## Task 7: Private storage in MCP (`swarm-mcp`)

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts`

- [ ] **Step 1: Add `visibilityFilter` helper at top of file (after existing helpers)**

After the `extractEntryMeta` function, add:

```typescript
function visibilityFilter(userId: number): string {
  return `is_private.eq.false,and(is_private.eq.true,owner_id.eq.${userId})`;
}
```

- [ ] **Step 2: Update `toolAddKnowledge` signature**

Find:
```typescript
async function toolAddKnowledge(args: { content?: string; summary: string; source?: string }): Promise<string> {
```

Replace with:
```typescript
async function toolAddKnowledge(args: { content?: string; summary: string; source?: string; is_private?: boolean; owner_telegram_id?: number }): Promise<string> {
```

- [ ] **Step 3: Pass `is_private` and `owner_id` into all inserts in `toolAddKnowledge`**

`toolAddKnowledge` has two insert paths — the first chunk and remaining chunks. 

For the first chunk, find:
```typescript
  await supabase.from("entries").insert({
    content: chunks[0],
    summary: args.summary,
    embedding: summaryEmbedding,
    added_by: "claude_desktop",
    source,
    metadata: chunks.length > 1 ? { total_chunks: chunks.length, chunk: 1 } : {},
    countries: entryMeta.countries,
    entry_type: entryMeta.entry_type,
    entry_date: entryMeta.entry_date,
    group_id: groupId,
  });
```

Replace with:
```typescript
  const isPrivate = args.is_private === true;
  const ownerId = isPrivate ? (args.owner_telegram_id ?? null) : null;
  if (isPrivate && !ownerId) return "Ошибка: для личного хранилища необходимо передать owner_telegram_id.";

  await supabase.from("entries").insert({
    content: chunks[0],
    summary: args.summary,
    embedding: summaryEmbedding,
    added_by: "claude_desktop",
    source,
    metadata: chunks.length > 1 ? { total_chunks: chunks.length, chunk: 1 } : {},
    countries: entryMeta.countries,
    entry_type: entryMeta.entry_type,
    entry_date: entryMeta.entry_date,
    group_id: groupId,
    is_private: isPrivate,
    owner_id: ownerId,
  });
```

For remaining chunks, find `supabase.from("entries").insert({` inside the `Promise.all` and add the same two fields:
```typescript
        is_private: isPrivate,
        owner_id: ownerId,
```

- [ ] **Step 4: Update `add_knowledge` return message to mention private**

Find the return statement at end of `toolAddKnowledge`:
```typescript
  return `✅ Добавлено в базу знаний (${chunks.length} ${chunks.length === 1 ? "часть" : "части/частей"}).`;
```

Replace with:
```typescript
  const dest = isPrivate ? "личное хранилище" : "базу знаний";
  return `✅ Добавлено в ${dest} (${chunks.length} ${chunks.length === 1 ? "часть" : "части/частей"}).`;
```

- [ ] **Step 5: Update `toolSearchKnowledge` to accept and use `requesting_user_id`**

Find:
```typescript
async function toolSearchKnowledge(args: { query: string; limit?: number }): Promise<string> {
  const embedding = await getEmbedding(args.query);
  const { data, error } = await supabase.rpc("match_entries", {
    query_embedding: `[${embedding.join(",")}]`,
    match_threshold: 0.35,
    match_count: Math.min(args.limit ?? 5, 20),
  });
```

Replace with:
```typescript
async function toolSearchKnowledge(args: { query: string; limit?: number; requesting_user_id?: number }): Promise<string> {
  const embedding = await getEmbedding(args.query);
  const { data, error } = await supabase.rpc("match_entries", {
    query_embedding: `[${embedding.join(",")}]`,
    match_threshold: 0.35,
    match_count: Math.min(args.limit ?? 5, 20),
    requesting_user_id: args.requesting_user_id ?? null,
  });
```

- [ ] **Step 6: Update `toolListEntries` to accept and use `requesting_user_id`**

Find:
```typescript
async function toolListEntries(args: { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number; has_file?: boolean }): Promise<string> {
  let query = supabase
    .from("entries")
    .select("id, source, entry_type, entry_date, created_at, summary, metadata")
    .order("created_at", { ascending: false })
    .limit(Math.min(args.limit ?? 20, 100));
```

Replace with:
```typescript
async function toolListEntries(args: { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number; has_file?: boolean; requesting_user_id?: number }): Promise<string> {
  let query = supabase
    .from("entries")
    .select("id, source, entry_type, entry_date, created_at, summary, metadata")
    .or(args.requesting_user_id ? visibilityFilter(args.requesting_user_id) : "is_private.eq.false")
    .order("created_at", { ascending: false })
    .limit(Math.min(args.limit ?? 20, 100));
```

- [ ] **Step 7: Update `toolGetEntry` to apply visibility check**

Replace the ENTIRE `toolGetEntry` function:

```typescript
async function toolGetEntry(args: { id: string; requesting_user_id?: number }): Promise<string> {
  const { data, error } = await supabase
    .from("entries")
    .select("content, source, created_at, is_private, owner_id")
    .eq("id", args.id)
    .maybeSingle();
  if (error) return `Ошибка: ${error.message}`;
  if (!data) return "Запись не найдена.";

  const row = data as { content: string; source: string; created_at: string; is_private: boolean; owner_id: number | null };
  if (row.is_private && row.owner_id !== (args.requesting_user_id ?? null)) {
    return "Запись не найдена.";
  }

  const date = new Date(row.created_at).toLocaleDateString("ru-RU");
  return `(${row.source} · ${date})\n\n${row.content}`;
}

- [ ] **Step 8: Update MCP tool schemas to expose new parameters**

Find the `add_knowledge` tool definition in `TOOLS` array. Add to its `inputSchema.properties`:
```typescript
      is_private: { type: "boolean", description: "Set true to save in personal private storage, invisible to other users" },
      owner_telegram_id: { type: "number", description: "Your Telegram user ID — required when is_private is true" },
```

Find the `search_knowledge` tool definition. Add to `inputSchema.properties`:
```typescript
      requesting_user_id: { type: "number", description: "Your Telegram user ID — include to see your private entries in results" },
```

Find the `list_entries` tool definition. Add to `inputSchema.properties`:
```typescript
      requesting_user_id: { type: "number", description: "Your Telegram user ID — include to see your private entries in results" },
```

Find the `get_entry` tool definition. Add to `inputSchema.properties`:
```typescript
      requesting_user_id: { type: "number", description: "Your Telegram user ID — required to access your private entries" },
```

- [ ] **Step 9: Update dispatch in `tools/call` handler**

Find each tool dispatch call and add the new params:
```typescript
      if (name === "search_knowledge") {
        result = await toolSearchKnowledge(args as { query: string; limit?: number; requesting_user_id?: number });
```
```typescript
      } else if (name === "add_knowledge") {
        result = await toolAddKnowledge(args as { content?: string; summary: string; source?: string; is_private?: boolean; owner_telegram_id?: number });
```
```typescript
      } else if (name === "list_entries") {
        result = await toolListEntries(args as { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number; has_file?: boolean; requesting_user_id?: number });
```
```typescript
      } else if (name === "get_entry") {
        result = await toolGetEntry(args as { id: string; requesting_user_id?: number });
```

- [ ] **Step 10: Deploy and commit**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(mcp): add private storage support — is_private in add_knowledge, visibility filter in search/list/get_entry"
```

---

## Task 8: Update Claude Desktop setup instructions

**Files:**
- Modify: `SETUP_CLAUDE_DESKTOP.md`

- [ ] **Step 1: Add Telegram ID instruction to project setup**

Find the project Instructions block (inside the triple backtick block in Шаг 2). Add to the end of the instructions block, before the closing ```:

```
## Личное хранилище

У каждого пользователя есть личное приватное хранилище. Записи в нём видны только тебе — другие участники команды их не видят.

**Как использовать:**
- Когда я говорю "закинь в личное", "только для меня", "приватно" — сохрани в личное хранилище
- При вызове `add_knowledge` с `is_private: true` — обязательно передавай `owner_telegram_id` (твой Telegram ID указан ниже)
- При поиске передавай `requesting_user_id` в `search_knowledge`, `list_entries`, `get_entry` — тогда в результатах будут и твои личные записи

**Мой Telegram ID:** [ВСТАВЬ СВОЙ TELEGRAM_ID ЗДЕСЬ]
```

- [ ] **Step 2: Update the tool reference table**

Find the table at the bottom. Update the `add_knowledge` row:
```
| `add_knowledge` | `content`, `summary`, `source`, `is_private`, `owner_telegram_id` | Добавить текст в базу (или личное хранилище) |
```

Add new rows for search:
```
| `search_knowledge` | `query`, `limit`, `requesting_user_id` | Найти информацию (включая личные записи) |
| `get_entry` | `id`, `requesting_user_id` | Полный текст записи по ID |
| `list_entries` | `source`, `entry_type`, `date_from`, `date_to`, `limit`, `has_file`, `requesting_user_id` | Список записей для ревизии |
```

- [ ] **Step 3: Commit**

```bash
git add SETUP_CLAUDE_DESKTOP.md
git commit -m "docs: update Claude Desktop setup for private storage — add Telegram ID instructions"
```

---

## Task 9: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add entry**

At the top of CHANGELOG.md add:

```markdown
## 2026-05-25 — Личное хранилище (Private Space)

- Добавлены поля `is_private` / `owner_id` в таблицу `entries`
- `match_entries` RPC обновлена: принимает `requesting_user_id`, возвращает только доступные записи
- `saveEntry()` поддерживает `isPrivate` / `ownerId` параметры
- `visibilityFilter()` — единый хелпер фильтрации, используется во всех запросах
- Telegram-бот: кнопка "🔒 В личное" при сохранении встреч Granola и Read.ai
- Telegram-бот: `save_private` tool — GPT сохраняет в личное по намерению пользователя
- MCP: `add_knowledge` поддерживает `is_private` + `owner_telegram_id`
- MCP: `search_knowledge`, `list_entries`, `get_entry` принимают `requesting_user_id` для видимости личных записей
- Claude Desktop инструкции обновлены: добавлен раздел про личное хранилище
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for private space feature"
```
