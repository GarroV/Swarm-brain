import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { toolAddTask, toolUpdateTask, toolDeleteTask, toolGetTasks as toolGetTasksMcp, TASK_TOOL_DEFINITIONS } from "./tasks/tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function chatComplete(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 300 }),
  });
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

async function extractEntryMeta(text: string): Promise<{ countries: string[]; entry_type: string; entry_date: string | null }> {
  try {
    const raw = await chatComplete(
      "Проанализируй текст и верни JSON (только JSON):\n" +
      '{"countries":["Serbia"],"entry_type":"transcript|summary|note|document|meeting","entry_date":"YYYY-MM-DD или null"}\n' +
      "countries — страны/рынки на английском. entry_date — дата события из текста, null если нет.",
      text.slice(0, 2000)
    );
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    return {
      countries: Array.isArray(parsed.countries) ? parsed.countries : [],
      entry_type: parsed.entry_type ?? "note",
      entry_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.entry_date ?? "") ? parsed.entry_date : null,
    };
  } catch { return { countries: [], entry_type: "note", entry_date: null }; }
}

function mimeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", gif: "image/gif", webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain", md: "text/markdown", csv: "text/csv",
    mp3: "audio/mpeg", mp4: "video/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}

async function uploadToStorage(
  fileContentBase64: string,
  fileName: string,
  mimeType: string
): Promise<{ path: string; publicUrl: string; fileSizeBytes: number }> {
  const bytes = Uint8Array.from(atob(fileContentBase64), c => c.charCodeAt(0));
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `uploads/${yyyy}/${mm}/${uuid}-${safeName}`;

  const { error } = await supabase.storage
    .from("swarm_drive")
    .upload(path, bytes, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from("swarm_drive")
    .getPublicUrl(path);

  return { path, publicUrl, fileSizeBytes: bytes.length };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_knowledge",
    description: "Семантический поиск по командной базе знаний. Ищет по смыслу — документы, заметки, встречи, ссылки.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос" },
        limit: { type: "number", description: "Количество результатов (по умолчанию 5, макс 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_tasks",
    description: "Получить задачи команды с фильтрами по исполнителю, стране или статусу.",
    inputSchema: {
      type: "object",
      properties: {
        assignee: { type: "string", description: "Имя исполнителя" },
        country: { type: "string", description: "Страна или рынок" },
        status: { type: "string", enum: ["open", "in_progress", "done", "cancelled"] },
        period: { type: "string", enum: ["week"], description: "Задачи на этой неделе" },
      },
    },
  },
  ...TASK_TOOL_DEFINITIONS,
  {
    name: "get_meetings",
    description: "Получить последние встречи из Read.ai сохранённые в базе знаний.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Количество встреч (по умолчанию 10)" },
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
      },
    },
  },
  {
    name: "get_entry",
    description: "Получить полный текст записи из базы знаний по ID. Используй когда search_knowledge вернул обрезанный текст.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из результатов search_knowledge" },
      },
      required: ["id"],
    },
  },
  {
    name: "add_knowledge",
    description: "Добавить текст в командную базу знаний. summary обязателен. content — ВСЕГДА передавай полный оригинальный текст целиком, не сокращая. Инструмент сам разобьёт на части при необходимости.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Полный оригинальный текст целиком — обязательно передавай весь, без сокращений" },
        summary: { type: "string", description: "Детальные тезисы — согласованные с пользователем ключевые пункты" },
        source: { type: "string", description: "Источник (название файла, тип контента)" },
      },
      required: ["summary"],
    },
  },
  {
    name: "list_entries",
    description: "Список записей в базе знаний с фильтрами. Используй для ревизии — посмотреть что есть, найти старые или дублирующие записи.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Фильтр по источнику: telegram, voice, pdf, document, read_ai, url, claude и др." },
        entry_type: { type: "string", description: "Тип записи: transcript, meeting, note, document, summary" },
        date_from: { type: "string", description: "Дата от в формате YYYY-MM-DD" },
        date_to: { type: "string", description: "Дата до в формате YYYY-MM-DD" },
        limit: { type: "number", description: "Количество записей (по умолчанию 20, макс 100)" },
      },
    },
  },
  {
    name: "delete_entry",
    description: "Удалить запись из базы знаний по ID. Если к записи прикреплён файл в Storage — файл тоже удаляется.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из list_entries или search_knowledge" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_entry",
    description: "Обновить содержимое записи: текст, тезисы или метаданные. Используй чтобы исправить или дополнить существующую запись.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи" },
        content: { type: "string", description: "Новый полный текст (опционально)" },
        summary: { type: "string", description: "Новые тезисы (опционально)" },
        title: { type: "string", description: "Новый заголовок в metadata (опционально)" },
        entry_date: { type: "string", description: "Новая дата события YYYY-MM-DD (опционально)" },
      },
      required: ["id"],
    },
  },
];

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolSearchKnowledge(args: { query: string; limit?: number }): Promise<string> {
  const embedding = await getEmbedding(args.query);
  const { data, error } = await supabase.rpc("match_entries", {
    query_embedding: `[${embedding.join(",")}]`,
    match_threshold: 0.35,
    match_count: Math.min(args.limit ?? 5, 20),
  });
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Ничего не найдено по запросу.";

  return data.map((e: { id: string; content: string; source: string; created_at: string }, i: number) => {
    const date = new Date(e.created_at).toLocaleDateString("ru-RU");
    const preview = e.content.length > 3000 ? e.content.slice(0, 3000) + `\n...[текст обрезан, полный текст: get_entry("${e.id}")]` : e.content;
    return `[${i + 1}] id:${e.id} (${e.source} · ${date})\n${preview}`;
  }).join("\n\n---\n\n");
}

