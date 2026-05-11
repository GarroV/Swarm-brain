# Swarm Bot — Рефакторинг Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разбить `swarm-bot/index.ts` (2769 строк) на модули без изменения поведения, плюс починить выдачу исходников.

**Architecture:** Каждый модуль в `lib/` — утилита без состояния (API-обёртка или DB-операции). Каждый модуль в `handlers/` — логика одного сценария. `index.ts` — только диспетчер (~250 строк): импортирует хэндлеры, роутит входящие апдейты.

**Tech Stack:** Deno, Supabase Edge Functions, TypeScript, Telegram Bot API, OpenAI API

**Spec:** `docs/superpowers/specs/2026-05-11-swarm-bot-refactor-design.md`

---

## File Map

**Create:**
- `supabase/functions/swarm-bot/lib/types.ts` — TgMessage, TgCallbackQuery, Task, KbEntry
- `supabase/functions/swarm-bot/lib/supabase.ts` — supabase client + ADMIN_USER_ID
- `supabase/functions/swarm-bot/lib/telegram.ts` — Telegram API utilities
- `supabase/functions/swarm-bot/lib/openai.ts` — getEmbedding, chatComplete
- `supabase/functions/swarm-bot/lib/drive.ts` — Google Drive integration
- `supabase/functions/swarm-bot/lib/readai.ts` — Read.ai API integration
- `supabase/functions/swarm-bot/lib/storage.ts` — saveEntry, sessions, auth, profile sync
- `supabase/functions/swarm-bot/handlers/knowledge.ts` — KNOWLEDGE_TOOLS, executeTool, handleAdd, handleAsk (source text fix here)
- `supabase/functions/swarm-bot/handlers/media.ts` — handleVoice, handleDocument, handlePhoto, handleUrl, media utilities
- `supabase/functions/swarm-bot/handlers/tasks.ts` — handleTasks, handleTaskCallbacks, task CRUD
- `supabase/functions/swarm-bot/handlers/meetings.ts` — handleMeetings, handleMeetingCallbacks
- `supabase/functions/swarm-bot/handlers/users.ts` — handleUsers, handleUserCallbacks, profiles
- `supabase/functions/swarm-bot/handlers/digest.ts` — generatePersonalDigest, sendAllDigests

**Rewrite:**
- `supabase/functions/swarm-bot/index.ts` — clean dispatcher only

---

## Task 1: Create `lib/types.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/lib/types.ts`

- [ ] **Step 1: Create the file**

```typescript
export interface TgMessage {
  chat: { id: number };
  from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string; file_size?: number }>;
  contact?: { phone_number: string; first_name?: string; last_name?: string };
}

export interface TgCallbackQuery {
  id: string;
  from: { id?: number; username?: string };
  message: { chat: { id: number }; message_id: number };
  data: string;
}

export type KbEntry = { id: string; content: string; summary?: string | null; source?: string | null };

export type Task = {
  id: string;
  title: string;
  assignees: string[];
  due_date: string | null;
  tags: string[];
  status: string;
  created_at: string;
  meeting_id: string | null;
  url: string | null;
};
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/swarm-bot/lib/types.ts
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/lib/types.ts
git commit -m "refactor: add shared types module for swarm-bot"
```

---

## Task 2: Create `lib/supabase.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/lib/supabase.ts`

- [ ] **Step 1: Create the file**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const ADMIN_USER_ID = 744230399;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/swarm-bot/lib/supabase.ts
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/lib/supabase.ts
git commit -m "refactor: add supabase client module for swarm-bot"
```

---

## Task 3: Create `lib/telegram.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/lib/telegram.ts`
- Source lines in index.ts: 170–209 (answerCallback, editMessageKeyboard, sendInlineMessage, buildKeyboard, sendMessage, getTelegramFileUrl)

- [ ] **Step 1: Create the file**

Header:
```typescript
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
```

Then extract verbatim from `index.ts` lines **170–233**:
- `answerCallback`
- `editMessageKeyboard`
- `sendInlineMessage`
- `buildKeyboard`
- `sendMessage`
- `getTelegramFileUrl`

Add `export` keyword to each function declaration.

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/swarm-bot/lib/telegram.ts
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/lib/telegram.ts
git commit -m "refactor: extract Telegram API utilities to lib/telegram.ts"
```

---

## Task 4: Create `lib/openai.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/lib/openai.ts`
- Source lines in index.ts: 234–261 (getEmbedding, chatComplete)

- [ ] **Step 1: Create the file**

