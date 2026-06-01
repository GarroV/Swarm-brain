# Mini App — Design Spec

**Date:** 2026-06-01  
**Status:** Approved — ready for implementation

---

## Goal

Build `miniapp/` — a Telegram Mini App (kanban task board) deployed as a static site on Cloudflare Pages. All data fetched from `swarm-api` Edge Function. No server-side rendering, no Next.js API routes.

---

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14, `output: 'export'`, TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Auth | `@twa-dev/sdk` → `Telegram.WebApp.initData` |
| Data | Plain `fetch` + `useEffect` |
| Deploy | Cloudflare Pages (`out/` directory) |

---

## Build Config

`next.config.ts`:
```ts
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};
```

Cloudflare Pages settings:
- Build command: `npm run build`
- Output directory: `out`

---

## Project Structure

```
miniapp/
├── next.config.ts
├── .env.local.example          # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEV_MODE
├── src/
│   ├── app/
│   │   ├── layout.tsx          # globals + TelegramProvider
│   │   ├── page.tsx            # root → KanbanBoard
│   │   └── globals.css         # Tailwind base
│   ├── components/
│   │   ├── KanbanBoard.tsx     # tabs + column rendering + polling
│   │   ├── TaskCard.tsx        # card + status buttons + edit/delete
│   │   ├── TaskModal.tsx       # create / edit dialog (shadcn Dialog)
│   │   └── ui/                 # shadcn components
│   ├── lib/
│   │   ├── api.ts              # all fetch wrappers (+ mock data in DEV_MODE)
│   │   └── telegram.ts         # initData init + dev mock
│   └── types.ts                # Task, User, Me (mirrors _shared/tasks/types.ts)
└── out/                        # next build output → Cloudflare Pages
```

---

## Auth & Dev Mode

**`lib/telegram.ts`**

- In production: call `window.Telegram.WebApp.initData` via `@twa-dev/sdk`.
- When `NEXT_PUBLIC_DEV_MODE=true` (or Telegram context absent): `initData` = empty string. The module still exports a valid `getInitData()` function; `api.ts` uses it.

**`lib/api.ts`**

- If `DEV_MODE`: every function returns local mock data immediately — no network calls, no Authorization header. This tests UI and logic only.
- In prod: every function adds `Authorization: tma <initData>` header.
- **Never** bypass auth in `swarm-api` itself.

**Important:** dev mode verifies UI/logic only. Real `initData` auth can only be tested by opening the app from Telegram.

---

## API Functions (`lib/api.ts`)

| Function | Method | Endpoint |
|----------|--------|----------|
| `fetchMe()` | GET | `/me` → `{ telegram_id, name, group_id, language }` |
| `fetchUsers()` | GET | `/users` → `User[]` |
| `fetchTasks(status?)` | GET | `/tasks?status=` → `Task[]` |
| `createTask(input)` | POST | `/tasks` → `Task` |
| `updateTask(id, fields)` | PATCH | `/tasks/:id` → `Task` |
| `deleteTask(id)` | DELETE | `/tasks/:id` → 204 |

Base URL: `process.env.NEXT_PUBLIC_API_URL`

---

## Components

### `KanbanBoard`

- Calls `fetchMe()` once on mount → stores user name for header greeting.
- Three tabs: **Open / In Progress / Done**. One tab active at a time = one column shown.
- `cancelled` tasks are not shown (intentional — no tab for them).
- Polling: `setInterval(fetchTasks, 10_000)` + immediate refetch on `document.visibilitychange` (when hidden → visible).
- "＋ New task" button → opens `TaskModal` in create mode.

### `TaskCard`

- Displays: title, assignees, due_date, country, task_role.
- Status buttons (next logical state only):
  - `open` → button "→ In Progress"
  - `in_progress` → buttons "→ Done" and "← Back to Open"
  - `done` → button "← Reopen"
- "Edit" button → opens `TaskModal` in edit mode.
- "Delete" button → confirm dialog → `deleteTask(id)` → refetch.

### `TaskModal` (shadcn `Dialog`)

Works for both create and edit (prop: `task?: Task`).

Fields:
| Field | Type | Notes |
|-------|------|-------|
| `title` | text input | required |
| `description` | textarea | optional |
| `due_date` | date input | optional |
| `assignee` | select from `/users` | single assignee, optional |
| `country` | text input | optional, free text |
| `task_role` | select | fixed values: `marketing / bd / rnd` |

On save: `createTask(input)` or `updateTask(id, fields)` → close modal → refetch tasks.

---

## Error Handling

| HTTP code | Behaviour |
|-----------|-----------|
| 401 | Full-screen "No access" message |
| 403 | Full-screen "No workspace assigned" message |
| Network error | Toast / inline error message |
| Other 4xx/5xx | Toast / inline error message |

---

## Environment Variables

```env
NEXT_PUBLIC_API_URL=https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-api
NEXT_PUBLIC_DEV_MODE=false
```

In dev: create `.env.local` with `NEXT_PUBLIC_DEV_MODE=true`.

---

## Out of Scope (v1)

- Drag-and-drop column reordering
- Multi-column desktop kanban view
- Filters / search
- Task comments
- Real-time (Supabase Realtime / websockets)
