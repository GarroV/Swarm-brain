import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    description: "Получить задачи команды с фильтрами по исполнителю, стране/тегу или статусу.",
    inputSchema: {
      type: "object",
      properties: {
        assignee: { type: "string", description: "Имя исполнителя" },
        tag: { type: "string", description: "Страна, рынок или тема" },
        status: { type: "string", enum: ["open", "in_progress", "done", "cancelled"] },
        period: { type: "string", enum: ["week"], description: "Период: week — задачи на этой неделе" },
      },
    },
  },
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
    name: "add_knowledge",
    description: "Добавить текст или заметку в командную базу знаний.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Текст для добавления" },
        source: { type: "string", description: "Источник (необязательно)" },
      },
      required: ["content"],
    },
  },
];

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolSearchKnowledge(args: { query: string; limit?: number }): Promise<string> {
  const embedding = await getEmbedding(args.query);
  const { data, error } = await supabase.rpc("match_entries", {
    query_embedding: embedding,
    match_threshold: 0.35,
    match_count: Math.min(args.limit ?? 5, 20),
  });
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Ничего не найдено по запросу.";

  return data.map((e: { content: string; source: string; created_at: string }, i: number) => {
    const date = new Date(e.created_at).toLocaleDateString("ru-RU");
    return `[${i + 1}] (${e.source} · ${date})\n${e.content.slice(0, 800)}`;
  }).join("\n\n---\n\n");
}

async function toolGetTasks(args: { assignee?: string; tag?: string; status?: string; period?: string }): Promise<string> {
  let query = supabase.from("tasks").select("*").order("due_date", { ascending: true });

  if (args.status) {
    query = query.eq("status", args.status);
  } else {
    query = query.not("status", "in", '("done","cancelled")');
  }
  if (args.assignee) query = query.ilike("assignees", `%${args.assignee}%`);
  if (args.tag) query = query.ilike("tags", `%${args.tag}%`);
  if (args.period === "week") {
    const today = new Date().toISOString().split("T")[0];
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    query = query.gte("due_date", today).lte("due_date", end);
  }

  const { data, error } = await query.limit(30);
  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "Задач не найдено.";

  return data.map((t: { title: string; assignees: string[]; due_date: string | null; tags: string[]; status: string }) => {
    const who = t.assignees?.join(", ") || "—";
    const due = t.due_date ? ` | дедлайн: ${t.due_date}` : "";
    const tags = t.tags?.length ? ` | ${t.tags.join(", ")}` : "";
    return `• [${t.status}] ${t.title}\n  Исполнитель: ${who}${due}${tags}`;
  }).join("\n\n");
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
    const markets = (p?.markets as string[] | undefined)?.length ? `\n  Рынки: ${(p.markets as string[]).join(", ")}` : "";
    const phone = p?.phone ? `\n  Тел: ${p.phone}` : "";
    const email = p?.email ? `\n  Email: ${p.email}` : "";
    return `• ${name}${role}${markets}${phone}${email}`;
  }).join("\n\n");
}

async function toolAddKnowledge(args: { content: string; source?: string }): Promise<string> {
  const embedding = await getEmbedding(args.content);
  const { error } = await supabase.from("entries").insert({
    content: args.content,
    embedding,
    added_by: "claude_desktop",
    source: args.source ?? "claude",
    metadata: {},
  });
  if (error) return `Ошибка: ${error.message}`;
  return "Добавлено в базу знаний.";
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
        result = await toolGetTasks(args as { assignee?: string; tag?: string; status?: string; period?: string });
      } else if (name === "get_meetings") {
        result = await toolGetMeetings(args as { limit?: number });
      } else if (name === "get_users") {
        result = await toolGetUsers(args as { market?: string });
      } else if (name === "add_knowledge") {
        result = await toolAddKnowledge(args as { content: string; source?: string });
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
