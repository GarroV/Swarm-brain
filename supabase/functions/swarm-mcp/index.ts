import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { externalFetch, VIA_OPENAI_CHAT, VIA_OPENAI_EMBEDDING } from "../_shared/external-fetch.ts";
import {
  COMMENT_TOOL_DEFINITIONS,
  LABEL_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  TASK_TOOL_DEFINITIONS,
  toolAddTask,
  toolAddTaskComment,
  toolDeleteTask,
  toolDeleteTaskComment,
  toolGetProjects,
  toolGetRecentComments,
  toolGetTaskComments,
  toolGetTasks as toolGetTasksMcp,
  toolListTaskLabels,
  toolUpdateTask,
} from "./tasks/tools.ts";
import {
  ANALYTICS_TOOL_DEFINITIONS,
  toolGetRecentTaskChanges,
  toolGetTaskHistory,
  toolGetTaskStats,
} from "./tasks/analytics.ts";
import { SPRINT_TOOL_DEFINITIONS, SPRINT_TOOLS } from "./tasks/sprints.ts";
import { PERSONAL_TOOL_DEFINITIONS, PERSONAL_TOOLS } from "./tasks/personal.ts";
import {
  COUNTRY_PROMPT_RULE,
  detectQueryCountry,
  ENTRY_TYPE_PROMPT_RULE,
  normalizeCountries,
} from "../_shared/countries.ts";
import {
  applyGeneralSentinel,
  extractEntryMeta,
  marketTagsFromInput,
  specificCountries,
} from "../_shared/meta-extract.ts";
import { matchEntries } from "../_shared/search.ts";
import { detectQuerySince } from "../_shared/query-time.ts";
import { ALL_MEETING_SOURCES } from "../_shared/sources.ts";
import { isFeedbackStatus } from "../_shared/feedback-categories.ts";
import { normalizeExtractedEventDate, todayIso } from "../_shared/llm-date.ts";
import { canViewEntry, entryAccessError, type EntryAccessRow, entryVisibilityOr } from "../_shared/entries/access.ts";
import { withTokenIdentity } from "./identity.ts";
import { authorizeToolCall, NO_WORKSPACE_MESSAGE, resolveCallerScope, withCallerIdentity } from "./auth.ts";
import {
  MEETING_REVIEW_TOOL_DEFINITIONS,
  toolExtractTasksFromMeeting,
  toolGetDraftMeeting,
  toolGetReviewQueue,
  toolPublishDraftMeeting,
  toolUpdateDraftMeeting,
} from "./meetings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

import { absoluteFileUrl, removeStorageObject } from "../_shared/storage-links.ts";
import {
  discardOwnUpload,
  registerStorageFile,
  type UploadedFile,
  uploadNewPrivateFile,
} from "../_shared/storage-files.ts";
import { onlyLiveEntries } from "../_shared/entries/live.ts";
import { archiveEntry } from "../_shared/entries/archive.ts";

// Адрес веба: ссылку на файл отдаём абсолютной — получатель ответа (Claude Desktop)
// не наша страница, относительный путь там некликабелен.
const WEB_BASE_URL = Deno.env.get("WEB_BASE_URL") ?? "https://swarm-brain.pages.dev";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Владелец (админ) — единственный, кому доступна поверхность фидбека. Совпадает с ADMIN_USER_ID в боте.
const ADMIN_USER_ID = 744230399;

async function getUserGroupId(telegramId: number): Promise<string | null> {
  const { data } = await supabase
    .from("allowed_users")
    .select("group_id")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return (data as { group_id: string | null } | null)?.group_id ?? null;
}

// Личность + воркспейс вызывающего внутри инструмента. null → инструмент отказывает: выборки
// «по всем воркспейсам» из MCP не бывает (второй рубеж после authorizeToolCall в tools/call).
const callerScope = (userId: number | null | undefined) => resolveCallerScope(userId, getUserGroupId);

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function err(id: unknown, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function textContent(text: string) {
  return { content: [{ type: "text", text }] };
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await externalFetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  }, { ...VIA_OPENAI_EMBEDDING, usage: { purpose: "mcp:embedding" } });
  const data = await res.json() as { data?: Array<{ embedding: number[] }>; error?: { message?: string } };
  if (!res.ok || !data.data?.[0]) {
    throw new Error(`OpenAI embeddings: HTTP ${res.status} ${data.error?.message ?? ""}`.trim());
  }
  return data.data[0].embedding;
}

/**
 * Эмбеддинг для СОХРАНЕНИЯ: отказ модели не роняет запись (#373). Главное правило базы —
 * «сначала сохрани оригинал»: раньше отказ OpenAI ронял add_knowledge целиком, и текст терялся.
 * Теперь запись ложится с embedding = null, ежечасный проход swarm-bot дозаполняет индекс, а
 * человек слышит честное «пока не находится поиском» (UNINDEXED_NOTE).
 */
async function embeddingOrNull(text: string): Promise<number[] | null> {
  try {
    return await getEmbedding(text);
  } catch (e) {
    console.error("[swarm-mcp] эмбеддинг не получен — запись сохраняется без индекса:", e);
    return null;
  }
}

const UNINDEXED_NOTE =
  "\n⚠️ Модель поиска сейчас не ответила: запись сохранена, но поиском по смыслу пока не находится. Индекс дозаполнится автоматически в течение часа.";

async function chatComplete(
  system: string,
  user: string,
  opts: { temperature?: number; json?: boolean } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: 300,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: "json_object" };
  const res = await externalFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  }, { ...VIA_OPENAI_CHAT, usage: { purpose: "mcp:chat" } });
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

// Правило видимости — одно на все поверхности (_shared/entries/access.ts): общие, свои и
// разделённые со мной (встреча 1-1, #641).
function visibilityFilter(userId: number): string {
  return entryVisibilityOr(userId);
}

function mimeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}

