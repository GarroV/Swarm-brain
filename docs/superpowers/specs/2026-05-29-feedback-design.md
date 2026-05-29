# Feedback Feature Design

**Date:** 2026-05-29  
**Status:** Approved

## Problem

No way for bot users to report bugs or send suggestions. Everything goes to chat which gets lost.

## Flow

```
/feedback
  → session: feedback_text
  → bot: "Опиши проблему или предложение:"

User sends text
  → session: feedback_photo_<tempId>  (tempId = timestamp)
  → bot: "Есть скриншот?" + button [✅ Готово, без скриншота]

User sends photo OR clicks "Готово"
  → INSERT into feedback table
  → POST to Telegram channel (feedback_channel_id from app_settings)
  → bot: "✅ Фидбек принят, спасибо!"
  → clearSession
```

## Data

**New table `feedback`:**
```sql
CREATE TABLE feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   bigint NOT NULL,
  username      text,
  text          text NOT NULL,
  photo_file_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

**Channel config:** `app_settings` row with `key = 'feedback_channel_id'`, value = Telegram chat_id string. Set manually in Supabase Dashboard once.

## Channel post format

```
🐛 @username · 29 мая 11:12

{user text}

[photo forwarded if present]
```

If `feedback_channel_id` is not configured — still save to DB, skip channel post, no error to user.

## Session keys

| Key | State |
|-----|-------|
| `feedback_text` | Waiting for problem description |
| `feedback_photo_<tempId>` | Waiting for screenshot or "Готово" button |

`tempId` = `Date.now()` string, stored in session context along with `{ text, telegramId, username }`.

## Callback codes

| Code | Action |
|------|--------|
| `fb_done_<tempId>` | User skipped screenshot — save without photo |

## Files

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_feedback.sql` | CREATE TABLE feedback + GRANT |
| `handlers/feedback.ts` | New: handleFeedbackCommand, handleFeedbackCallbacks, handleFeedbackSessionInput |
| `index.ts` | Wire command, callbacks, session; add to setMyCommands (both /start and setup_commands) |
| `handlers/help.ts` | Add /feedback line |

## Implementation note: photo routing

In `index.ts` photos are routed to `handlePhoto` **before** session checks. Need to add a session check before that:

```typescript
// Before: if (message.photo?.length) { await handlePhoto(...) }
// After:
if (message.photo?.length) {
  const session = await getSession(chatId);
  if (session?.action.startsWith("feedback_photo_")) {
    await handleFeedbackPhoto(chatId, userId, username, session.action, message.photo);
  } else {
    await handlePhoto(chatId, username, message.photo);
  }
  return new Response("OK", { status: 200 });
}
```

`handleFeedbackPhoto` lives in `handlers/feedback.ts` and handles the photo step of the feedback flow.

## Out of scope

- Admin `/feedback list` command — view in Supabase Dashboard
- Status tracking (reviewed/done) — not needed now
- Admin reply-back to user — explicitly not wanted
