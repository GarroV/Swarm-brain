# Feedback Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/feedback` command so users can report bugs or suggestions — stored in DB and forwarded to a configured Telegram channel.

**Architecture:** New `handlers/feedback.ts` handles the two-step session (text → optional photo). Photo routing in `index.ts` is intercepted before `handlePhoto` when feedback session is active. Channel chat_id is read from `app_settings` at send time.

**Tech Stack:** Deno, TypeScript, Supabase Edge Functions, Telegram Bot API. No test infrastructure — verification is deploy + manual test in Telegram.

---

## Files

| File | Change |
|------|--------|
| `supabase/migrations/20260529_feedback.sql` | Create `feedback` table |
| `supabase/functions/swarm-bot/handlers/feedback.ts` | New: all feedback logic |
| `supabase/functions/swarm-bot/index.ts` | Wire photo routing, import, command, callback, session, setMyCommands |
| `supabase/functions/swarm-bot/handlers/help.ts` | Add `/feedback` line |

---

## Task 1: DB migration

**Files:**
- Create: `supabase/migrations/20260529_feedback.sql`

- [ ] **Step 1: Create the migration file**

```sql
CREATE TABLE public.feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   bigint NOT NULL,
  username      text,
  text          text NOT NULL,
  photo_file_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO service_role;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: migration applied, no errors. Verify in Supabase Dashboard → Table Editor → `feedback` table exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260529_feedback.sql
git commit -m "feat(feedback): add feedback table"
```

---

## Task 2: Create handlers/feedback.ts

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/feedback.ts`

- [ ] **Step 1: Create the file with full implementation**

```typescript
import { supabase } from "../lib/supabase.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession, getSession } from "../lib/storage.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

async function getFeedbackChannelId(): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "feedback_channel_id")
    .maybeSingle();
  return data?.value ?? null;
}

async function postToChannel(channelId: string, text: string, photoFileId?: string): Promise<void> {
  if (photoFileId) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channelId, photo: photoFileId, caption: text, parse_mode: "HTML" }),
    });
  } else {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: channelId, text, parse_mode: "HTML" }),
    });
  }
}

