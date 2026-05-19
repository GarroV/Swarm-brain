# LLM User Matching from Transcripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragile string-matching in `analyzeAndCreateTasks` with LLM-based matching using `telegram_id`, so names mentioned in transcripts reliably map to user profiles regardless of spelling, abbreviations, or script (Cyrillic/Latin).

**Architecture:** Pass the full user list as JSON with `telegram_id` in the LLM prompt and have the model return `assignee_id: number | null`. After parsing, do a direct map lookup by ID — no fuzzy string comparison. Schema (`assignees text[]`) stays unchanged; we write the resolved display name as before.

**Tech Stack:** Deno, TypeScript, Supabase Edge Functions, OpenAI via `chatComplete`

---

### Task 1: Update `analyzeAndCreateTasks` in `tasks.ts`

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/tasks.ts:108-161`

- [ ] **Step 1: Update the Supabase select to include `telegram_id`, `username`, `role`**

Replace line 109:
```ts
const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, markets");
```
With:
```ts
const { data: profiles } = await supabase.from("user_profiles").select("telegram_id, first_name, last_name, username, role, markets");
```

- [ ] **Step 2: Update the `Profile` type**

Replace line 111:
```ts
type Profile = { first_name?: string; last_name?: string; markets?: string[] };
```
With:
```ts
type Profile = { telegram_id: number; first_name?: string; last_name?: string; username?: string; role?: string; markets?: string[] };
```

- [ ] **Step 3: Build a JSON user list for the prompt**

Replace lines 113-117 (the `userList` block):
```ts
const userList = JSON.stringify(
  (profiles ?? []).map((p: Profile) => ({
    id: p.telegram_id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.telegram_id),
    username: p.username ?? null,
    role: p.role ?? null,
    markets: p.markets ?? [],
  }))
);
```

- [ ] **Step 4: Update the LLM prompt to request `assignee_id`**

Replace lines 119-127 (the `chatComplete` call):
```ts
const raw = await chatComplete(
  `Ты анализируешь текст командной базы знаний. Извлеки задачи — только конкретные поручения/действия.\n` +
  `Члены команды (JSON): ${userList || "[]"}\n` +
  `Если в тексте упоминается страна/рынок — назначь задачу ответственному за этот рынок по полю markets.\n` +
  `Верни ТОЛЬКО JSON без markdown:\n` +
  `{"tasks":[{"title":"Название задачи","assignee_id":123456789,"due_date":"YYYY-MM-DD или null","confidence":0.9}]}\n` +
  `assignee_id — поле id из списка выше, или null если исполнитель неизвестен.\n` +
  `Создавай задачи только с confidence >= 0.7. Если задач нет — {"tasks":[]}.`,
  content.slice(0, 6000)
);
```

- [ ] **Step 5: Update the parsed task type**

Replace line 129:
```ts
let tasks: Array<{ title: string; assignee: string | null; due_date: string | null; confidence: number }> = [];
```
With:
```ts
let tasks: Array<{ title: string; assignee_id: number | null; due_date: string | null; confidence: number }> = [];
```

- [ ] **Step 6: Build `profileMap` and replace string-matching loop**

Replace lines 137-156 (from `const profileNames` through the `insert` loop):
```ts
const profileMap: Record<number, string> = Object.fromEntries(
  (profiles ?? []).map((p: Profile) => [
    p.telegram_id,
    [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.telegram_id),
  ])
);

for (const task of tasks) {
  const assignees: string[] = [];
  if (task.assignee_id != null && profileMap[task.assignee_id]) {
    assignees.push(profileMap[task.assignee_id]);
  }
  await supabase.from("tasks").insert({
    title: task.title,
    assignees,
    due_date: task.due_date ?? null,
    tags: [],
    status: "pending",
    meeting_id: entryId,
  });
}
```

- [ ] **Step 7: Verify TypeScript compiles cleanly**

```bash
cd /Users/garva/swarm
deno check supabase/functions/swarm-bot/handlers/tasks.ts
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/tasks.ts
git commit -m "feat: LLM-based user matching from transcripts via telegram_id"
```

---

### Task 2: Deploy and smoke-test

**Files:** none (deploy only)

- [ ] **Step 1: Deploy the function**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

- [ ] **Step 2: Smoke-test via Telegram**

Send a voice message or document to the bot that contains a meeting transcript with a clear task assignment mentioning a team member by name or nickname. Verify:
1. Bot responds with "📋 Найдено N задач"
2. Open "📋 Задачи → ⏳ На подтверждении" — the task should show the correct assignee name (not empty)

- [ ] **Step 3: Update CHANGELOG.md**

Add entry:
```markdown
## [unreleased]
### Changed
- `analyzeAndCreateTasks`: LLM now returns `telegram_id` for assignees instead of name strings; direct profile lookup replaces fragile `string.includes` matching
```