async function uploadToStorage(
  fileContentBase64: string,
  fileName: string,
  mimeType: string,
  groupId: string,
): Promise<{ path: string; file: UploadedFile; fileSizeBytes: number }> {
  const bytes = Uint8Array.from(atob(fileContentBase64), (c) => c.charCodeAt(0));
  // Ключ — в воркспейсе владельца, с uuid, без перезаписи (buildUploadKey). Транслит вместо
  // голой замены: имя «отчёт.pdf» превращалось в «______.pdf».
  const { file, error } = await uploadNewPrivateFile(supabase, {
    folder: "uploads",
    scope: groupId,
    fileName,
    body: bytes,
    contentType: mimeType,
  });
  if (error || !file) throw new Error(`Storage upload failed: ${error ?? "unknown"}`);

  // Публичной ссылки больше нет: наружу отдаётся /api/file/<path>, а в metadata — путь.
  return { path: file.path, file, fileSizeBytes: bytes.length };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "whoami",
    description:
      "Кто я: имя, внутренний ID и воркспейс пользователя, от чьего имени работает этот коннектор (определяется токеном).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_knowledge",
    description: "Семантический поиск по командной базе знаний. Ищет по смыслу — документы, заметки, встречи, ссылки.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос" },
        limit: { type: "number", description: "Количество результатов (по умолчанию 5, макс 20)" },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — include to see your private entries in results",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_tasks",
    description:
      "Получить задачи команды с фильтрами по исполнителю, стране, статусу или проекту (в том числе «без проекта»). Не больше 30 строк: если подошло больше, первой строкой печатается «показаны N из M». В каждой строке — id задачи (им вызываются get_task_comments, add_task_comment и update_task) и проект.",
    inputSchema: {
      type: "object",
      properties: {
        assignee: { type: "string", description: "Имя исполнителя" },
        country: { type: "string", description: "Страна или рынок" },
        status: { type: "string", enum: ["backlog", "open", "in_progress", "done", "cancelled"] },
        period: { type: "string", enum: ["week"], description: "Задачи на этой неделе" },
        label: { type: "string", description: "Имя личной смарт-метки для фильтра" },
        project: {
          type: "string",
          description:
            "Имя проекта или подпроекта доски — фильтр по нему. Не найден — отказ со списком доступных проектов (задачи НЕ показываются). Точные имена — get_projects. Подпроекты сюда не входят: у каждого свой фильтр.",
        },
        no_project: {
          type: "boolean",
          description:
            "true — только задачи вне проектов (висят в общем списке, не на доске). Нельзя вместе с project.",
        },
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу",
        },
      },
      required: ["requesting_user_id"],
    },
  },
  ...TASK_TOOL_DEFINITIONS,
  ...PROJECT_TOOL_DEFINITIONS,
  ...LABEL_TOOL_DEFINITIONS,
  ...COMMENT_TOOL_DEFINITIONS,
  ...ANALYTICS_TOOL_DEFINITIONS,
  ...SPRINT_TOOL_DEFINITIONS,
  ...PERSONAL_TOOL_DEFINITIONS,
  ...MEETING_REVIEW_TOOL_DEFINITIONS,
  {
    name: "get_meetings",
    description: "Получить последние встречи из Read.ai сохранённые в базе знаний.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Количество встреч (по умолчанию 10)" },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — filters meetings to your workspace",
        },
      },
    },
  },
  {
    name: "get_users",
    description: "Получить список пользователей команды с их профилями: имя, роль, рынки, контакты.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Фильтр по рынку/стране" },
        requesting_user_id: { type: "number", description: "Your Telegram user ID — filters users to your workspace" },
      },
    },
  },
  {
    name: "get_feedback",
    description:
      "Фидбек пользователей (баги/идеи) из бота и веба. Только для владельца. По умолчанию — незакрытые (new/triaged). Фильтры: status, category.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["new", "triaged", "done", "wontfix"],
          description: "Фильтр по статусу (по умолчанию — незакрытые)",
        },
        category: {
          type: "string",
          description: "Раздел: recorder|meetings|search|tasks|knowledge|digest|auth|integrations|claude|ui|other",
        },
        limit: { type: "number", description: "Сколько вернуть (по умолчанию 30, макс 100)" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен (только владелец)" },
      },
    },
  },
  {
    name: "resolve_feedback",
    description:
      "Пометить фидбек статусом (triaged/done/wontfix) и опционально привязать к задаче (task_id). Только для владельца.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID фидбека из get_feedback" },
        status: {
          type: "string",
          enum: ["new", "triaged", "done", "wontfix"],
          description: "Новый статус (по умолчанию done)",
        },
        task_id: { type: "string", description: "ID задачи, если фидбек превращён в задачу" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен (только владелец)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_entry",
    description:
      "Получить полный текст записи из базы знаний по ID. Используй когда search_knowledge вернул обрезанный текст.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из результатов search_knowledge" },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — required to access your private entries",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "add_knowledge",
    description:
      "Добавить текст в командную базу знаний. summary обязателен. content — ВСЕГДА передавай полный оригинальный текст целиком, не сокращая. Инструмент сам разобьёт на части при необходимости.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Полный оригинальный текст целиком — обязательно передавай весь, без сокращений",
        },
        summary: { type: "string", description: "Детальные тезисы — согласованные с пользователем ключевые пункты" },
        source: { type: "string", description: "Источник (название файла, тип контента)" },
        is_private: {
          type: "boolean",
          description: "Set true to save in personal private storage, invisible to other users",
        },
        owner_telegram_id: { type: "number", description: "Your Telegram user ID — required when is_private is true" },
      },
      required: ["summary"],
    },
  },
  {
    name: "list_entries",
    description:
      "Список записей в базе знаний с фильтрами. Используй для ревизии — посмотреть что есть, найти старые или дублирующие записи.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Фильтр по источнику: telegram, voice, pdf, document, read_ai, url, claude и др.",
        },
        entry_type: {
          type: "string",
          description: "Тип записи: meeting (транскрипт/тезисы созвона) или note (всё остальное)",
        },
        date_from: { type: "string", description: "Дата от в формате YYYY-MM-DD" },
        date_to: { type: "string", description: "Дата до в формате YYYY-MM-DD" },
        limit: { type: "number", description: "Количество записей (по умолчанию 20, макс 100)" },
        has_file: {
          type: "boolean",
          description: "true — только записи с прикреплённым файлом, false — только без файла",
        },
        has_no_countries: {
          type: "boolean",
          description: "true — только записи без тегов стран (нужна переиндексация)",
        },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — include to see your private entries in results",
        },
      },
    },
  },
  {
    name: "delete_entry",
    description:
      "Удалить запись из базы знаний по ID. Запись уходит в архив вместе с задачами встречи и пропадает из поиска и списков; прикреплённый файл по ссылке больше не открывается. Можно удалить только свою запись (owner_id = requesting_user_id).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из list_entries или search_knowledge" },
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для проверки права на удаление",
        },
      },
      required: ["id", "requesting_user_id"],
    },
  },
  {
    name: "update_entry",
    description:
      "Обновить содержимое записи: текст, тезисы или метаданные. Используй чтобы исправить или дополнить существующую запись.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи" },
        content: { type: "string", description: "Новый полный текст (опционально)" },
        summary: { type: "string", description: "Новые тезисы (опционально)" },
        title: { type: "string", description: "Новый заголовок в metadata (опционально)" },
        entry_date: { type: "string", description: "Новая дата события YYYY-MM-DD (опционально)" },
        countries: {
          type: "array",
          items: { type: "string" },
          description: "Список стран/рынков на английском: Serbia, Croatia, Moldova и т.д. (опционально)",
        },
        file_content_base64: {
          type: "string",
          description: "Новый файл в base64 — заменяет текущий файл (требует file_name)",
        },
        file_name: { type: "string", description: "Имя нового файла с расширением" },
      },
      required: ["id"],
    },
  },
  {
    name: "reindex_entry",
    description:
      "Перечитать запись и пересчитать страны + embedding через GPT. Используй когда у записи пустые или неправильные страны, или embedding устарел. Можно передать новый summary — иначе берётся существующий.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из list_entries или search_knowledge" },
        summary: {
          type: "string",
          description: "Новые тезисы (опционально — если не передан, используется существующий)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "upload_file",
    description:
      "Загрузить файл в хранилище Swarm Brain. Передай содержимое файла в base64. Максимальный размер ~4 MB. После загрузки создаётся запись в базе знаний с публичной ссылкой на файл.",
    inputSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Имя файла с расширением, например contract.pdf" },
        file_content_base64: { type: "string", description: "Содержимое файла, закодированное в base64" },
        mime_type: { type: "string", description: "MIME-тип (опционально, определяется по расширению автоматически)" },
        summary: { type: "string", description: "Описание файла / тезисы содержимого для индексации" },
        source: { type: "string", description: "Источник (по умолчанию: file)" },
        requesting_user_id: { type: "number", description: "Your Telegram user ID — sets workspace for uploaded file" },
      },
      required: ["file_name", "file_content_base64", "summary"],
    },
  },
  {
    name: "get_storage_stats",
    description: "Статистика базы знаний: общее количество записей, количество файлов, разбивка по типам и источникам.",
    inputSchema: {
      type: "object",
      properties: {
        requesting_user_id: { type: "number", description: "Your Telegram user ID — filters stats to your workspace" },
      },
    },
  },
];

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolSearchKnowledge(
  args: { query: string; limit?: number; requesting_user_id?: number },
): Promise<string> {
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;
  const embedding = await getEmbedding(args.query);

  let data;
  try {
    data = await matchEntries(supabase, embedding, {
      groupId: scope.groupId,
      requestingUserId: scope.userId,
      limit: Math.min(args.limit ?? 5, 20),
      queryText: args.query,
      country: detectQueryCountry(args.query),
      since: detectQuerySince(args.query),
    });
  } catch (e) {
    return `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!data.length) return "Ничего не найдено по запросу.";

  return data.map((e, i) => {
    const date = e.entry_date ? new Date(e.entry_date).toLocaleDateString("ru-RU") : "—";
    const preview = e.content.length > 3000
      ? e.content.slice(0, 3000) + `\n...[текст обрезан, полный текст: get_entry("${e.id}")]`
      : e.content;
    return `[${i + 1}] id:${e.id} (${e.source} · ${date})\n${preview}`;
  }).join("\n\n---\n\n");
}

async function toolGetMeetings(args: { limit?: number; requesting_user_id?: number }): Promise<string> {
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;

  const query = onlyLiveEntries(
    supabase
      .from("entries")
      .select("content, metadata, created_at"),
  )
    .in("source", ALL_MEETING_SOURCES)
    // Приватность: чужие личные встречи невидимы. Только публичные ИЛИ свои приватные
    // (owner_id = вызывающий). Без admin-байпаса: приватное видит ТОЛЬКО владелец.
    .or(visibilityFilter(scope.userId))
    .eq("group_id", scope.groupId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 10);
  const { data, error } = await query;

  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Встреч пока нет.";

  return data.map((m: { metadata: Record<string, unknown>; created_at: string; content: string }, i: number) => {
    const title = (m.metadata?.title as string) ?? "Встреча";
    const date = new Date(m.created_at).toLocaleDateString("ru-RU");
    const preview = m.content.split("Стенограмма:")[0].trim().slice(0, 600);
    return `[${i + 1}] ${title} · ${date}\n${preview}`;
  }).join("\n\n---\n\n");
}

async function toolWhoami(args: { requesting_user_id?: number }): Promise<string> {
  const userId = args.requesting_user_id;
  if (!userId) return "Личность не определена: коннектор подключён без токена (/mytoken в боте).";

  const { data: user } = await supabase
    .from("allowed_users")
    .select("telegram_id, username, group_id")
    .eq("telegram_id", userId)
    .maybeSingle();
  if (!user) return `Пользователь ${userId} не найден среди участников.`;
  const row = user as { telegram_id: number; username: string | null; group_id: string | null };

  const [{ data: profile }, { data: workspace }] = await Promise.all([
    supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", userId).maybeSingle(),
    row.group_id
      ? supabase.from("workspaces").select("name").eq("id", row.group_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const p = profile as { first_name?: string | null; last_name?: string | null } | null;
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || (row.username ? `@${row.username}` : "—");
  const ws = (workspace as { name?: string } | null)?.name ?? row.group_id ?? "—";
  const role = userId === ADMIN_USER_ID ? "\nРоль: владелец" : "";
  return `Имя: ${name}\nВнутренний ID: ${userId}\nВоркспейс: ${ws}${role}`;
}

async function toolGetUsers(args: { market?: string; requesting_user_id?: number }): Promise<string> {
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;

  const { data: rows, error } = await supabase
    .from("allowed_users")
    .select("telegram_id, username")
    .eq("group_id", scope.groupId);
  if (error) return `Ошибка: ${error.message}`;
  // Приглашённые, но ещё не вошедшие — строки без telegram_id. Их не показываем, а один null
  // в `.in(...)` ронял запрос профилей целиком (прод, 25.09).
  const users = ((rows ?? []) as { telegram_id: number | null; username: string | null }[])
    .filter((u): u is { telegram_id: number; username: string | null } => typeof u.telegram_id === "number");
  if (!users.length) return "Пользователей нет.";

  const ids = users.map((u) => u.telegram_id);
  const { data: profiles, error: profErr } = await supabase.from("user_profiles").select("*").in("telegram_id", ids);
  if (profErr) console.error("[get_users] profiles", profErr.message);
  const profileMap = Object.fromEntries((profiles ?? []).map((p: { telegram_id: number }) => [p.telegram_id, p]));

  // markets — text[]: `.ilike` по массиву PostgREST не принимает. Фильтр в коде, без учёта
  // регистра и по подстроке, как было задумано.
  const market = args.market?.trim().toLowerCase();
  const shown = market
    ? users.filter((u) => {
      const ms = (profileMap[u.telegram_id] as { markets?: string[] | null } | undefined)?.markets ?? [];
      return ms.some((m) => m.toLowerCase().includes(market));
    })
    : users;
  if (!shown.length) return market ? `Пользователей с рынком «${args.market}» нет.` : "Пользователей нет.";

  return shown.map((u) => {
    const p = profileMap[u.telegram_id] as Record<string, unknown> | undefined;
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
      (u.username ? `@${u.username}` : `#${u.telegram_id}`);
    const role = p?.role ? `\n  Роль: ${p.role}` : "";
    const markets = (p?.markets as string[] | undefined)?.length
      ? `\n  Рынки: ${(p?.markets as string[]).join(", ")}`
      : "";
    const phone = p?.phone ? `\n  Тел: ${p.phone}` : "";
    const email = p?.email ? `\n  Email: ${p.email}` : "";
    return `• ${name}${role}${markets}${phone}${email}`;
  }).join("\n\n");
}

