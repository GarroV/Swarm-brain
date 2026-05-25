# Private Space — Design Spec
_Date: 2026-05-25_

## Problem

All entries in `entries` are currently shared across all users. There's no way to save personal or sensitive meeting notes that only the author should see.

## Solution

Approach A: add `is_private` and `owner_id` fields to the existing `entries` table. Filtering is applied at the query level via a shared helper. A single centralized `visibilityFilter(userId)` function ensures no query path is missed.

## Database

### Migration

```sql
alter table entries
  add column if not exists is_private boolean not null default false,
  add column if not exists owner_id bigint references allowed_users(telegram_id);

create index if not exists entries_owner_id_idx on entries(owner_id);
```

Existing entries are unaffected — `is_private` defaults to `false`, `owner_id` to `null`.

### `match_entries` RPC

Add parameter `requesting_user_id bigint default null`. Filter:

```sql
where (is_private = false) or (owner_id = requesting_user_id)
```

If `requesting_user_id` is null, only public entries are returned (safe default).

## Backend: `storage.ts`

### `visibilityFilter(userId)`

Single function used in every `entries` query:

```typescript
export function visibilityFilter(userId: number) {
  return `is_private.eq.false,and(is_private.eq.true,owner_id.eq.${userId})`;
}
// Usage: .or(visibilityFilter(userId))
```

### `saveEntry` signature update

Two optional params added at the end (backwards compatible):

```typescript
export async function saveEntry(
  content: string,
  addedBy: string,
  source: string,
  metadata: Record<string, unknown> = {},
  summary?: string,
  groupId?: string,
  isPrivate = false,
  ownerId?: number
): Promise<string>
```

Throws if `isPrivate = true` and `ownerId` is not provided.

## Telegram Bot

### Text messages

`handleAsk` passes `userId` to `executeTool`. GPT understands intent ("личное", "только для меня", "не шерить", etc.) via natural language — no keyword list. When private intent is detected, GPT calls `save_private` tool which invokes `saveEntry(..., true, userId)`.

### Meetings (Granola / Read.ai)

Existing save button row gets a second option:

```
[ 💾 Сохранить ]  [ 🔒 В личное ]
```

Callback: `meeting_save_private_<id>` — saves with `isPrivate=true, ownerId=chatId`.

## MCP (Claude Desktop)

### `add_knowledge`

New optional parameter: `is_private: boolean`. When user says "закинь в личное хранилище" or similar, Claude passes `is_private: true`. `owner_id` is derived from the Telegram user context already present in MCP headers.

### `search_knowledge` and `list_entries`

`owner_id` is passed into all query paths (vector, keyword, file). User sees: all public entries + their own private entries. No one else sees private entries.

### `get_entry` / `export_entry`

Same visibility filter applied — direct ID access respects privacy.

## Security Model

- Risk: developer adds a new query path and forgets the filter → private entry leaks
- Mitigation: `visibilityFilter()` is the single source of truth. All queries must use it. Code review checklist item.
- Acceptable for internal trusted team. Not suitable for multi-tenant SaaS without RLS.

## Out of Scope

- Sharing a private entry with specific users
- Bulk migration of existing entries to private
- UI indicator showing "this entry is private" in search results (can be added later)