```typescript
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

export async function getEmbedding(text: string): Promise<number[]> {
  // Extract verbatim from index.ts lines 234–244
}

export async function chatComplete(system: string, user: string): Promise<string> {
  // Extract verbatim from index.ts lines 245–257
}
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/swarm-bot/lib/openai.ts
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/lib/openai.ts
git commit -m "refactor: extract OpenAI utilities to lib/openai.ts"
```

---

## Task 5: Create `lib/drive.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/lib/drive.ts`
- Source lines in index.ts: 19–115 (getGoogleAccessToken, getOrCreateDriveFolder, uploadToDrive)

- [ ] **Step 1: Create the file**

```typescript
const GOOGLE_CLIENT_EMAIL = Deno.env.get("GOOGLE_CLIENT_EMAIL") ?? "";
const GOOGLE_PRIVATE_KEY = (Deno.env.get("GOOGLE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID") ?? "";

export async function getGoogleAccessToken(): Promise<string> { /* ... */ }
export async function getOrCreateDriveFolder(name: string, parentId: string, token: string): Promise<string> { /* ... */ }
export async function uploadToDrive(fileName: string, buffer: ArrayBuffer, mimeType: string, subFolder: string): Promise<string | null> { /* ... */ }
```

Extract verbatim from index.ts lines **19–115**, add `export` to each function.

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/swarm-bot/lib/drive.ts
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/lib/drive.ts
git commit -m "refactor: extract Google Drive integration to lib/drive.ts"
```

---

## Task 6: Create `lib/readai.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/lib/readai.ts`
- Source lines in index.ts: 115–169 (getReadAiToken, readAiGet) + constants READ_AI_TOKEN_URL, READ_AI_API, READ_AI_AUTH_URL

- [ ] **Step 1: Create the file**

```typescript
import { supabase, ADMIN_USER_ID } from "./supabase.ts";
import { sendMessage } from "./telegram.ts";

const READ_AI_TOKEN_URL = "https://authn.read.ai/oauth2/token";
export const READ_AI_API = "https://api.read.ai/v1";
const READ_AI_AUTH_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/read-ai-auth?start=1";

export async function getReadAiToken(): Promise<string | null> { /* extract from index.ts lines 119–158 */ }
export async function readAiGet(path: string): Promise<unknown> { /* extract from index.ts lines 159–169 */ }
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/swarm-bot/lib/readai.ts
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/lib/readai.ts
git commit -m "refactor: extract Read.ai integration to lib/readai.ts"
```

---

## Task 7: Create `lib/storage.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/lib/storage.ts`
- Source lines in index.ts: 653–777 (extractEntryMeta, saveEntry, getSession, setSession, clearSession, checkAllowed, generateSummary, autoSyncProfile)

- [ ] **Step 1: Create the file**

```typescript
import { supabase } from "./supabase.ts";
import { getEmbedding, chatComplete } from "./openai.ts";

export async function extractEntryMeta(text: string): Promise<{ countries: string[]; entry_type: string; entry_date: string | null }> {
  // Extract from index.ts lines 653–671
}

export async function saveEntry(
  content: string,
  addedBy: string,
  source: string,
  metadata: Record<string, unknown> = {},
  summary?: string,
  groupId?: string
): Promise<string> {
  // Extract from index.ts lines 672–709
}

export async function getSession(chatId: number): Promise<{ action: string; context?: string } | null> {
  // Extract from index.ts lines 710–723
}

export async function setSession(chatId: number, action: string, context?: string): Promise<void> {
  // Extract from index.ts lines 724–730
}

export async function clearSession(chatId: number): Promise<void> {
  // Extract from index.ts lines 731–736
}

export async function checkAllowed(userId: number, username?: string): Promise<boolean> {
  // Extract from index.ts lines 737–753
}

export async function generateSummary(text: string): Promise<string | null> {
  // Extract from index.ts lines 754–763
}

export async function autoSyncProfile(
  userId: number,
  firstName?: string,
  lastName?: string,
  username?: string
): Promise<void> {
  // Extract from index.ts lines 1704–1725
}
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/swarm-bot/lib/storage.ts
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-bot/lib/storage.ts
git commit -m "refactor: extract data persistence layer to lib/storage.ts"
```

---

## Task 8: Create `handlers/knowledge.ts` (includes source text fix)

This task contains the **only logic change** in the entire refactor: fixing source text retrieval.

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/knowledge.ts`
- Source lines in index.ts: 263–385 (KNOWLEDGE_TOOLS, KNOWLEDGE_TOOLS_DISABLED), 388–581 (executeTool), 764–777 (handleAdd), 833–958 (handleAsk)

- [ ] **Step 1: Create the file header**

```typescript
import { supabase } from "../lib/supabase.ts";
import { getEmbedding } from "../lib/openai.ts";
import { saveEntry, generateSummary, getSession, setSession, clearSession } from "../lib/storage.ts";
import { sendMessage } from "../lib/telegram.ts";
import type { KbEntry } from "../lib/types.ts";
```