async function toolGetFeedback(
  args: { status?: string; category?: string; limit?: number; requesting_user_id?: number },
): Promise<string> {
  if (args.requesting_user_id !== ADMIN_USER_ID) return "Доступно только владельцу.";
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);

  let query = supabase
    .from("feedback")
    .select("id, text, category, source, username, status, screenshot_url, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  // По умолчанию — незакрытые (то, что ещё требует разбора).
  if (args.status) query = query.eq("status", args.status);
  else query = query.not("status", "in", "(done,wontfix)");
  if (args.category) query = query.eq("category", args.category);

  const { data, error } = await query;
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Фидбека нет.";

  return data.map((f: Record<string, unknown>) => {
    const date = new Date(f.created_at as string).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const shot = f.screenshot_url ? `\n  Скрин: ${f.screenshot_url}` : "";
    return `• [${f.category}] (${f.source}, ${f.status}) @${
      f.username ?? "?"
    } · ${date}\n  ${f.text}${shot}\n  id: ${f.id}`;
  }).join("\n\n");
}

async function toolResolveFeedback(
  args: { id: string; status?: string; task_id?: string; requesting_user_id?: number },
): Promise<string> {
  if (args.requesting_user_id !== ADMIN_USER_ID) return "Доступно только владельцу.";
  if (!args.id) return "Нужен id фидбека.";
  const status = args.status ?? "done";
  if (!isFeedbackStatus(status)) return `Недопустимый статус: ${status}`;

  const update: Record<string, unknown> = { status };
  if (status === "done" || status === "wontfix") update.resolved_at = new Date().toISOString();
  if (args.task_id) update.task_id = args.task_id;

  const { error } = await supabase.from("feedback").update(update).eq("id", args.id);
  if (error) return `Ошибка: ${error.message}`;
  return `Фидбек ${args.id} → ${status}${args.task_id ? ` (задача ${args.task_id})` : ""}.`;
}

