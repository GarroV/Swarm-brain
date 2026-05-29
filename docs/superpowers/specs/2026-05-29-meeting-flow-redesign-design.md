# Meeting Flow Redesign

**Date:** 2026-05-29  
**Status:** Approved

## Problem

Two issues with the current meeting save flow:

1. **Poller flow** (`pollGranolaForUser`) shows "✅ В базу / 🔒 В личное / 🗑 Пропустить" immediately — user has to decide *where* to save before ever seeing the tezises. No way to review content before committing to a storage location.

2. **Tezises editing** (`medit_` in `meetings.ts`) exists but is clunky: user must type the *entire* replacement text in chat. There's no AI-assisted editing in the preview stage (before saving) at all.

## Design

### New unified flow (all sources: poller + /granola)

```
Meeting appears
  → "🔍 Тезисы" + "🗑 Пропустить"
  
Click "🔍 Тезисы"
  → GPT generates tezises
  → Shows: title + tezises
  → Buttons: "✅ В базу" | "🔒 В личное" | "✏️ Переписать" | "🗑 Пропустить"

Click "✏️ Переписать"
  → Session: granola_edit_preview_<noteId> (context = { content, title, tezises })
  → Message: "Напиши инструкцию: что изменить в тезисах (например: 'убери Финансы', 'добавь задачу на Васю')"
  → User sends instruction
  → GPT rewrites tezises using instruction + original content
  → Shows updated tezises + same 4 buttons (can iterate)

Click "✅ В базу" or "🔒 В личное"
  → Saves with current (possibly rewritten) tezises
```

### Poller changes (`granola.ts` — `pollGranolaForUser`)

- Remove: `gc_`, `gcp_` buttons from poller notification
- Keep: `gp_` ("🔍 Тезисы") and `gd_` ("🗑 Пропустить")
- After tezises are shown, storage buttons appear (same as manual flow)

### Preview edit session (`granola.ts` — `handleGranolaCallbacks`)

New session key: `granola_edit_preview_<noteId>`  
Context stored: `{ content, title, tezises }` (already in `granola_preview_<noteId>` session — reuse or extend)

New handler in `handleGranolaSessionInput`:
```
if action === `granola_edit_preview_${noteId}`:
  - load cached { content, title, tezises } from session context
  - call GPT: "Перепиши тезисы согласно инструкции пользователя. Инструкция: <text>. Текущие тезисы: <tezises>. Исходный текст встречи: <content.slice(0,6000)>"
  - update session context with new tezises
  - show new tezises + same 4 buttons
```

### Post-save tezises editing (`meetings.ts` — `handleMeetingSessionInput`)

Action: `meeting_edit_summary_<entryId>`  
Change from: "send replacement text" → "send instruction for AI rewrite"

New logic:
- Load `entry.summary` (current tezises) and `entry.content` (original meeting content)
- GPT rewrites using instruction + current tezises + content
- Save result, confirm

## Files to change

| File | Change |
|------|--------|
| `handlers/granola.ts` | Poller: remove `gc_`/`gcp_` buttons; add `✏️ Переписать` button after tezises; new edit session handler |
| `handlers/meetings.ts` | `meeting_edit_summary_`: switch from full-text replacement to AI instruction rewrite |

## Out of scope

- Read.ai meeting flow (separate source, separate handler — not changed here)
- Adding inline buttons for common instructions ("📝 Краче", etc.) — can be added later