async function saveFeedback(
  telegramId: number,
  username: string,
  text: string,
  photoFileId?: string,
): Promise<void> {
  await supabase.from("feedback").insert({
    telegram_id: telegramId,
    username,
    text,
    photo_file_id: photoFileId ?? null,
  });

  const channelId = await getFeedbackChannelId();
  if (!channelId) return;

  const date = new Date().toLocaleString("ru-RU", {
    day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const channelText = `🐛 @${username} · ${date}\n\n${text}`;
  await postToChannel(channelId, channelText, photoFileId);
}

export async function handleFeedbackCommand(chatId: number): Promise<void> {
  await setSession(chatId, "feedback_text");
  await sendMessage(chatId, "Опиши проблему или предложение:");
}

export async function handleFeedbackCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string,
): Promise<boolean> {
  if (!cb.data.startsWith("fb_done_")) return false;

  const session = await getSession(chatId);
  if (!session?.action.startsWith("feedback_photo_") || !session.context) {
    await sendMessage(chatId, "Сессия истекла. Попробуй /feedback снова.");
    return true;
  }

  const { text } = JSON.parse(session.context) as { text: string };
  await clearSession(chatId);
  await saveFeedback(userId, username, text);
  await sendMessage(chatId, "✅ Фидбек принят, спасибо!");
  return true;
}

export async function handleFeedbackPhoto(
  chatId: number,
  userId: number,
  username: string,
  photos: Array<{ file_id: string; file_size?: number }>,
): Promise<void> {
  const session = await getSession(chatId);
  if (!session?.context) {
    await clearSession(chatId);
    await sendMessage(chatId, "Сессия истекла. Попробуй /feedback снова.");
    return;
  }

  const { text } = JSON.parse(session.context) as { text: string };
  const photoFileId = photos[photos.length - 1].file_id;
  await clearSession(chatId);
  await saveFeedback(userId, username, text, photoFileId);
  await sendMessage(chatId, "✅ Фидбек принят, спасибо!");
}

export async function handleFeedbackSessionInput(
  chatId: number,
  action: string,
  text: string,
): Promise<boolean> {
  if (action !== "feedback_text") return false;

  const tempId = String(Date.now());
  await setSession(chatId, `feedback_photo_${tempId}`, JSON.stringify({ text }));
  await sendInlineMessage(
    chatId,
    "Есть скриншот? Отправь следующим сообщением.",
    [[{ text: "✅ Готово, без скриншота", callback_data: `fb_done_${tempId}` }]],
  );
  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/feedback.ts
git commit -m "feat(feedback): add feedback handler"
```

---

## Task 3: Wire feedback into index.ts

**Files:**
- Modify: `supabase/functions/swarm-bot/index.ts`

Context: Four changes in this file — import, photo routing, callback dispatch, session dispatch, command routing, and setMyCommands (two places).

- [ ] **Step 1: Add import at the top of index.ts**

After the existing handler imports (around line 11), add:

```typescript
import { handleFeedbackCommand, handleFeedbackCallbacks, handleFeedbackPhoto, handleFeedbackSessionInput } from "./handlers/feedback.ts";
```

- [ ] **Step 2: Fix photo routing — intercept feedback session before handlePhoto**

Find this block (around line 129):

```typescript
if (message.photo?.length) { await handlePhoto(chatId, username, message.photo); return new Response("OK", { status: 200 }); }
```

Replace with:

```typescript
if (message.photo?.length) {
  const photoSession = await getSession(chatId);
  if (photoSession?.action.startsWith("feedback_photo_")) {
    await handleFeedbackPhoto(chatId, userId, username, message.photo);
  } else {
    await handlePhoto(chatId, username, message.photo);
  }
  return new Response("OK", { status: 200 });
}
```

- [ ] **Step 3: Add feedback callbacks to callback dispatch**

Find the callback dispatch block (around line 96):

```typescript
if (await handleTaskCallbacks(cb, chatId, userId, username)) {
  // handled
} else if (await handleMeetingCallbacks(cb, chatId, userId, username)) {
  // handled
} else if (await handleUserCallbacks(cb, chatId, userId)) {
  // handled
} else if (await handleGranolaCallbacks(cb, chatId, userId, username)) {
  // handled
}
```

Replace with:

```typescript
if (await handleTaskCallbacks(cb, chatId, userId, username)) {
  // handled
} else if (await handleMeetingCallbacks(cb, chatId, userId, username)) {
  // handled
} else if (await handleUserCallbacks(cb, chatId, userId)) {
  // handled
} else if (await handleGranolaCallbacks(cb, chatId, userId, username)) {
  // handled
} else if (await handleFeedbackCallbacks(cb, chatId, userId, username)) {
  // handled
}
```

- [ ] **Step 4: Add feedback session to session dispatch**

Find the session dispatch block (around line 158):

```typescript
} else if (action && await handleGranolaSessionInput(chatId, userId, action, text)) {
  // granola session handled
} else {
```

Replace with:

```typescript
} else if (action && await handleGranolaSessionInput(chatId, userId, action, text)) {
  // granola session handled
} else if (action && await handleFeedbackSessionInput(chatId, action, text)) {
  // feedback session handled
} else {
```

- [ ] **Step 5: Add /feedback command routing**

Find the command routing block. After the `/disconnect` block (around line 279), before the `/digest` block, add:

```typescript
} else if (command === "/feedback") {
  await handleFeedbackCommand(chatId);
```

- [ ] **Step 6: Add /feedback to setMyCommands in setup_commands cron trigger**

Find the `setup_commands` block (around line 36). The commands array currently ends with `reset`. Add `feedback` before `reset`:

```typescript
{ command: "feedback", description: "Отправить фидбек" },
{ command: "reset", description: "Сбросить состояние бота" },
```

Apply the same change to the `/start` handler's `setMyCommands` call (same array, around line 196).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/swarm-bot/index.ts
git commit -m "feat(feedback): wire /feedback command into index.ts"
```

---

## Task 4: Update /help text

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/help.ts`

- [ ] **Step 1: Add /feedback line to help text**

Find the last line of the help string:

```typescript
"/reset — сбросить состояние · /help — эта справка"
```

Replace with:

```typescript
"/feedback — отправить фидбек\n" +
"/reset — сбросить состояние · /help — эта справка"
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/help.ts
git commit -m "feat(feedback): add /feedback to help text"
```

---

## Task 5: Deploy and smoke test

- [ ] **Step 1: Deploy**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Expected: `Deployed Functions on project vbqglndbxkpmreccpqmr: swarm-bot`

- [ ] **Step 2: Configure feedback channel in app_settings**

In Supabase Dashboard → Table Editor → `app_settings`, insert a row:
- `key`: `feedback_channel_id`  
- `value`: the Telegram chat_id of the feedback channel (e.g. `-100123456789`)

The bot must be added to that channel/group as an admin with posting rights.

- [ ] **Step 3: Smoke test — text only**

In Telegram:
1. Send `/feedback`
2. Bot asks: "Опиши проблему или предложение:"
3. Send "Тест фидбека без скриншота"
4. Bot shows "Есть скриншот?" + button "✅ Готово, без скриншота"
5. Press the button
6. Bot: "✅ Фидбек принят, спасибо!"
7. Check `feedback` table in Supabase — row exists with correct text, `photo_file_id = null`
8. Check feedback channel — post appears: `🐛 @username · дата\n\nТест фидбека без скриншота`

- [ ] **Step 4: Smoke test — with screenshot**

1. Send `/feedback`
2. Send "Тест с фото"
3. Bot shows "Есть скриншот?"
4. Send any photo
5. Bot: "✅ Фидбек принят, спасибо!"
6. Check `feedback` table — `photo_file_id` is populated
7. Check feedback channel — post has photo with caption

- [ ] **Step 5: Update ARCHITECTURE.md**

Add to the Sessions table:

```
| `feedback_text` | feedback.ts | Ожидание текста фидбека |
| `feedback_photo_<tempId>` | feedback.ts | Ожидание скриншота или подтверждения |
```

Add to the Callback codes section:

```
| `fb_done_<tempId>` | Пропустить скриншот, сохранить фидбек |
```

Add `feedback` table to the DB tables section.

- [ ] **Step 6: Update CHANGELOG.md**

Add entry under today's date:

```
### Фидбек — /feedback

- Новая команда `/feedback` — двухшаговая форма: текст → опциональный скриншот
- Сохраняется в таблицу `feedback` в БД
- Пересылается в Telegram-канал (chat_id в `app_settings.feedback_channel_id`)
- Команда видна в боковом меню Telegram и в /help
```

- [ ] **Step 7: Final commit**

```bash
git add ARCHITECTURE.md CHANGELOG.md
git commit -m "docs: update ARCHITECTURE and CHANGELOG for feedback feature"
```

---

## Self-Review

- [x] DB migration with GRANT: Task 1
- [x] `handleFeedbackCommand`: Task 2
- [x] `handleFeedbackCallbacks` (fb_done_): Task 2
- [x] `handleFeedbackPhoto` (intercept before handlePhoto): Task 2 + Task 3 Step 2
- [x] `handleFeedbackSessionInput` (feedback_text): Task 2
- [x] Photo routing fix in index.ts: Task 3 Step 2
- [x] Callback dispatch: Task 3 Step 3
- [x] Session dispatch: Task 3 Step 4
- [x] Command routing `/feedback`: Task 3 Step 5
- [x] setMyCommands — both setup_commands and /start: Task 3 Step 6
- [x] /help updated: Task 4
- [x] channel_id graceful skip if not configured: `if (!channelId) return` in saveFeedback
- [x] Function signatures consistent across all tasks
- [x] ARCHITECTURE.md + CHANGELOG updated: Task 5 Steps 5-7