async function toolGetEntry(args: { id: string; requesting_user_id?: number }): Promise<string> {
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;

  const { data, error } = await onlyLiveEntries(
    supabase
      .from("entries")
      .select("content, source, created_at, is_private, owner_id, shared_with"),
  )
    .eq("id", args.id)
    .eq("group_id", scope.groupId)
    .maybeSingle();
  if (error) return `Ошибка: ${error.message}`;
  if (!data) return "Запись не найдена.";

  const row = data as {
    content: string;
    source: string;
    created_at: string;
    is_private: boolean;
    owner_id: number | null;
    shared_with: number[] | null;
  };
  if (!canViewEntry(row, scope.userId)) {
    return "Запись не найдена.";
  }

  const date = new Date(row.created_at).toLocaleDateString("ru-RU");
  return `(${row.source} · ${date})\n\n${row.content}`;
}

async function toolAddKnowledge(
  args: {
    content?: string;
    summary: string;
    source?: string;
    is_private?: boolean;
    owner_telegram_id?: number;
    requesting_user_id?: number;
  },
): Promise<string> {
  const CHUNK = 3000, OVERLAP = 200;
  const source = args.source ?? "claude";
  const rawContent = args.content?.trim() || args.summary;

  // Split original content into chunks for storage
  const chunks: string[] = [];
  if (rawContent.length <= CHUNK) {
    chunks.push(rawContent);
  } else {
    for (let pos = 0; pos < rawContent.length; pos += CHUNK - OVERLAP) {
      chunks.push(rawContent.slice(pos, pos + CHUNK));
    }
  }

  // Chunk grouping UUID (not the workspace group_id)
  const chunkGroupId = chunks.length > 1 ? crypto.randomUUID() : null;

  // Личность вызывающего — только из токена (tools/call перетирает поля личности в аргументах).
  // Владелец ЛИЧНОЙ записи = вызывающий; воркспейс записи = воркспейс вызывающего.
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;
  const isPrivate = args.is_private === true;
  const ownerId = isPrivate ? scope.userId : null;
  const workspaceGroupId = scope.groupId;
  const [summaryEmbedding, entryMeta] = await Promise.all([
    embeddingOrNull(args.summary.slice(0, 8000)),
    extractEntryMeta(args.summary, OPENAI_API_KEY),
  ]);

  let unindexed = summaryEmbedding === null;
  // First chunk: summary + metadata + embedding
  const { error: insertErr } = await supabase.from("entries").insert({
    content: chunks[0],
    summary: args.summary,
    embedding: summaryEmbedding,
    added_by: "claude_desktop",
    source,
    metadata: chunkGroupId ? { total_chunks: chunks.length, chunk: 1, chunk_group_id: chunkGroupId } : {},
    countries: applyGeneralSentinel(entryMeta.countries),
    entry_type: entryMeta.entry_type,
    entry_date: entryMeta.entry_date,
    group_id: workspaceGroupId,
    is_private: isPrivate,
    owner_id: ownerId,
  });
  if (insertErr) return `Ошибка сохранения: ${insertErr.message}`;

  // Remaining chunks: content only, same chunk_group_id in metadata
  if (chunks.length > 1) {
    const restEmbeddings = await Promise.all(chunks.slice(1).map((c) => embeddingOrNull(c)));
    if (restEmbeddings.includes(null)) unindexed = true;
    try {
      await Promise.all(
        chunks.slice(1).map((chunk, i) =>
          supabase.from("entries").insert({
            content: chunk,
            summary: null,
            embedding: restEmbeddings[i],
            added_by: "claude_desktop",
            source,
            metadata: { total_chunks: chunks.length, chunk: i + 2, chunk_group_id: chunkGroupId },
            countries: applyGeneralSentinel(entryMeta.countries),
            entry_type: entryMeta.entry_type,
            entry_date: entryMeta.entry_date,
            group_id: workspaceGroupId,
            is_private: isPrivate,
            owner_id: ownerId,
          })
        ),
      );
    } catch (e) {
      return `Ошибка сохранения (часть ${e instanceof Error ? e.message : String(e)}).`;
    }
  }

  const contentNote = !args.content?.trim() ? " (оригинал не передан)" : "";
  const dest = isPrivate ? "личное хранилище" : "базу знаний";
  return `✅ Добавлено в ${dest} (${chunks.length} ${chunks.length === 1 ? "часть" : "части/частей"}).${contentNote}${
    unindexed ? UNINDEXED_NOTE : ""
  }`;
}