async function toolGetMeetings(args: { limit?: number }): Promise<string> {
  const { data, error } = await supabase
    .from("entries")
    .select("content, metadata, created_at")
    .eq("source", "read_ai")
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 10);

  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Встреч пока нет.";

  return data.map((m: { metadata: Record<string, unknown>; created_at: string; content: string }, i: number) => {
    const title = (m.metadata?.title as string) ?? "Встреча";
    const date = new Date(m.created_at).toLocaleDateString("ru-RU");
    const preview = m.content.split("Стенограмма:")[0].trim().slice(0, 600);
    return `[${i + 1}] ${title} · ${date}\n${preview}`;
  }).join("\n\n---\n\n");
}

async function toolGetUsers(args: { market?: string }): Promise<string> {
  let query = supabase
    .from("allowed_users")
    .select("telegram_id, username")
    .neq("telegram_id", 744230399);

  const { data: users, error } = await query;
  if (error) return `Ошибка: ${error.message}`;
  if (!users?.length) return "Пользователей нет.";

  const ids = users.map((u: { telegram_id: number }) => u.telegram_id);
  let profileQuery = supabase.from("user_profiles").select("*").in("telegram_id", ids);
  if (args.market) profileQuery = profileQuery.ilike("markets", `%${args.market}%`);

  const { data: profiles } = await profileQuery;
  const profileMap = Object.fromEntries((profiles ?? []).map((p: { telegram_id: number }) => [p.telegram_id, p]));

  return users.map((u: { telegram_id: number; username: string | null }) => {
    const p = profileMap[u.telegram_id] as Record<string, unknown> | undefined;
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ") || `@${u.username ?? u.telegram_id}`;
    const role = p?.role ? `\n  Роль: ${p.role}` : "";
    const markets = (p?.markets as string[] | undefined)?.length ? `\n  Рынки: ${(p?.markets as string[]).join(", ")}` : "";
    const phone = p?.phone ? `\n  Тел: ${p.phone}` : "";
    const email = p?.email ? `\n  Email: ${p.email}` : "";
    return `• ${name}${role}${markets}${phone}${email}`;
  }).join("\n\n");
}

async function toolGetEntry(args: { id: string }): Promise<string> {
  const { data, error } = await supabase
    .from("entries")
    .select("content, source, created_at")
    .eq("id", args.id)
    .maybeSingle();
  if (error) return `Ошибка: ${error.message}`;
  if (!data) return "Запись не найдена.";
  const date = new Date(data.created_at).toLocaleDateString("ru-RU");
  return `(${data.source} · ${date})\n\n${data.content}`;
}

async function toolAddKnowledge(args: { content?: string; summary: string; source?: string }): Promise<string> {
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

  // Extract metadata + embed summary in parallel
  const groupId = chunks.length > 1 ? crypto.randomUUID() : null;
  const [summaryEmbedding, entryMeta] = await Promise.all([
    getEmbedding(args.summary.slice(0, 8000)),
    extractEntryMeta(args.summary),
  ]);

  // First chunk: summary + metadata + embedding
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

  // Remaining chunks: content only, same group_id
  if (chunks.length > 1) {
    const restEmbeddings = await Promise.all(chunks.slice(1).map(c => getEmbedding(c)));
    await Promise.all(chunks.slice(1).map((chunk, i) =>
      supabase.from("entries").insert({
        content: chunk,
        summary: null,
        embedding: restEmbeddings[i],
        added_by: "claude_desktop",
        source,
        metadata: { total_chunks: chunks.length, chunk: i + 2 },
        countries: entryMeta.countries,
        entry_type: entryMeta.entry_type,
        entry_date: entryMeta.entry_date,
        group_id: groupId,
      })
    ));
  }

  const contentNote = !args.content?.trim() ? " (оригинал не передан)" : "";
  return chunks.length > 1
    ? `Сохранено: ${rawContent.length} символов (${chunks.length} частей). Тезисы проиндексированы.${contentNote}`
    : `Сохранено. Тезисы проиндексированы.${contentNote}`;
}

