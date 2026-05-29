# Meeting Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reverse meeting save flow so tezises are always shown first, and add AI-assisted tezises editing via instruction (both before and after saving).

**Architecture:** Two files change — `granola.ts` and `meetings.ts`. The poller stops showing storage-choice buttons directly; a new `gedit_` callback + `granola_edit_preview_<noteId>` session action handle the pre-save edit loop. Post-save editing in `/meetings` switches from full-text replacement to GPT rewrite from instruction.

**Tech Stack:** Deno, TypeScript, Supabase Edge Functions, Telegram Bot API, OpenAI `chatComplete`. No test infrastructure exists — verification is deploy + test in Telegram.

---

## Files Modified

| File | What changes |
|------|-------------|
| `supabase/functions/swarm-bot/handlers/granola.ts` | Poller: remove `gc_`/`gcp_` buttons → add `gp_`+`gd_`. Preview: add "✏️ Переписать" button + `gedit_` callback. New `granola_edit_preview_*` session handler. |
| `supabase/functions/swarm-bot/handlers/meetings.ts` | `meeting_edit_summary_*` handler: replace full-text replacement with GPT rewrite from instruction. Update prompt text in `medit_` callback. |

---

## Task 1: Update poller to show tezises first

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/granola.ts` — `pollGranolaForUser` function (~lines 264–279)

**Context:** `pollGranolaForUser` currently shows "✅ В базу / 🔒 В личное / 🗑 Пропустить" directly. We change it to show only "🔍 Тезисы / 🗑 Пропустить", forcing the user to see tezises before choosing storage.

- [ ] **Step 1: Locate the poller notification block**

In `supabase/functions/swarm-bot/handlers/granola.ts`, find the inner `for` loop inside `pollGranolaForUser` (around line 265). Current code:

```typescript
const text = `📓 <b>${title}</b>\n📅 ${date}${attendeeNames ? `\n👥 ${attendeeNames}` : ""}\n\nДобавить в базу знаний?`;
await sendInlineMessage(chatId, text, [[
  { text: "✅ В базу", callback_data: `gc_${note.id}` },
  { text: "🔒 В личное", callback_data: `gcp_${note.id}` },
  { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
]]);
```

- [ ] **Step 2: Replace with tezises-first buttons**

Replace the entire `text` + `sendInlineMessage` call with:

```typescript
const text = `📓 <b>${title}</b>\n📅 ${date}${attendeeNames ? `\n👥 ${attendeeNames}` : ""}`;
await sendInlineMessage(chatId, text, [[
  { text: "🔍 Тезисы", callback_data: `gp_${note.id}` },
  { text: "🗑 Пропустить", callback_data: `gd_${note.id}` },
]]);
```

- [ ] **Step 3: Verify no other places in pollGranolaForUser reference gc_ or gcp_**

Grep: `grep -n "gc_\|gcp_" supabase/functions/swarm-bot/handlers/granola.ts`

Expected: only the `handleGranolaCallbacks` function contains these, not `pollGranolaForUser`. If poller still has them, remove.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/granola.ts
git commit -m "feat(meetings): poller shows tezises-first, removes direct storage buttons"
```

---

## Task 2: Add "✏️ Переписать" button to tezises preview

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/granola.ts` — `gp_` handler inside `handleGranolaCallbacks` (~lines 337–368)

**Context:** After generating tezises, we currently show "✅ В базу / 🔒 В личное / 🗑 Пропустить". Add a fourth button "✏️ Переписать" that starts the AI edit loop.

- [ ] **Step 1: Locate the gp_ handler's sendInlineMessage call**

Find the block around line 362:

```typescript
await sendMessage(chatId, `📓 <b>${title}</b>\n\n${tezises}`);
await sendInlineMessage(chatId, "Сохранить в базу знаний?", [[
  { text: "✅ В базу", callback_data: `gc_${noteId}` },
  { text: "🔒 В личное", callback_data: `gcp_${noteId}` },
  { text: "🗑 Пропустить", callback_data: `gd_${noteId}` },
]]);
```

- [ ] **Step 2: Replace with 2-row keyboard including "✏️ Переписать"**

```typescript
await sendMessage(chatId, `📓 <b>${title}</b>\n\n${tezises}`);
await sendInlineMessage(chatId, "Сохранить в базу знаний?", [
  [
    { text: "✅ В базу", callback_data: `gc_${noteId}` },
    { text: "🔒 В личное", callback_data: `gcp_${noteId}` },
  ],
  [
    { text: "✏️ Переписать", callback_data: `gedit_${noteId}` },
    { text: "🗑 Пропустить", callback_data: `gd_${noteId}` },
  ],
]);
```

- [ ] **Step 3: Add gedit_ callback handler**

Inside `handleGranolaCallbacks`, after the `gp_` handler block (before the `gc_` handler), add:

```typescript
if (data.startsWith("gedit_")) {
  const noteId = data.replace("gedit_", "");
  const session = await getSession(chatId);
  if (!session?.action.startsWith("granola_preview_")) {
    await sendMessage(chatId, "Данные встречи истекли. Открой заново через /granola");
    return true;
  }
  await setSession(chatId, `granola_edit_preview_${noteId}`, session.context);
  await sendMessage(
    chatId,
    "Напиши инструкцию: что изменить в тезисах.\n\n" +
    "<i>Например: «убери раздел Финансы», «сделай тезисы короче», «добавь задачу на Васю»</i>"
  );
  return true;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/granola.ts
git commit -m "feat(meetings): add AI rewrite button to tezises preview"
```

---

## Task 3: Handle granola_edit_preview session — AI rewrites tezises

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/granola.ts` — `handleGranolaSessionInput` function (~lines 401–427)

**Context:** When the user sends an instruction text while in `granola_edit_preview_<noteId>` session, GPT rewrites the tezises using the instruction + original content. The session is restored to `granola_preview_<noteId>` with the new tezises, so the user can keep iterating or save.

- [ ] **Step 1: Add the edit session handler to handleGranolaSessionInput**

After the `if (action !== "granola_custom_period") return false;` guard, or at the end of the function before `return false`, add:

```typescript
if (action.startsWith("granola_edit_preview_")) {
  const noteId = action.replace("granola_edit_preview_", "");
  const session = await getSession(chatId);
  if (!session?.context) {
    await clearSession(chatId);
    await sendMessage(chatId, "Данные встречи истекли. Открой заново через /granola");
    return true;
  }

  const cached = JSON.parse(session.context) as GranolaPreviewCache;
  await sendMessage(chatId, "Переписываю тезисы...");

  const newTezises = await chatComplete(
    "Ты помощник команды. Перепиши тезисы встречи согласно инструкции пользователя.\n" +
    "Не домысливай — только то что есть в исходном тексте или в текущих тезисах.\n" +
    "Сохраняй формат: ### Тема\n- тезис\n- тезис\n\n" +
    `Инструкция: ${text.trim()}\n\n` +
    `Текущие тезисы:\n${cached.tezises}`,
    cached.content.slice(0, 6000)
  );

  const updatedCache: GranolaPreviewCache = { ...cached, tezises: newTezises };
  await setSession(chatId, `granola_preview_${noteId}`, JSON.stringify(updatedCache));

  await sendMessage(chatId, `📓 <b>${cached.title}</b>\n\n${newTezises}`);
  await sendInlineMessage(chatId, "Сохранить в базу знаний?", [
    [
      { text: "✅ В базу", callback_data: `gc_${noteId}` },
      { text: "🔒 В личное", callback_data: `gcp_${noteId}` },
    ],
    [
      { text: "✏️ Переписать", callback_data: `gedit_${noteId}` },
      { text: "🗑 Пропустить", callback_data: `gd_${noteId}` },
    ],
  ]);
  return true;
}
```

Note: `GranolaPreviewCache` is already defined in the same file as `type GranolaPreviewCache = { content: string; title: string; tezises: string }`.

- [ ] **Step 2: Verify the existing granola_custom_period handler is still intact**

The function should now look like:

```typescript
export async function handleGranolaSessionInput(...): Promise<boolean> {
  if (action.startsWith("granola_edit_preview_")) {
    // ... new handler
  }
  if (action !== "granola_custom_period") return false;
  // ... existing handler
}
```

- [ ] **Step 3: Deploy and smoke-test in Telegram**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Test flow:
1. Send `/granola` → pick a period → notes appear with "🔍 Тезисы / 🗑 Пропустить"
2. Click "🔍 Тезисы" → tezises appear → buttons: "✅ В базу / 🔒 В личное / ✏️ Переписать / 🗑 Пропустить"
3. Click "✏️ Переписать" → bot asks for instruction
4. Send "сделай тезисы короче" → bot replies "Переписываю тезисы..." → shows updated tezises with same buttons
5. Click "✏️ Переписать" again → works (iteration)
6. Click "✅ В базу" → saves with latest tezises

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/granola.ts
git commit -m "feat(meetings): AI tezises edit loop in Granola preview"
```

---

## Task 4: Post-save tezises editing via AI instruction (meetings.ts)

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/meetings.ts`
  - `medit_` callback handler (~line 267): update prompt text
  - `meeting_edit_summary_*` session handler (~line 417): switch to AI rewrite

**Context:** Currently "✏️ Тезисы" in `/meetings` detail view prompts user to type replacement text. Change to: prompt for instruction → GPT rewrites using current tezises + original content.

- [ ] **Step 1: Update the medit_ prompt in handleMeetingCallbacks**

Find (~line 270):

```typescript
const current = entry?.summary ? `\n\nТекущие тезисы:\n${entry.summary.slice(0, 1000)}` : "";
await sendMessage(chatId, `Введи новые тезисы для встречи.${current}\n\n<i>Отправь отредактированный текст:</i>`);
```

Replace with:

```typescript
const current = entry?.summary ? `\n\nТекущие тезисы:\n${entry.summary.slice(0, 1000)}` : "";
await sendMessage(
  chatId,
  `Напиши инструкцию: что изменить в тезисах.${current}\n\n` +
  "<i>Например: «убери раздел Финансы», «сделай тезисы короче», «добавь задачу на Васю»</i>"
);
```

- [ ] **Step 2: Update the meeting_edit_summary_ session handler in handleMeetingSessionInput**

Find (~line 417):

```typescript
if (action.startsWith("meeting_edit_summary_")) {
  await clearSession(chatId);
  const entryId = action.replace("meeting_edit_summary_", "");
  const newSummary = text.trim();
  const { error } = await supabase.from("entries").update({ summary: newSummary }).eq("id", entryId);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return true; }
  await sendMessage(chatId, `✅ Тезисы обновлены.`, {
    inline_keyboard: [[{ text: "✅ Подтвердить встречу", callback_data: `mc_${entryId}` }]],
  });
  return true;
}
```

Replace with:

```typescript
if (action.startsWith("meeting_edit_summary_")) {
  await clearSession(chatId);
  const entryId = action.replace("meeting_edit_summary_", "");

  const { data: entry } = await supabase
    .from("entries")
    .select("content, summary")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) { await sendMessage(chatId, "Встреча не найдена."); return true; }

  await sendMessage(chatId, "Переписываю тезисы...");

  const newSummary = await chatComplete(
    "Ты помощник команды. Перепиши тезисы встречи согласно инструкции пользователя.\n" +
    "Не домысливай — только то что есть в исходном тексте или в текущих тезисах.\n" +
    "Сохраняй формат: ### Тема\n- тезис\n- тезис\n\n" +
    `Инструкция: ${text.trim()}\n\n` +
    `Текущие тезисы:\n${(entry.summary as string) ?? ""}`,
    (entry.content as string ?? "").slice(0, 6000)
  );

  const { error } = await supabase.from("entries").update({ summary: newSummary }).eq("id", entryId);
  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return true; }

  await sendMessage(chatId, `✅ Тезисы обновлены.\n\n${newSummary.slice(0, 1500)}`, {
    inline_keyboard: [[{ text: "✅ Подтвердить встречу", callback_data: `mc_${entryId}` }]],
  });
  return true;
}
```

- [ ] **Step 3: Deploy and smoke-test in Telegram**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Test flow:
1. Open saved meeting via `/meetings` → pick a meeting → detail view
2. Click "✏️ Тезисы" → bot asks for instruction (not for full text)
3. Send "убери раздел IT" → bot replies "Переписываю тезисы..." → shows updated tezises + "✅ Подтвердить встречу"

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/meetings.ts
git commit -m "feat(meetings): post-save tezises edit via AI instruction"
```

---

## Self-Review Checklist

- [x] Poller change: `gc_`/`gcp_` removed, `gp_` added → Task 1
- [x] Preview "✏️ Переписать" button: Task 2
- [x] `gedit_` callback routing: Task 2 Step 3
- [x] `granola_edit_preview_*` session handler: Task 3
- [x] Iteration loop (can ✏️ again after AI rewrites): Task 3 restores `granola_preview_*` session → `gedit_` can fire again
- [x] `gc_`/`gcp_` save handlers unchanged — they read `granola_preview_*` session which now holds updated tezises
- [x] Post-save `medit_` prompt updated: Task 4 Step 1
- [x] Post-save session handler uses AI: Task 4 Step 2
- [x] `chatComplete` already imported in both files
- [x] `GranolaPreviewCache` type already defined in granola.ts — used in Task 3 without redefinition