async function toolUploadFile(args: {
  file_name: string;
  file_content_base64: string;
  mime_type?: string;
  summary: string;
  source?: string;
  requesting_user_id?: number;
}): Promise<string> {
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;
  const source = args.source ?? "file";
  const mimeType = args.mime_type ?? mimeFromExtension(args.file_name);

  let uploadResult: { path: string; file: UploadedFile; fileSizeBytes: number };
  try {
    uploadResult = await uploadToStorage(args.file_content_base64, args.file_name, mimeType, scope.groupId);
  } catch (e) {
    return `Ошибка загрузки файла: ${e instanceof Error ? e.message : String(e)}`;
  }

  const [embedding, entryMeta] = await Promise.all([
    embeddingOrNull(args.summary.slice(0, 8000)),
    extractEntryMeta(args.summary, OPENAI_API_KEY),
  ]);

  const workspaceGroupId = scope.groupId;

  const { data: created, error } = await supabase.from("entries").insert({
    content: args.summary,
    summary: args.summary,
    embedding,
    added_by: "claude_desktop",
    source,
    metadata: {
      file_url: uploadResult.path,
      file_name: args.file_name,
      mime_type: mimeType,
      file_size_bytes: uploadResult.fileSizeBytes,
    },
    countries: applyGeneralSentinel(entryMeta.countries),
    entry_type: entryMeta.entry_type,
    entry_date: entryMeta.entry_date,
    group_id: workspaceGroupId,
  }).select("id").single();

  if (error) {
    await discardOwnUpload(supabase, uploadResult.file);
    return `Ошибка создания записи: ${error.message}`;
  }

  // Без строки реестра файл недоступен (эндпоинт /file отдаёт 404) — откатываем всё,
  // чтобы не оставить запись с вечно ломающимся вложением.
  const regNew = await registerStorageFile(supabase, {
    path: uploadResult.path,
    owner: { kind: "entry", entryId: (created as { id: string }).id },
  });
  if (regNew.error) {
    await discardOwnUpload(supabase, uploadResult.file);
    // archive-ok: откат только что вставленной записи — её никто не видел, архивировать нечего
    await supabase.from("entries").delete().eq("id", (created as { id: string }).id);
    return `Ошибка регистрации файла: ${regNew.error}`;
  }

  const sizeKb = Math.round(uploadResult.fileSizeBytes / 1024);
  return `✅ Файл загружен: ${args.file_name} (${sizeKb} KB)\n📎 ${absoluteFileUrl(uploadResult.path, WEB_BASE_URL)}${
    embedding === null ? UNINDEXED_NOTE : ""
  }`;
}

async function toolGetStorageStats(args: { requesting_user_id?: number } = {}): Promise<string> {
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;

  const query = onlyLiveEntries(
    supabase
      .from("entries")
      .select("entry_type, source, created_at, metadata"),
  )
    // Статистика считает только видимые записи: чужие приватные не попадают в счётчики
    // (та же приватность, что в list_entries/get_meetings).
    .or(visibilityFilter(scope.userId))
    .eq("group_id", scope.groupId)
    .order("created_at", { ascending: false })
    .limit(2000);
  const { data, error } = await query;

  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "База знаний пуста.";

  type Row = { entry_type: string; source: string; created_at: string; metadata: Record<string, unknown> | null };
  const rows = data as Row[];

  const total = rows.length;
  const withFiles = rows.filter((r) => !!(r.metadata?.file_url)).length;

  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    byType[r.entry_type] = (byType[r.entry_type] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }

  const fmtMap = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");

  const lastDate = new Date(rows[0].created_at).toLocaleDateString("ru-RU");

  return [
    `📊 База знаний Swarm Brain:`,
    `  Всего записей: ${total} (из них с файлами: ${withFiles})`,
    ``,
    `  По типу: ${fmtMap(byType)}`,
    `  По источнику: ${fmtMap(bySource)}`,
    ``,
    `  Последняя запись: ${lastDate}`,
  ].join("\n");
}

async function toolListEntries(
  args: {
    source?: string;
    entry_type?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    has_file?: boolean;
    has_no_countries?: boolean;
    requesting_user_id?: number;
  },
): Promise<string> {
  const scope = await callerScope(args.requesting_user_id);
  if (!scope) return NO_WORKSPACE_MESSAGE;

  let query = onlyLiveEntries(
    supabase
      .from("entries")
      .select("id, source, entry_type, entry_date, created_at, summary, countries, metadata"),
  )
    .or(visibilityFilter(scope.userId))
    .eq("group_id", scope.groupId)
    .order("created_at", { ascending: false })
    .limit(Math.min(args.limit ?? 20, 100));

  if (args.source) query = query.eq("source", args.source);
  if (args.entry_type) query = query.eq("entry_type", args.entry_type);
  if (args.date_from) query = query.gte("created_at", args.date_from);
  if (args.date_to) query = query.lte("created_at", args.date_to + "T23:59:59");
  if (args.has_file === true) query = query.not("metadata->>file_url", "is", null);
  if (args.has_file === false) query = query.filter("metadata->>file_url", "is", "null");
  if (args.has_no_countries === true) query = query.eq("countries", "{}");

  const { data, error } = await query;
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Записей не найдено.";

  type Row = {
    id: string;
    source: string;
    entry_type: string;
    entry_date: string | null;
    created_at: string;
    summary: string | null;
    countries: string[] | null;
    metadata: Record<string, unknown> | null;
  };
  return (data as Row[]).map((e, i) => {
    const date = e.entry_date ?? e.created_at.slice(0, 10);
    const title = (e.metadata?.title as string | undefined) ?? (e.metadata?.file_name as string | undefined) ?? "";
    const hasFile = !!(e.metadata?.file_url);
    const countries = (e.countries ?? []).filter((c) => c !== "General");
    const countriesStr = countries.length ? countries.join(", ") : "⚠️ нет стран";
    const preview = (e.summary ?? "").slice(0, 100).replace(/\n/g, " ");
    return `[${i + 1}] id:${e.id}\n  ${date} · ${e.source}/${e.entry_type}${title ? ` · ${title}` : ""}${
      hasFile ? " 📎" : ""
    }\n  🌍 ${countriesStr}\n  ${preview}`;
  }).join("\n\n");
}