async function toolListEntries(args: { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number }): Promise<string> {
  let query = supabase
    .from("entries")
    .select("id, source, entry_type, entry_date, created_at, summary, metadata")
    .order("created_at", { ascending: false })
    .limit(Math.min(args.limit ?? 20, 100));

  if (args.source) query = query.eq("source", args.source);
  if (args.entry_type) query = query.eq("entry_type", args.entry_type);
  if (args.date_from) query = query.gte("created_at", args.date_from);
  if (args.date_to) query = query.lte("created_at", args.date_to + "T23:59:59");

  const { data, error } = await query;
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Записей не найдено.";

  type Row = { id: string; source: string; entry_type: string; entry_date: string | null; created_at: string; summary: string | null; metadata: Record<string, unknown> | null };
  return (data as Row[]).map((e, i) => {
    const date = e.entry_date ?? e.created_at.slice(0, 10);
    const title = (e.metadata?.title as string | undefined) ?? (e.metadata?.file_name as string | undefined) ?? "";
    const hasFile = !!(e.metadata?.file_url);
    const preview = (e.summary ?? "").slice(0, 120).replace(/\n/g, " ");
    return `[${i + 1}] id:${e.id}\n  ${date} · ${e.source}/${e.entry_type}${title ? ` · ${title}` : ""}${hasFile ? " 📎" : ""}\n  ${preview}`;
  }).join("\n\n");
}

async function toolDeleteEntry(args: { id: string }): Promise<string> {
  const { data: entry, error: fetchErr } = await supabase
    .from("entries")
    .select("metadata, source")
    .eq("id", args.id)
    .maybeSingle();

  if (fetchErr) return `Ошибка: ${fetchErr.message}`;
  if (!entry) return `Запись ${args.id} не найдена.`;

  const fileUrl = (entry.metadata as Record<string, unknown> | null)?.file_url as string | undefined;
  if (fileUrl) {
    try {
      const url = new URL(fileUrl);
      const pathParts = url.pathname.split("/object/public/swarm_drive/");
      if (pathParts.length > 1) {
        await supabase.storage.from("swarm_drive").remove([decodeURIComponent(pathParts[1])]);
      }
    } catch { /* ignore storage deletion errors */ }
  }

  const { error: delErr } = await supabase.from("entries").delete().eq("id", args.id);
  if (delErr) return `Ошибка удаления: ${delErr.message}`;

  return `✅ Запись удалена${fileUrl ? " вместе с файлом из Storage" : ""}.`;
}

async function toolUpdateEntry(args: { id: string; content?: string; summary?: string; title?: string; entry_date?: string }): Promise<string> {
  const { data: existing, error: fetchErr } = await supabase
    .from("entries")
    .select("metadata")
    .eq("id", args.id)
    .maybeSingle();

  if (fetchErr) return `Ошибка: ${fetchErr.message}`;
  if (!existing) return `Запись ${args.id} не найдена.`;

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

  if (!Object.keys(updates).length) return "Нечего обновлять — передай хотя бы одно поле.";

  const { error: updErr } = await supabase.from("entries").update(updates).eq("id", args.id);
  if (updErr) return `Ошибка обновления: ${updErr.message}`;

  return `✅ Запись обновлена (${Object.keys(updates).join(", ")}).`;
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
    return ok(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = (params?.name as string) ?? "";
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    try {
      let result = "";

      if (name === "search_knowledge") {
        result = await toolSearchKnowledge(args as { query: string; limit?: number });
      } else if (name === "get_tasks") {
        result = await toolGetTasksMcp(args as { assignee?: string; country?: string; status?: string; period?: string });
      } else if (name === "add_task") {
        result = await toolAddTask(args as { title: string; description?: string; assignee_name?: string; country?: string; due_date?: string; source: string; context_id?: string });
      } else if (name === "update_task") {
        result = await toolUpdateTask(args as { id: string; title?: string; description?: string; assignee_name?: string; country?: string; due_date?: string | null; status?: string });
      } else if (name === "delete_task") {
        result = await toolDeleteTask(args as { id: string });
      } else if (name === "get_meetings") {
        result = await toolGetMeetings(args as { limit?: number });
      } else if (name === "get_users") {
        result = await toolGetUsers(args as { market?: string });
      } else if (name === "get_entry") {
        result = await toolGetEntry(args as { id: string });
      } else if (name === "add_knowledge") {
        result = await toolAddKnowledge(args as { content?: string; summary: string; source?: string });
      } else if (name === "list_entries") {
        result = await toolListEntries(args as { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number });
      } else if (name === "delete_entry") {
        result = await toolDeleteEntry(args as { id: string });
      } else if (name === "update_entry") {
        result = await toolUpdateEntry(args as { id: string; content?: string; summary?: string; title?: string; entry_date?: string });
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