- [ ] **Step 2: Copy KNOWLEDGE_TOOLS with source text fix**

Copy `KNOWLEDGE_TOOLS` from index.ts lines 263–293, then **remove the `wants_full_text` parameter** from `search_knowledge`:

```typescript
export const KNOWLEDGE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description: "Semantic search of the knowledge base. Use for any question about stored content. Include Russian and English terms in query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — include both Russian and English variants of key terms" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "export_entry",
      description: "Export the full raw content of an entry as a downloadable file. Use when user asks to 'скинь файлом', 'выгрузи', 'скачать транскрипцию', 'export', 'пришли исходник', 'полный текст', 'дословно'. Also call this when search results contain [Полный текст: export_entry(id=...)]. First use search_knowledge to find the entry id, then call export_entry with that id.",
      parameters: {
        type: "object",
        properties: {
          entry_id: { type: "string", description: "Entry id from search results (the id: prefix value)" },
        },
        required: ["entry_id"],
      },
    },
  },
];
```

Then copy `KNOWLEDGE_TOOLS_DISABLED` verbatim (lines 296–385) with its `/* === DISABLED === */` comment.

- [ ] **Step 3: Copy executeTool with source text fix**

Copy `executeTool` from index.ts lines 388–581. In the `search_knowledge` case, **replace the `wantsFullText` logic** with:

```typescript
case "search_knowledge": {
  const query = String(args.query ?? "");
  const embedding = await getEmbedding(query);

  // ... (keep existing vector search, keyword search, and deduplication logic unchanged) ...

  // SOURCE TEXT FIX: replace the old wantsFullText mapping with this:
  return combined.slice(0, 5).map((e: KbEntry) => {
    const isShort = (e.content ?? "").length <= 500;
    const text = isShort
      ? (e.content ?? "")
      : (e.summary || (e.content ?? "").slice(0, 500)) +
        `\n[Полный текст: export_entry(id=${e.id})]`;
    return `[id:${e.id}] ${e.source ?? ""}:\n${text}`;
  }).join("\n\n") || "Ничего не найдено.";
}
```

The same fix applies to `search_by_country` case in `KNOWLEDGE_TOOLS_DISABLED` — apply identical logic there.

- [ ] **Step 4: Copy handleAdd verbatim**

Extract from index.ts lines 764–777, add `export`:

```typescript
export async function handleAdd(chatId: number, username: string, text: string): Promise<void> {
  // verbatim from index.ts 764–777
}
```

- [ ] **Step 5: Copy handleAsk with system prompt fix**

Extract from index.ts lines 833–958, add `export`. **Update the system prompt** (line ~863) to add the source text rule:

```typescript
content:
  "Ты помощник командной базы знаний команды. " +
  "Используй инструменты чтобы найти или изменить информацию в базе. " +
  "Если пользователь говорит 'эту', 'её', 'этот' — он имеет в виду запись из предыдущего ответа. " +
  "Если результат поиска содержит [Полный текст: export_entry(id=...)] и пользователь " +
  "просит исходник, полный текст или дословно — вызови export_entry с этим id. " +
  "Не выдавай длинный текст в сообщении — отправляй файлом через export_entry. " +
  "Если пользователь просит скинуть файлом, выгрузить, скачать транскрипцию или исходник — " +
  "сначала найди запись через search_knowledge (получи её id), " +
  "затем вызови export_entry с этим id. " +
  "Отвечай ТОЛЬКО на основе данных из инструментов — не придумывай информацию. " +
  "Если данных нет — честно скажи. Отвечай на русском языке.",
```

- [ ] **Step 6: Type-check**

```bash
deno check supabase/functions/swarm-bot/handlers/knowledge.ts
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/knowledge.ts
git commit -m "refactor: extract knowledge handlers, fix source text retrieval"
```

---

## Task 9: Create `handlers/media.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/media.ts`
- Source lines in index.ts: 582–600 (transcribeAudio), 601–624 (describeImage), 625–652 (extractUrl, fetchUrlContent), 970–1148 (file type utils, handleDocument), 1150–1158 (handlePhoto), 1159–1167 (handleUrl), 959–968 (handleVoice)

- [ ] **Step 1: Create the file**

```typescript
import { supabase } from "../lib/supabase.ts";
import { getEmbedding } from "../lib/openai.ts";
import { saveEntry, generateSummary } from "../lib/storage.ts";
import { sendMessage } from "../lib/telegram.ts";
import { uploadToDrive } from "../lib/drive.ts";
// @ts-ignore - esm.sh module
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
```