async function toolDeleteEntry(args: { id: string; requesting_user_id?: number }): Promise<string> {
  const { data: entry, error: fetchErr } = await onlyLiveEntries(
    supabase
      .from("entries")
      .select("metadata, source, owner_id, is_private, group_id, shared_with"),
  )
    .eq("id", args.id)
    .maybeSingle();

  if (fetchErr) return `Ошибка: ${fetchErr.message}`;

  // Гард вместо ручной проверки (issue #60). Прежняя строка начиналась с
  // `if (args.requesting_user_id && …)`: без личности проверка ПРОПУСКАЛАСЬ целиком —
  // fail-open. Сейчас нет личности → нет права, и воркспейс проверяется тоже.
  const delScope = await callerScope(args.requesting_user_id);
  if (!delScope) return NO_WORKSPACE_MESSAGE;
  const deniedDel = entryAccessError(
    args.id,
    entry as EntryAccessRow | null,
    delScope.userId,
    delScope.groupId,
    { requireOwner: true },
  );
  if (deniedDel) return deniedDel;
  if (!entry) return `Запись ${args.id} не найдена.`; // сужение: гард уже отсёк null

  // Запись не стирается, а уходит в архив вместе с задачами встречи (#569, #687). Файл в Storage
  // остаётся: отдача файла проверяет живую запись, поэтому по прежней ссылке он недоступен.
  const archived = await archiveEntry(supabase, { id: args.id, metadata: entry.metadata }, delScope.userId);
  if (archived.error) return `Ошибка удаления: ${archived.error}`;

  return `✅ Запись удалена${archived.archivedTasks ? ` (задач встречи убрано: ${archived.archivedTasks})` : ""}.`;
}

async function toolUpdateEntry(
  args: {
    id: string;
    content?: string;
    summary?: string;
    title?: string;
    entry_date?: string;
    countries?: string[];
    file_content_base64?: string;
    file_name?: string;
    requesting_user_id?: number;
  },
): Promise<string> {
  const { data: existing, error: fetchErr } = await onlyLiveEntries(
    supabase
      .from("entries")
      .select("metadata, is_private, owner_id, group_id, shared_with"),
  )
    .eq("id", args.id)
    .maybeSingle();

  if (fetchErr) return `Ошибка: ${fetchErr.message}`;

  // Проверки не было ВООБЩЕ: правка шла по одному id, поэтому любой человек с валидным
  // MCP-токеном мог переписать содержимое чужой личной записи из другого воркспейса (issue #60).
  const scopeUpd = await callerScope(args.requesting_user_id);
  if (!scopeUpd) return NO_WORKSPACE_MESSAGE;
  const deniedUpd = entryAccessError(
    args.id,
    existing as EntryAccessRow | null,
    scopeUpd.userId,
    scopeUpd.groupId,
    { requireOwner: true },
  );
  if (deniedUpd) return deniedUpd;
  if (!existing) return `Запись ${args.id} не найдена.`; // сужение: гард уже отсёк null

  if (args.file_content_base64 && args.file_name) {
    const oldMeta = (existing.metadata as Record<string, unknown>) ?? {};
    const oldFileUrl = oldMeta.file_url as string | undefined;

    if (oldFileUrl) {
      const oldRemoval = await removeStorageObject(supabase, oldFileUrl, { kind: "entry", entryId: args.id });
      // Прежний объект остался — не заливаем новый поверх: иначе старый файл живёт в
      // хранилище без ссылки на него, невидимый и неудаляемый.
      if (oldRemoval.status === "failed") {
        return `Файл не заменён: прежний не удалось убрать из Storage (${oldRemoval.error}).`;
      }
    }

    const mimeType = mimeFromExtension(args.file_name);
    let uploadResult: { path: string; file: UploadedFile; fileSizeBytes: number };
    try {
      uploadResult = await uploadToStorage(
        args.file_content_base64,
        args.file_name,
        mimeType,
        scopeUpd.groupId,
      );
    } catch (e) {
      return `Ошибка загрузки файла: ${e instanceof Error ? e.message : String(e)}`;
    }

    const newMeta = {
      ...oldMeta,
      file_url: uploadResult.path,
      file_name: args.file_name,
      mime_type: mimeType,
      file_size_bytes: uploadResult.fileSizeBytes,
    };
    const { error: updErr } = await supabase.from("entries").update({ metadata: newMeta }).eq("id", args.id);
    if (updErr) return `Ошибка обновления метаданных файла: ${updErr.message}`;

    const regRepl = await registerStorageFile(supabase, {
      path: uploadResult.path,
      owner: { kind: "entry", entryId: args.id },
    });
    if (regRepl.error) return `Файл залит, но не зарегистрирован (${regRepl.error}) — он недоступен для показа.`;

    const sizeKb = Math.round(uploadResult.fileSizeBytes / 1024);
    return `✅ Файл заменён: ${args.file_name} (${sizeKb} KB)\n📎 ${absoluteFileUrl(uploadResult.path, WEB_BASE_URL)}`;
  }

  const updates: Record<string, unknown> = {};

  if (args.content) {
    updates.content = args.content;
    const emb = await getEmbedding(args.content.slice(0, 8000));
    updates.embedding = emb;
  }
  if (args.summary) {
    updates.summary = args.summary;
    if (!args.content) {
      const emb = await getEmbedding(args.summary.slice(0, 8000));
      updates.embedding = emb;
    }
  }
  if (args.title) {
    updates.metadata = { ...((existing.metadata as Record<string, unknown>) ?? {}), title: args.title };
  }
  if (args.entry_date) {
    updates.entry_date = args.entry_date;
  }
  if (Array.isArray(args.countries)) {
    // Единый канон рынков (issue #169): 1 рынок → тег, 0 или ≥2 → ["General"] СХЛОПЫВАНИЕМ.
    // Здесь жил свой порог — «0 или ≥3 → дописать General к списку»: два рынка проходили как
    // есть, а при трёх получалось ['RS','BG','RO','General'] и запись попадала в дайджест
    // каждой из стран (тот самый перетег, который канон 2026-08-06 и закрывал). Заодно этот
    // порог 3 расходился с остальными путями записи и с памятью команды о правиле.
    updates.countries = marketTagsFromInput(args.countries);
  }

  if (!Object.keys(updates).length) return "Нечего обновлять — передай хотя бы одно поле.";

  const { error: updErr } = await supabase.from("entries").update(updates).eq("id", args.id);
  if (updErr) return `Ошибка обновления: ${updErr.message}`;

  return `✅ Запись обновлена (${Object.keys(updates).join(", ")}).`;
}

async function toolReindexEntry(args: { id: string; summary?: string; requesting_user_id?: number }): Promise<string> {
  const { data: entry, error } = await onlyLiveEntries(
    supabase
      .from("entries")
      .select("id, content, summary, source, is_private, owner_id, group_id, shared_with"),
  )
    .eq("id", args.id)
    .maybeSingle();

  if (error) return `Ошибка: ${error.message}`;

  // Переиндексация переписывает summary, страны, тип и дату — это правка записи, а не чтение,
  // и проверки здесь тоже не было (issue #60).
  const scopeRx = await callerScope(args.requesting_user_id);
  if (!scopeRx) return NO_WORKSPACE_MESSAGE;
  const deniedRx = entryAccessError(
    args.id,
    entry as EntryAccessRow | null,
    scopeRx.userId,
    scopeRx.groupId,
    { requireOwner: true },
  );
  if (deniedRx) return deniedRx;
  if (!entry) return `Запись ${args.id} не найдена.`; // сужение: гард уже отсёк null

  const e = entry as { id: string; content: string; summary: string | null; source: string };
  const existingSummary = args.summary ?? e.summary ?? undefined;
  const hasSummary = Boolean(existingSummary?.trim());

  const reindexSchema = hasSummary
    ? '{"countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":"YYYY-MM-DD или null","keywords":"слово1,слово2"}'
    : '{"summary":"тезисы","countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":"YYYY-MM-DD или null","keywords":"слово1,слово2"}';
  const reindexSummaryRule = hasSummary
    ? ""
    : "summary — 3-5 тезисов маркированным списком на русском: конкретные факты, имена, цифры.\n";
  const system = `Сегодня ${todayIso()}.\n` +
    "Проанализируй текст и верни JSON (только JSON):\n" + reindexSchema + "\n" +
    reindexSummaryRule +
    COUNTRY_PROMPT_RULE + "\n" +
    ENTRY_TYPE_PROMPT_RULE + "\n" +
    "entry_date — дата события из текста. Год считай от сегодняшней даты, НИКОГДА не из головы.\n" +
    "keywords — 5-8 ключевых слов и синонимов для поиска.";

  let parsed: { summary?: string; countries?: string[]; entry_type?: string; entry_date?: string; keywords?: string };
  try {
    const raw = await chatComplete(system, e.content.slice(0, 5000), { temperature: 0, json: true });
    parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    return `Ошибка GPT при анализе записи ${args.id}.`;
  }

  const newSummary = hasSummary ? existingSummary! : (typeof parsed.summary === "string" ? parsed.summary : e.summary);
  const rawCountries = Array.isArray(parsed.countries)
    ? parsed.countries.filter((c): c is string => typeof c === "string")
    : [];
  // Единый санитайзер (порог 2+, схлоп в ["General"], без микса) — как в storage/read-ai/granola.
  const countries = applyGeneralSentinel(normalizeCountries(rawCountries));
  const specific = specificCountries(countries);

  const keywords = typeof parsed.keywords === "string" ? parsed.keywords : "";
  const embeddingText = [
    newSummary ?? e.content,
    specific.length > 0 ? `Страны: ${specific.join(", ")}` : "",
    keywords ? `Ключевые слова: ${keywords}` : "",
  ].filter(Boolean).join("\n").slice(0, 8000);

  const embedding = await getEmbedding(embeddingText);

  const updates: Record<string, unknown> = { countries, embedding };
  if (newSummary && newSummary !== e.summary) updates.summary = newSummary;
  if (parsed.entry_type) updates.entry_type = parsed.entry_type === "meeting" ? "meeting" : "note";
  const reindexDate = normalizeExtractedEventDate(parsed.entry_date); // чиним год от модели
  if (reindexDate) updates.entry_date = reindexDate;

  const { error: updErr } = await supabase.from("entries").update(updates).eq("id", args.id);
  if (updErr) return `Ошибка обновления: ${updErr.message}`;

  return `✅ Запись переиндексирована.\nСтраны: ${countries.join(", ") || "не определены"}\nКлючевые слова: ${
    keywords || "—"
  }`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ name: "swarm-brain", version: "1.0.0", status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { jsonrpc: string; method: string; params?: Record<string, unknown>; id: unknown };
  try {
    body = await req.json();
  } catch {
    return err(null, -32700, "Parse error");
  }

  const { method, params, id } = body;

  // ── Auth: РАЗБОР токена, но БЕЗ отказа на хендшейке ─────────────────────────
  // Token → sha256 hex → lookup in allowed_users.claude_mcp_token_hash → telegram_id.
  // ВАЖНО: протокольные методы (initialize / tools/list / notifications) отвечаем ВСЕГДА,
  // независимо от токена. Иначе устаревший/неверный Bearer в коннекторе claude.ai роняет
  // весь хендшейк (-32001 на initialize) — и коннектор молча «отваливается» целиком
  // (подтверждено репродукцией официальным MCP SDK: connect() падает на -32001).
  // Контроль доступа применяем точечно к tools/call — единственному методу, трогающему данные.
  // Режимов нет: tools/call без валидного токена — отказ всегда; личность и воркспейс — только
  // из токена (правило и его тесты — auth.ts / auth.test.ts).
  let verifiedTelegramId: number | null = null;
  let tokenError: string | null = null; // заполняется, если Bearer передан, но не прошёл
  const authHeader = req.headers.get("Authorization") ?? "";

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(token));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: tokenRow } = await supabase
      .from("allowed_users")
      .select("telegram_id, claude_mcp_token_expires_at")
      .eq("claude_mcp_token_hash", hashHex)
      .maybeSingle();

    if (tokenRow) {
      const row = tokenRow as { telegram_id: number; claude_mcp_token_expires_at: string | null };
      if (row.claude_mcp_token_expires_at && Date.parse(row.claude_mcp_token_expires_at) < Date.now()) {
        tokenError = "Token expired — run /mytoken in the bot to get a fresh one";
      } else {
        verifiedTelegramId = row.telegram_id;
      }
    } else {
      tokenError = "Invalid token — run /mytoken in the bot to get a fresh one";
    }
  }

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "swarm-brain", version: "1.0.0" },
      capabilities: { tools: {} },
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }

  if (method === "tools/list") {
    // Личность — из токена: схемы не должны просить агента передавать её самому (issue #502).
    return ok(id, { tools: TOOLS.map(withTokenIdentity) });
  }

  if (method === "tools/call") {
    // ── Точка контроля доступа (перенесена сюда с хендшейка) ──────────────────
    // Неверный/протухший токен → внятная ошибка, а не молчаливый отвал коннектора.
    // Нет токена или нет воркспейса → отказ (fail-closed, см. auth.ts).
    const name = (params?.name as string) ?? "";
    const auth = authorizeToolCall({
      toolName: name,
      verifiedTelegramId,
      tokenError,
      groupId: verifiedTelegramId !== null ? await getUserGroupId(verifiedTelegramId) : null,
    });
    if (!auth.ok) return err(id, auth.code, auth.message);

    // Поля личности в аргументах всегда перетираются значением из токена.
    const args = withCallerIdentity((params?.arguments ?? {}) as Record<string, unknown>, auth.telegramId);

    try {
      let result = "";

      if (Object.hasOwn(SPRINT_TOOLS, name)) {
        result = await SPRINT_TOOLS[name](args);
      } else if (Object.hasOwn(PERSONAL_TOOLS, name)) {
        result = await PERSONAL_TOOLS[name](args as Record<string, unknown> & { requesting_user_id: number });
      } else if (name === "whoami") {
        result = await toolWhoami(args as { requesting_user_id?: number });
      } else if (name === "search_knowledge") {
        result = await toolSearchKnowledge(args as { query: string; limit?: number; requesting_user_id?: number });
      } else if (name === "get_tasks") {
        result = await toolGetTasksMcp(
          args as {
            assignee?: string;
            country?: string;
            status?: string;
            period?: string;
            label?: string;
            project?: string;
            no_project?: boolean;
            requesting_user_id: number;
          },
        );
      } else if (name === "add_task") {
        result = await toolAddTask(
          args as {
            title: string;
            description?: string;
            assignee_name?: string;
            country?: string;
            due_date?: string;
            task_role?: string;
            source: string;
            context_id?: string;
            labels?: string[];
            project_name?: string;
            status?: string;
            confirmed?: boolean;
            parent_task_id?: string;
            requesting_user_id?: number;
          },
        );
      } else if (name === "update_task") {
        result = await toolUpdateTask(
          args as {
            id: string;
            title?: string;
            description?: string;
            assignee_name?: string;
            country?: string;
            due_date?: string | null;
            status?: string;
            task_role?: string;
            labels?: string[];
            project_name?: string;
            parent_task_id?: string;
            recur_freq?: string | null;
            hidden_from_hub?: boolean;
            requesting_user_id: number;
          },
        );
      } else if (name === "get_projects") {
        result = await toolGetProjects(args as { requesting_user_id: number });
      } else if (name === "list_task_labels") {
        result = await toolListTaskLabels(args as { requesting_user_id: number });
      } else if (name === "delete_task") {
        result = await toolDeleteTask(args as { id: string; requesting_user_id: number });
      } else if (name === "get_task_comments") {
        result = await toolGetTaskComments(args as { task_id: string; requesting_user_id: number });
      } else if (name === "get_task_stats") {
        result = await toolGetTaskStats(
          args as {
            period?: string;
            since?: string;
            assignee?: string;
            project?: string;
            country?: string;
            requesting_user_id: number;
          },
        );
      } else if (name === "get_task_history") {
        result = await toolGetTaskHistory(args as { task_id: string; requesting_user_id: number });
      } else if (name === "get_recent_task_changes") {
        result = await toolGetRecentTaskChanges(args as { since?: string; limit?: number; requesting_user_id: number });
      } else if (name === "get_recent_comments") {
        result = await toolGetRecentComments(args as { since?: string; limit?: number; requesting_user_id: number });
      } else if (name === "delete_task_comment") {
        result = await toolDeleteTaskComment(
          args as { task_id: string; comment_id: string; requesting_user_id: number },
        );
      } else if (name === "add_task_comment") {
        result = await toolAddTaskComment(args as { task_id: string; content: string; requesting_user_id: number });
      } else if (name === "extract_tasks_from_meeting") {
        result = await toolExtractTasksFromMeeting(
          args as { meeting_id?: string; entry_id?: string; requesting_user_id?: number },
        );
      } else if (name === "get_review_queue") {
        result = await toolGetReviewQueue(args as { requesting_user_id?: number });
      } else if (name === "get_draft_meeting") {
        result = await toolGetDraftMeeting(args as { meeting_id: string; requesting_user_id?: number });
      } else if (name === "update_draft_meeting") {
        result = await toolUpdateDraftMeeting(
          args as { meeting_id: string; notes?: string; title?: string; requesting_user_id?: number },
        );
      } else if (name === "publish_draft_meeting") {
        result = await toolPublishDraftMeeting(
          args as { meeting_id: string; base?: string; countries?: string[]; requesting_user_id?: number },
        );
      } else if (name === "get_meetings") {
        result = await toolGetMeetings(args as { limit?: number; requesting_user_id?: number });
      } else if (name === "get_users") {
        result = await toolGetUsers(args as { market?: string; requesting_user_id?: number });
      } else if (name === "get_entry") {
        result = await toolGetEntry(args as { id: string; requesting_user_id?: number });
      } else if (name === "add_knowledge") {
        result = await toolAddKnowledge(
          args as {
            content?: string;
            summary: string;
            source?: string;
            is_private?: boolean;
            owner_telegram_id?: number;
            requesting_user_id?: number;
          },
        );
      } else if (name === "list_entries") {
        result = await toolListEntries(
          args as {
            source?: string;
            entry_type?: string;
            date_from?: string;
            date_to?: string;
            limit?: number;
            has_file?: boolean;
            has_no_countries?: boolean;
            requesting_user_id?: number;
          },
        );
      } else if (name === "delete_entry") {
        result = await toolDeleteEntry(args as { id: string; requesting_user_id?: number });
      } else if (name === "update_entry") {
        result = await toolUpdateEntry(
          args as {
            id: string;
            content?: string;
            summary?: string;
            title?: string;
            entry_date?: string;
            countries?: string[];
            file_content_base64?: string;
            file_name?: string;
            requesting_user_id?: number;
          },
        );
      } else if (name === "reindex_entry") {
        result = await toolReindexEntry(args as { id: string; summary?: string; requesting_user_id?: number });
      } else if (name === "upload_file") {
        result = await toolUploadFile(
          args as {
            file_name: string;
            file_content_base64: string;
            mime_type?: string;
            summary: string;
            source?: string;
            requesting_user_id?: number;
          },
        );
      } else if (name === "get_storage_stats") {
        result = await toolGetStorageStats(args as { requesting_user_id?: number });
      } else if (name === "get_feedback") {
        result = await toolGetFeedback(
          args as { status?: string; category?: string; limit?: number; requesting_user_id?: number },
        );
      } else if (name === "resolve_feedback") {
        result = await toolResolveFeedback(
          args as { id: string; status?: string; task_id?: string; requesting_user_id?: number },
        );
      } else {
        return err(id, -32601, `Unknown tool: ${name}`);
      }

      return ok(id, textContent(result));
    } catch (e) {
      return err(id, -32603, e instanceof Error ? e.message : String(e));
    }
  }

  return err(id, -32601, `Method not found: ${method}`);
});