- [ ] **Step 2: Extract functions**

Extract verbatim from index.ts (add `export` to public handlers):
- `transcribeAudio` (lines 582–600)
- `describeImage` (lines 601–624)
- `URL_REGEX` constant + `extractUrl` + `fetchUrlContent` (lines 625–652)
- `TEXT_EXTENSIONS`, `SPREADSHEET_MIMES`, `SPREADSHEET_EXTS` constants (lines 970–994)
- `getFileExt`, `isTextFile`, `isSpreadsheet`, `parseSpreadsheet` (lines 972–1008)
- `handleDocument` (lines 1009–1148) — `export`
- `handlePhoto` (lines 1150–1158) — `export`
- `handleUrl` (lines 1159–1167) — `export`
- `handleVoice` (lines 959–968) — `export`

- [ ] **Step 3: Type-check**

```bash
deno check supabase/functions/swarm-bot/handlers/media.ts
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/media.ts
git commit -m "refactor: extract media processing handlers to handlers/media.ts"
```

---

## Task 10: Create `handlers/tasks.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/tasks.ts`
- Source lines in index.ts: 778–832 (TASK_KEYWORDS, smartTaskSearch), 1285–1593 (all task functions), plus disabled session handlers for task_date/title/url/comment from the main handler block (~2484–2513)

- [ ] **Step 1: Create the file**

```typescript
import { supabase, ADMIN_USER_ID } from "../lib/supabase.ts";
import { chatComplete } from "../lib/openai.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import type { Task, TgCallbackQuery } from "../lib/types.ts";
```

- [ ] **Step 2: Extract all task functions**

Extract verbatim from index.ts (add `export` to public functions):
- `TASK_KEYWORDS` + `smartTaskSearch` (lines 778–832) — `export`
- `STATUS_LABEL` constant (lines 1265–1271) — `export`
- `buildTaskQuery` (lines 1285–1307)
- `applyArrayFilter` (lines 1308–1320)
- `analyzeAndCreateTasks` (lines 1321–1375) — `export`
- `sendPendingTaskCard` (lines 1376–1389)
- `handleTaskListCallback` (lines 1390–1469) — `export`
- `handleTasks` (lines 1470–1503) — `export`
- `sendTaskCard` (lines 1504–1521)
- `showTaskComments` (lines 1522–1543)
- `handleTasksExport` (lines 1544–1573) — `export`
- `handleTaskStatusChange` (lines 1574–1593) — `export`

- [ ] **Step 3: Add handleTaskCallbacks dispatcher**

This function handles all task-related callback_data prefixes, called from index.ts:

```typescript
export async function handleTaskCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  username: string
): Promise<boolean> {
  const data = cb.data;

  if (data.startsWith("tl_")) {
    await handleTaskListCallback(chatId, userId, username, data.replace("tl_", ""));
    return true;
  }
  if (data.startsWith("tc_")) {
    const taskId = data.replace("tc_", "");
    const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
    await supabase.from("tasks").update({ status: "open" }).eq("id", taskId);
    await sendMessage(chatId, `✅ Задача подтверждена: <b>${task?.title ?? ""}</b>`);
    return true;
  }
  if (data.startsWith("tas_")) {
    const rest = data.replace("tas_", "");
    const sep = rest.lastIndexOf("_");
    const taskId = rest.slice(0, sep);
    const targetTgId = Number(rest.slice(sep + 1));
    const { data: prof } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetTgId).maybeSingle();
    const { data: au } = await supabase.from("allowed_users").select("username").eq("telegram_id", targetTgId).maybeSingle();
    const assigneeName = prof
      ? [prof.first_name, prof.last_name].filter(Boolean).join(" ")
      : (au?.username ? `@${au.username}` : `ID ${targetTgId}`);
    await supabase.from("tasks").update({ assignees: [assigneeName], status: "open" }).eq("id", taskId);
    await sendMessage(chatId, `✅ Назначено: <b>${assigneeName}</b>`);
    return true;
  }
  if (data.startsWith("ta_")) {
    const taskId = data.replace("ta_", "");
    const { data: profiles } = await supabase.from("user_profiles").select("first_name, last_name, telegram_id");
    const { data: allowedUsers } = await supabase.from("allowed_users").select("telegram_id, username");
    const profileMap: Record<number, { first_name?: string; last_name?: string }> =
      Object.fromEntries((profiles ?? []).map((p: { telegram_id: number; first_name?: string; last_name?: string }) => [p.telegram_id, p]));
    const seen = new Set<number>();
    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null },
      ...((allowedUsers ?? []) as Array<{ telegram_id: number; username: string | null }>),
    ].filter((u) => { if (seen.has(u.telegram_id)) return false; seen.add(u.telegram_id); return true; });
    const buttons = allUsers.map((u) => {
      const p = profileMap[u.telegram_id];
      const label = (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "") || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
      return [{ text: label, callback_data: `tas_${taskId}_${u.telegram_id}` }];
    });
    await sendInlineMessage(chatId, "Кому назначить задачу?", buttons);
    return true;
  }
  if (data.startsWith("ts_")) {
    const parts = data.split("_");
    const taskId = parts[1];
    const newStatus = parts.slice(2).join("_");
    await handleTaskStatusChange(chatId, username, taskId, newStatus);
    return true;
  }
  if (data.startsWith("topen_")) {
    // Extract verbatim from index.ts lines 2251–2274 (show task card with action buttons)
    // ... copy the topen_ handler block ...
    return true;
  }
  if (data.startsWith("tdate_")) {
    const taskId = data.replace("tdate_", "");
    // NOTE: sets session — text input handled in handleTaskSessionInput below
    // Import setSession from storage
    return true;
  }
  if (data.startsWith("ttitle_")) {
    const taskId = data.replace("ttitle_", "");
    return true;
  }
  if (data.startsWith("turl_")) {
    const taskId = data.replace("turl_", "");
    return true;
  }
  if (data.startsWith("tcomments_")) {
    const taskId = data.replace("tcomments_", "");
    await showTaskComments(chatId, taskId);
    return true;
  }
  if (data.startsWith("tca_")) {
    const taskId = data.replace("tca_", "");
    return true;
  }
  if (data.startsWith("td_")) {
    const taskId = data.replace("td_", "");
    const { data: task } = await supabase.from("tasks").select("title").eq("id", taskId).maybeSingle();
    await supabase.from("task_history").delete().eq("task_id", taskId);
    await supabase.from("tasks").delete().eq("id", taskId);
    await sendMessage(chatId, `🗑 Удалено: <b>${task?.title ?? taskId}</b>`);
    return true;
  }
  return false;
}
```

**Note:** `tdate_`, `ttitle_`, `turl_`, `tca_` handlers need `setSession` from `lib/storage.ts` — import it and add calls. Copy the session setup from the disabled blocks in index.ts (~2275–2293).

- [ ] **Step 4: Add handleTaskSessionInput (disabled — for future re-enable)**

```typescript
/* === DISABLED: task session text input handlers — re-enable by calling from index.ts session router === */
export async function handleTaskSessionInput(
  chatId: number,
  action: string,
  text: string,
  username: string
): Promise<boolean> {
  // Extract the task_date_, task_title_, task_url_, task_comment_ blocks
  // from index.ts lines 2484–2513 (currently wrapped in `if (false && ...)`)
  // Remove the `false &&` wrapper — just keep the logic here.
  return false; // change to true when re-enabling
}
```

- [ ] **Step 5: Type-check**

```bash
deno check supabase/functions/swarm-bot/handlers/tasks.ts
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/tasks.ts
git commit -m "refactor: extract task management to handlers/tasks.ts"
```

---

## Task 11: Create `handlers/meetings.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/meetings.ts`
- Source lines in index.ts: 1824–1911 (handleConnect, handleMeetings, handleMeetingCallback), plus meeting-related callback blocks from main handler

- [ ] **Step 1: Create the file**

```typescript
import { supabase } from "../lib/supabase.ts";
import { getReadAiToken, readAiGet } from "../lib/readai.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession } from "../lib/storage.ts";
import type { TgCallbackQuery } from "../lib/types.ts";
```

- [ ] **Step 2: Extract meeting functions**

Extract verbatim from index.ts (add `export`):
- `handleConnect` (lines 1824–1836) — `export`
- `handleMeetings` (lines 1837–1870) — `export`
- `handleMeetingCallback` (lines 1871–1911) — `export`

- [ ] **Step 3: Add handleMeetingCallbacks dispatcher**

```typescript
export async function handleMeetingCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  username: string
): Promise<boolean> {
  const data = cb.data;

  if (data.startsWith("meeting_")) {
    await handleMeetingCallback(chatId, username, data.replace("meeting_", ""));
    return true;
  }
  if (data.startsWith("md_")) {
    // Extract verbatim from index.ts lines 2076–2093 (delete meeting + tasks)
    return true;
  }
  if (data.startsWith("rai_")) {
    // Extract verbatim from index.ts lines 2094–2123 (Read.ai menu: saved/import/connect)
    return true;
  }
  if (data.startsWith("mr_")) {
    // Extract verbatim from index.ts lines 2124–2165 (meeting details card)
    return true;
  }
  if (data.startsWith("mrename_")) {
    // Extract verbatim from index.ts lines 2210–2213
    return true;
  }
  if (data.startsWith("mtag_")) {
    // Extract verbatim from index.ts lines 2214–2217
    return true;
  }
  if (data.startsWith("massign_")) {
    // Extract verbatim from index.ts lines 2218–2234
    return true;
  }
  if (data.startsWith("mau_")) {
    // Extract verbatim from index.ts lines 2235–2250
    return true;
  }
  if (data.startsWith("mexp_")) {
    // Extract verbatim from index.ts lines 2300–2313
    return true;
  }
  if (data.startsWith("mc_")) {
    // Extract verbatim from index.ts lines 2314–2323 (confirm meeting)
    return true;
  }
  if (data.startsWith("met_")) {
    // Extract verbatim from index.ts lines 2324–2328 (edit title session)
    return true;
  }
  if (data.startsWith("med_")) {
    // Extract verbatim from index.ts lines 2329–2333 (edit date session)
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Add meeting session text input handler**

```typescript
/* === meeting session text input handlers — called from index.ts session router === */
export async function handleMeetingSessionInput(
  chatId: number,
  action: string,
  text: string
): Promise<boolean> {
  if (action.startsWith("meeting_title_")) {
    // Extract from index.ts lines 2551–2565
    return true;
  }
  if (action.startsWith("meeting_date_")) {
    // Extract from index.ts lines 2566–2589
    return true;
  }
  return false;
}
```

- [ ] **Step 5: Type-check**

```bash
deno check supabase/functions/swarm-bot/handlers/meetings.ts
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/meetings.ts
git commit -m "refactor: extract meeting handlers to handlers/meetings.ts"
```

---

## Task 12: Create `handlers/users.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/users.ts`
- Source lines in index.ts: 1168–1264 (handleUsers), 1690–1717 (startOnboarding), 1726–1800 (showProfile, handleProfileTasks, showProfileEditMenu), 1792–1823 (handleUsersProfile, handleProfileEdit), plus user-related callbacks

- [ ] **Step 1: Create the file**

```typescript
import { supabase } from "../lib/supabase.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

export const PROFILE_FIELDS: Record<string, string> = {
  first_name: "Имя",
  last_name: "Фамилия",
  role: "Роль",
  markets: "Рынки (через запятую)",
  email: "Email",
};
```

- [ ] **Step 2: Extract user functions**

Extract verbatim from index.ts (add `export`):
- `handleUsers` (lines 1168–1264) — `export`
- `startOnboarding` (lines 1690–1703) — `export`
- `showProfile` (lines 1726–1750) — `export`
- `handleProfileTasks` (lines 1751–1783) — `export`
- `showProfileEditMenu` (lines 1784–1791) — `export`
- `handleUsersProfile` (lines 1792–1800) — `export`
- `handleProfileEdit` (lines 1801–1823) — `export`

- [ ] **Step 3: Add handleUserCallbacks dispatcher**

```typescript
export async function handleUserCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number
): Promise<boolean> {
  const data = cb.data;

  if (data.startsWith("ptasks_")) {
    await handleProfileTasks(chatId, Number(data.replace("ptasks_", "")));
    return true;
  }
  if (data.startsWith("pu_")) {
    await showProfile(chatId, Number(data.replace("pu_", "")));
    return true;
  }
  if (data.startsWith("pe_menu_")) {
    await showProfileEditMenu(chatId, Number(data.replace("pe_menu_", "")));
    return true;
  }
  if (data.startsWith("pe_")) {
    // Extract verbatim from index.ts lines 2175–2188
    return true;
  }
  if (data === "start_onboard") {
    await startOnboarding(chatId);
    return true;
  }
  if (data.startsWith("onboard_skip_")) {
    // Extract verbatim from index.ts lines 2191–2209
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Add disabled session handlers**

```typescript
/* === DISABLED: onboarding and profile session text input — re-enable by calling from index.ts === */
export async function handleUserSessionInput(
  chatId: number,
  userId: number,
  action: string,
  text: string
): Promise<boolean> {
  // Extract all onboard_role/markets/email/phone and profile_ blocks
  // from index.ts lines 2515–2550 (currently wrapped in `if (false && ...)`)
  return false; // change to true when re-enabling
}
```

- [ ] **Step 5: Type-check**

```bash
deno check supabase/functions/swarm-bot/handlers/users.ts
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/users.ts
git commit -m "refactor: extract user/profile handlers to handlers/users.ts"
```

---

## Task 13: Create `handlers/digest.ts`

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/digest.ts`
- Source lines in index.ts: 1594–1689 (generatePersonalDigest, sendAllDigests)

- [ ] **Step 1: Create the file**

```typescript
import { supabase } from "../lib/supabase.ts";
import { getEmbedding } from "../lib/openai.ts";
import { sendMessage } from "../lib/telegram.ts";
```

- [ ] **Step 2: Extract digest functions**

Extract verbatim from index.ts (add `export`):
- `generatePersonalDigest` (lines 1594–1677) — `export`
- `sendAllDigests` (lines 1678–1689) — `export`

- [ ] **Step 3: Type-check**

```bash
deno check supabase/functions/swarm-bot/handlers/digest.ts
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/digest.ts
git commit -m "refactor: extract digest handlers to handlers/digest.ts"
```

---

## Task 14: Rewrite `index.ts` as clean dispatcher

This is the final integration task. Replace the entire `index.ts` with a clean dispatcher that imports all modules.

**Files:**
- Modify (rewrite): `supabase/functions/swarm-bot/index.ts`

- [ ] **Step 1: Write the new index.ts**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabase, ADMIN_USER_ID } from "./lib/supabase.ts";
import { sendMessage, buildKeyboard, answerCallback } from "./lib/telegram.ts";
import { checkAllowed, autoSyncProfile, getSession, clearSession } from "./lib/storage.ts";
import { getReadAiToken } from "./lib/readai.ts";
import { handleAdd, handleAsk } from "./handlers/knowledge.ts";
import { handleVoice, handleDocument, handlePhoto, handleUrl, extractUrl } from "./handlers/media.ts";
import { handleTasks, smartTaskSearch, TASK_KEYWORDS, handleTaskCallbacks, analyzeAndCreateTasks } from "./handlers/tasks.ts";
import { handleMeetings, handleMeetingCallbacks, handleMeetingSessionInput } from "./handlers/meetings.ts";
import { handleUsers, handleUserCallbacks, showProfile, startOnboarding } from "./handlers/users.ts";
import { generatePersonalDigest, sendAllDigests as digestCron } from "./handlers/digest.ts";
import { getHelpText } from "./handlers/help.ts"; // see note below
import type { TgMessage, TgCallbackQuery } from "./lib/types.ts";
```

**Note:** Extract `getHelpText` function (index.ts lines 1912–1939) to a new file `handlers/help.ts` — it's a pure string function with no dependencies. Create this file as part of this task.

- [ ] **Step 2: Write cron handlers block**

```typescript
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response("Bad Request", { status: 400 }); }

  // ── Cron triggers ─────────────────────────────────────────────────────────
  if (body.setup_commands === true) {
    // Extract verbatim from index.ts lines 1960–1978
  }

  if (body.digest_cron === true) {
    await digestCron(7);
    return new Response("OK", { status: 200 });
  }

  if (body.readai_token_refresh === true) {
    // Extract verbatim from index.ts lines 1985–2006 (token refresh + stale meeting alert)
  }
```

- [ ] **Step 3: Write callback dispatcher**

```typescript
  const update = body as { message?: TgMessage; callback_query?: TgCallbackQuery };

  // ── Callback query ─────────────────────────────────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = cb.from.id ?? 0;
    const username = cb.from.username ?? String(userId);
    const chatId = cb.message.chat.id;

    await answerCallback(cb.id);
    if (!(await checkAllowed(userId))) return new Response("OK", { status: 200 });

    try {
      if (await handleTaskCallbacks(cb, chatId, userId, username)) {
        // handled
      } else if (await handleMeetingCallbacks(cb, chatId, username)) {
        // handled
      } else if (await handleUserCallbacks(cb, chatId, userId)) {
        // handled
      }
    } catch (err) {
      await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }

    return new Response("OK", { status: 200 });
  }
```

- [ ] **Step 4: Write message dispatcher**

```typescript
  const message = update.message;
  if (!message) return new Response("OK", { status: 200 });

  const chatId = message.chat.id;
  const userId = message.from?.id ?? 0;
  const username = message.from?.username ?? String(userId);

  const allowed = await checkAllowed(userId, message.from?.username);
  if (!allowed) {
    await sendMessage(chatId, "Доступ запрещён. Обратитесь к администратору.");
    return new Response("OK", { status: 200 });
  }

  await autoSyncProfile(userId, message.from?.first_name, message.from?.last_name, message.from?.username);

  try {
    if (message.voice) { bgRun(handleVoice(chatId, username, message.voice.file_id, message.voice.duration), chatId); return new Response("OK", { status: 200 }); }
    if (message.audio) { bgRun(handleVoice(chatId, username, message.audio.file_id, 0), chatId); return new Response("OK", { status: 200 }); }
    if (message.document) { bgRun(handleDocument(chatId, username, message.document), chatId); return new Response("OK", { status: 200 }); }
    if (message.photo?.length) { bgRun(handlePhoto(chatId, username, message.photo), chatId); return new Response("OK", { status: 200 }); }

    const text = message.text?.trim();
    if (!text) return new Response("OK", { status: 200 });

    const BUTTON_LABELS = new Set(["📥 Добавить", "❓ Спросить", "📋 Задачи", "ℹ️ Помощь", "👥 Пользователи", "🎙 Встречи", "🎙 Read.ai"]);
    const isButtonPress = BUTTON_LABELS.has(text);
    const isCommand = text.startsWith("/") || isButtonPress;

    if (!isCommand) {
      const url = extractUrl(text);
      if (url && text.length < 300) { await handleUrl(chatId, username, url); return new Response("OK", { status: 200 }); }

      const session = await getSession(chatId);
      const action = session?.action ?? null;

      if (action === "waiting_add") {
        await clearSession(chatId);
        await handleAdd(chatId, username, text);
      } else if (action === "waiting_ask") {
        await clearSession(chatId);
        await handleAsk(chatId, text);
      } else if (await handleMeetingSessionInput(chatId, action ?? "", text)) {
        // meeting session handled
      } else {
        if (text.length >= 3) await handleAsk(chatId, text);
      }
      return new Response("OK", { status: 200 });
    }

    // Commands
    const [command, ...rest] = text.split(/\s+/);
    const argText = isButtonPress ? "" : rest.join(" ");
    await clearSession(chatId);

    if (command === "/reset") {
      await clearSession(chatId); await sendMessage(chatId, "🔄 Сброс выполнен.");
    } else if (command === "/start") {
      // Extract verbatim from index.ts lines 2607–2623
    } else if (command === "/help" || text === "ℹ️ Помощь") {
      await sendMessage(chatId, getHelpText(), buildKeyboard());
    } else if (command === "/add" || text === "📥 Добавить") {
      await handleAdd(chatId, username, argText);
    } else if (command === "/ask" || text === "❓ Спросить") {
      await handleAsk(chatId, argText.trim() ? argText : "");
    } else if (command === "/meetings") {
      // Extract verbatim from index.ts lines 2645–2670
    } else if (command === "/status") {
      // Extract verbatim from index.ts lines 2729–2755
    } else {
      await sendMessage(chatId, `Неизвестная команда: <code>${command}</code>\n\nИспользуй /help для списка команд.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `Произошла ошибка: ${msg}`);
  }

  return new Response("OK", { status: 200 });
});
```

- [ ] **Step 5: Add bgRun helper**

```typescript
function bgRun(promise: Promise<void>, chatId: number): void {
  const safe = promise.catch(async (err) => {
    await sendMessage(chatId, `Ошибка обработки: ${err instanceof Error ? err.message : String(err)}`);
  });
  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(safe);
}
```

- [ ] **Step 6: Create `handlers/help.ts`**

```typescript
export function getHelpText(): string {
  // Extract verbatim from index.ts lines 1912–1939
}
```

- [ ] **Step 7: Type-check the full tree**

```bash
deno check supabase/functions/swarm-bot/index.ts
```
Expected: no errors. Fix any type mismatches before proceeding.

- [ ] **Step 8: Deploy and smoke test**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Test in Telegram:
1. Отправь любой текст — должен вернуть ответ из базы знаний
2. Нажми "📥 Добавить", отправь текст — должно сохраниться
3. Спроси про встречу с запросом "дай исходник" — должен прийти `.txt` файл
4. Нажми /meetings — должен показать список встреч
5. Нажми /status — должен показать статистику

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/swarm-bot/
git commit -m "refactor: complete swarm-bot modularization, index.ts now clean dispatcher"
```

---

## Проверка по спеку

| Требование | Задача |
|---|---|
| `index.ts` ~250 строк | Task 14 |
| `lib/telegram.ts` | Task 3 |
| `lib/openai.ts` | Task 4 |
| `lib/drive.ts` | Task 5 |
| `lib/readai.ts` | Task 6 |
| `lib/storage.ts` | Task 7 |
| `handlers/knowledge.ts` | Task 8 |
| `handlers/media.ts` | Task 9 |
| `handlers/tasks.ts` | Task 10 |
| `handlers/meetings.ts` | Task 11 |
| `handlers/users.ts` | Task 12 |
| `handlers/digest.ts` | Task 13 |
| Disabled-код в модулях, не удалён | Tasks 10, 12 |
| Source text fix (убран wants_full_text) | Task 8 Step 2–3 |
| System prompt fix для исходников | Task 8 Step 5 |
| Кнопки без изменений | Task 14 Step 4 |
| Поведение бота не меняется | Task 14 Step 8 |
