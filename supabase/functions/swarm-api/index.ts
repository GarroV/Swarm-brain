import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyInitData } from "./auth.ts";
import {
  EntryAccessError,
  buildEntriesQuery,
  getEntrySecure,
} from "./entries-guard.ts";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
} from "../_shared/tasks/db.ts";
import type { TaskInput } from "../_shared/tasks/types.ts";
import { normalizeCountries, COUNTRY_NAMES } from "../_shared/countries.ts";
import { handleAdminRoutes } from "./admin.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const MINIAPP_ORIGIN = Deno.env.get("MINIAPP_ORIGIN") ?? "*";
const MAX_AGE = parseInt(Deno.env.get("INITDATA_MAX_AGE") ?? "86400", 10);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(origin: string): Record<string, string> {
  const allowOrigin =
    MINIAPP_ORIGIN === "*" ? "*"
    : origin === MINIAPP_ORIGIN ? origin
    : MINIAPP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200, origin = ""): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function apiErr(status: number, message: string, origin = ""): Response {
  return json({ error: message }, status, origin);
}

// Wrap any async handler that calls getEntrySecure / buildEntriesQuery.
// Converts EntryAccessError into the correct 404/403 response automatically.
async function withEntries(
  origin: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EntryAccessError) return apiErr(e.status, e.message, origin);
    throw e;
  }
}

// Resolve telegram_id → { telegram_id, name } via user_profiles
async function resolveAssignee(
  telegramId: number,
): Promise<{ telegram_id: number; name: string } | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return null;
  const p = data as {
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  const name =
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    p.username ||
    String(p.telegram_id);
  return { telegram_id: p.telegram_id, name };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── Auth: Authorization: tma <initData> ──────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("tma ")) {
    return apiErr(401, "Unauthorized", origin);
  }
  const initData = authHeader.slice(4).trim();

  const verified = await verifyInitData(initData, BOT_TOKEN, MAX_AGE);
  if (!verified) {
    return apiErr(401, "Unauthorized", origin);
  }
  const { telegram_id, language_code } = verified;

  // ── Resolve workspace ────────────────────────────────────────────────────
  const { data: userRow } = await supabase
    .from("allowed_users")
    .select("group_id")
    .eq("telegram_id", telegram_id)
    .maybeSingle();

  if (!userRow) {
    return apiErr(401, "User not in allowed list", origin);
  }
  const groupId = (userRow as { group_id: string | null }).group_id;
  if (!groupId) {
    return apiErr(403, "No workspace assigned", origin);
  }

  // ── Routing ──────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  // Strip /functions/v1/swarm-api prefix to get the route path
  const routePath = url.pathname.split("/swarm-api").pop() || "/";

  // Admin routes (gated to telegram_id === 744230399)
  const adminResp = await handleAdminRoutes(supabase, req, routePath, telegram_id, origin);
  if (adminResp) return adminResp;

  // GET /me
  if (req.method === "GET" && routePath === "/me") {
    const [{ data: profile }, { data: allowedUser }] = await Promise.all([
      supabase.from("user_profiles").select("first_name, last_name, role, markets").eq("telegram_id", telegram_id).maybeSingle(),
      supabase.from("allowed_users").select("username").eq("telegram_id", telegram_id).maybeSingle(),
    ]);
    const p = profile as { first_name?: string; last_name?: string; role?: string; markets?: string[] } | null;
    const username = (allowedUser as { username?: string } | null)?.username ?? null;
    const name = (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : null) || username || String(telegram_id);
    const isAdmin = telegram_id === 744230399;
    return json({ telegram_id, name, username, group_id: groupId, language: language_code, role: p?.role ?? null, markets: p?.markets ?? [], is_admin: isAdmin }, 200, origin);
  }

  // GET /config
  if (req.method === "GET" && routePath === "/config") {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("allowed_markets")
      .eq("id", groupId)
      .maybeSingle();
    const allowedMarkets = (ws as { allowed_markets: string[] | null } | null)?.allowed_markets;
    const markets = allowedMarkets ?? Object.keys(COUNTRY_NAMES);
    return json({ allowed_markets: markets }, 200, origin);
  }

  // GET /users
  if (req.method === "GET" && routePath === "/users") {
    const { data: users } = await supabase
      .from("allowed_users")
      .select("telegram_id, username")
      .eq("group_id", groupId);

    if (!users?.length) return json([], 200, origin);

    // filter out entries with null telegram_id (users added by username before joining bot)
    const validUsers = (users as Array<{ telegram_id: number | null; username: string | null }>).filter(u => u.telegram_id != null) as Array<{ telegram_id: number; username: string | null }>;
    if (!validUsers.length) return json([], 200, origin);

    const ids = validUsers.map(u => u.telegram_id);
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("telegram_id, first_name, last_name, role, markets")
      .in("telegram_id", ids);

    const profileMap = Object.fromEntries(
      (
        profiles as Array<{
          telegram_id: number;
          first_name?: string;
          last_name?: string;
          role?: string;
          markets?: string[];
        }> ?? []
      ).map(p => [p.telegram_id, p]),
    );

    const result = validUsers.map(u => {
      const p = profileMap[u.telegram_id];
      const fullName = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : null;
      return {
        telegram_id: u.telegram_id,
        name: fullName || u.username || String(u.telegram_id),
        username: u.username ?? null,
        role: p?.role ?? null,
        markets: p?.markets ?? [],
      };
    });

    return json(result, 200, origin);
  }

  // GET /tasks or POST /tasks
  if (routePath === "/tasks") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const country = url.searchParams.get("country") ?? undefined;
      const assigneeText = url.searchParams.get("assignee") ?? undefined;
      const mine = url.searchParams.get("mine") === "true";
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      const confirmedParam = url.searchParams.get("confirmed");
      const confirmedFilter = confirmedParam === "true" ? true : confirmedParam === "false" ? false : undefined;

      const tasks = await listTasks(
        {
          status,
          country,
          assigneeText,
          telegramId: mine ? telegram_id : undefined,
          limit,
          confirmed: confirmedFilter,
        },
        groupId,
      );
      // Batch-resolve creator names
      const creatorIds = [...new Set(
        tasks.map(t => (t as { created_by_telegram_id?: number | null }).created_by_telegram_id)
             .filter((id): id is number => id != null)
      )];
      const creatorMap = new Map<number, string>();
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("telegram_id, first_name")
          .in("telegram_id", creatorIds);
        (profiles ?? []).forEach((p: { telegram_id: number; first_name: string | null }) => {
          if (p.first_name) creatorMap.set(p.telegram_id, p.first_name);
        });
      }
      const tasksWithCreator = tasks.map(t => {
        const createdById = (t as { created_by_telegram_id?: number | null }).created_by_telegram_id ?? null;
        return { ...t, created_by_name: createdById != null ? (creatorMap.get(createdById) ?? null) : null };
      });

      return json(tasksWithCreator, 200, origin);
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return apiErr(400, "Invalid JSON", origin);
      }
      if (!body.title || typeof body.title !== "string") {
        return apiErr(400, "title is required", origin);
      }

      let assignees: string[] = [];
      let assignee_telegram_ids: number[] = [];
      if (typeof body.assignee_telegram_id === "number") {
        const resolved = await resolveAssignee(body.assignee_telegram_id);
        if (resolved) {
          assignees = [resolved.name];
          assignee_telegram_ids = [resolved.telegram_id];
        }
      }

      const input: TaskInput = {
        title: body.title as string,
        description: (body.description as string | null) ?? null,
        country: (body.country as string | null) ?? null,
        task_role: (body.task_role as string | null) ?? null,
        due_date: (body.due_date as string | null) ?? null,
        status: (body.status as string) ?? "open",
        source: "mini_app",
        assignees,
        assignee_telegram_ids,
        confirmed: true,
        created_by_telegram_id: telegram_id ?? null,
      };

      try {
        const task = await createTask(input, groupId);
        return json(task, 201, origin);
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }
  }

  // GET /tasks/:id, PATCH /tasks/:id, DELETE /tasks/:id
  const taskMatch = routePath.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const taskId = taskMatch[1];

    if (req.method === "GET") {
      const task = await getTask(taskId);
      if (!task || task.group_id !== groupId) return apiErr(404, "Not found", origin);
      return json(task, 200, origin);
    }

    if (req.method === "PATCH") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return apiErr(400, "Invalid JSON", origin);
      }

      const task = await getTask(taskId);
      if (!task || task.group_id !== groupId) return apiErr(404, "Not found", origin);

      const fields: Partial<TaskInput> & { status?: string; due_date?: string | null } = {};
      if (body.title !== undefined) fields.title = body.title as string;
      if (body.description !== undefined) fields.description = body.description as string | null;
      if (body.country !== undefined) fields.country = body.country as string | null;
      if (body.task_role !== undefined) fields.task_role = body.task_role as string | null;
      if ("due_date" in body) fields.due_date = body.due_date as string | null;
      if (body.status !== undefined) fields.status = body.status as string;

      if ("assignee_telegram_id" in body) {
        if (!body.assignee_telegram_id) {
          fields.assignees = [];
          fields.assignee_telegram_ids = [];
        } else if (typeof body.assignee_telegram_id === "number") {
          const resolved = await resolveAssignee(body.assignee_telegram_id);
          if (resolved) {
            fields.assignees = [resolved.name];
            fields.assignee_telegram_ids = [resolved.telegram_id];
          }
        }
      }

      try {
        await updateTask(taskId, fields);
        const updated = await getTask(taskId);
        return json(updated, 200, origin);
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }

    if (req.method === "DELETE") {
      const task = await getTask(taskId);
      if (!task || task.group_id !== groupId) return apiErr(404, "Not found", origin);
      try {
        await deleteTask(taskId);
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }
  }

  // ── PATCH /me ────────────────────────────────────────────────────────────────
  if (req.method === "PATCH" && routePath === "/me") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    const fields: Record<string, unknown> = {};
    if ("role" in body) fields.role = body.role ?? null;
    if ("markets" in body && Array.isArray(body.markets)) fields.markets = normalizeCountries(body.markets as string[]);
    await supabase.from("user_profiles").update(fields).eq("telegram_id", telegram_id);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── GET /entries ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && routePath === "/entries") {
    const source = url.searchParams.get("source") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;
    const dateFrom = url.searchParams.get("date_from") ?? undefined;
    const dateTo = url.searchParams.get("date_to") ?? undefined;

    let q = buildEntriesQuery(supabase, "id,content,summary,source,entry_type,entry_date,countries,is_private,owner_id,created_at", { groupId, telegramId: telegram_id })
      .not("source", "in", '("read_ai","granola","digest")')
      .order("created_at", { ascending: false })
      .limit(50);
    if (source) q = q.eq("source", source);
    if (type) q = q.eq("entry_type", type);
    if (dateFrom) q = q.gte("entry_date", dateFrom);
    if (dateTo) q = q.lte("entry_date", dateTo);
    const { data, error } = await q;
    if (error) return apiErr(500, error.message, origin);
    return json(data, 200, origin);
  }

  // ── GET /entries/:id ──────────────────────────────────────────────────────────
  const entryMatch = routePath.match(/^\/entries\/([^/]+)$/);
  if (entryMatch && !routePath.includes("/upload")) {
    const entryId = entryMatch[1];
    return withEntries(origin, async () => {
      if (req.method === "GET") {
        const entry = await getEntrySecure(supabase, entryId, { groupId, telegramId: telegram_id });
        return json(entry, 200, origin);
      }
      if (req.method === "PATCH") {
        const entry = await getEntrySecure(supabase, entryId, { groupId, telegramId: telegram_id, requireOwner: true });
        let body: Record<string, unknown>;
        try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
        const fields: Record<string, unknown> = {};
        if ("content" in body) fields.content = body.content;
        if ("summary" in body) fields.summary = body.summary;
        await supabase.from("entries").update(fields).eq("id", entry.id);
        const { data } = await supabase.from("entries").select("*").eq("id", entry.id).single();
        return json(data, 200, origin);
      }
      if (req.method === "DELETE") {
        const entry = await getEntrySecure(supabase, entryId, { groupId, telegramId: telegram_id, requireOwner: true });
        const fileUrl = (entry.metadata as Record<string, unknown>)?.file_url as string | undefined;
        if (fileUrl) {
          const path = fileUrl.split("/swarm_drive/")[1];
          if (path) await supabase.storage.from("swarm_drive").remove([path]);
        }
        await supabase.from("entries").delete().eq("id", entry.id);
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      return apiErr(405, "Method not allowed", origin);
    });
  }

  // ── POST /entries/upload ──────────────────────────────────────────────────────
  if (req.method === "POST" && routePath === "/entries/upload") {
    let form: FormData;
    try { form = await req.formData(); } catch { return apiErr(400, "Invalid form data", origin); }
    const file = form.get("file") as File | null;
    if (!file) return apiErr(400, "file required", origin);
    const isPrivate = form.get("is_private") === "true";

    const arrayBuffer = await file.arrayBuffer();
    const date = new Date().toISOString().slice(0, 10);
    const safeName = file.name.replace(/[^a-zA-Zа-яёА-ЯЁ0-9.\-_]/g, "_");
    const path = `uploads/${date}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("swarm_drive")
      .upload(path, arrayBuffer, { contentType: file.type || "application/octet-stream", upsert: true });
    if (uploadError) return apiErr(500, uploadError.message, origin);

    const { data: { publicUrl } } = supabase.storage.from("swarm_drive").getPublicUrl(path);

    const { data: profile } = await supabase.from("user_profiles")
      .select("first_name, username").eq("telegram_id", telegram_id).maybeSingle();
    const addedBy = (profile as { first_name?: string; username?: string } | null)?.first_name || String(telegram_id);

    const { data: entry, error: insertError } = await supabase.from("entries").insert({
      content: `Файл: ${file.name}`,
      summary: null,
      embedding: null,
      added_by: addedBy,
      source: "file",
      metadata: { filename: file.name, file_url: publicUrl, file_type: file.type },
      countries: [],
      entry_type: "document",
      entry_date: null,
      group_id: groupId,
      is_private: isPrivate,
      owner_id: telegram_id,
    }).select().single();
    if (insertError) return apiErr(500, insertError.message, origin);
    return json(entry, 201, origin);
  }

  // ── POST /entries ─────────────────────────────────────────────────────────────
  if (req.method === "POST" && routePath === "/entries") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    if (!body.content || typeof body.content !== "string") return apiErr(400, "content required", origin);
    const isPrivate = body.is_private === true;

    const { data: profile } = await supabase.from("user_profiles")
      .select("first_name, username").eq("telegram_id", telegram_id).maybeSingle();
    const addedBy = (profile as { first_name?: string; username?: string } | null)?.first_name || String(telegram_id);

    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;

    const [embeddingRes, metaRes] = await Promise.all([
      fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: body.content.slice(0, 8000) }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: 'Проанализируй текст и верни JSON (только JSON, без markdown): {"countries":[],"entry_type":"note","entry_date":null}' },
            { role: "user", content: body.content.slice(0, 4000) },
          ],
          max_tokens: 200,
        }),
      }),
    ]);

    const embedding = embeddingRes.ok ? (await embeddingRes.json()).data[0].embedding : null;
    let meta: { countries: string[]; entry_type: string; entry_date: string | null } = { countries: [], entry_type: "note", entry_date: null };
    if (metaRes.ok) {
      try {
        const parsed = JSON.parse((await metaRes.json()).choices[0].message.content);
        meta = { ...parsed, countries: normalizeCountries(parsed.countries ?? []) };
      } catch { /* use defaults */ }
    }

    const summaryRes = body.content.length >= 80 ? await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Сделай краткие тезисы из текста. Только конкретные факты: имена, цифры, решения, даты. 3–7 пунктов. Маркированный список на русском." },
          { role: "user", content: body.content.slice(0, 6000) },
        ],
        max_tokens: 500,
      }),
    }) : null;
    const summary = summaryRes?.ok ? (await summaryRes.json()).choices[0].message.content : null;

    const { data: entry, error } = await supabase.from("entries").insert({
      content: body.content, summary, embedding, added_by: addedBy, source: "note",
      metadata: {}, countries: meta.countries, entry_type: meta.entry_type, entry_date: meta.entry_date,
      group_id: groupId, is_private: isPrivate, owner_id: telegram_id,
    }).select().single();
    if (error) return apiErr(500, error.message, origin);
    return json(entry, 201, origin);
  }

  // ── GET /search ───────────────────────────────────────────────────────────────
  if (req.method === "GET" && routePath === "/search") {
    const q = url.searchParams.get("q");
    if (!q?.trim()) return apiErr(400, "q required", origin);
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: q.slice(0, 8000) }),
    });
    if (!embRes.ok) return apiErr(500, "Embedding failed", origin);
    const embedding = (await embRes.json()).data[0].embedding;
    const { data, error } = await supabase.rpc("match_entries", {
      query_embedding: embedding,
      match_threshold: 0.35,
      match_count: 20,
      requesting_user_id: telegram_id,
    });
    if (error) return apiErr(500, error.message, origin);
    const filtered = (data ?? []).filter((e: { group_id: string }) => e.group_id === groupId);
    return json(filtered, 200, origin);
  }

  // ── GET /meetings ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && routePath === "/meetings") {
    const confirmedParam = url.searchParams.get("confirmed");
    let q = buildEntriesQuery(supabase, "*", { groupId, telegramId: telegram_id })
      .in("source", ["read_ai", "granola"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (confirmedParam === "true") q = q.eq("metadata->>confirmed", "true");
    if (confirmedParam === "false") q = q.or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false");
    const { data, error } = await q;
    if (error) return apiErr(500, error.message, origin);
    return json(data, 200, origin);
  }

  // ── GET/PATCH/DELETE /meetings/:id ────────────────────────────────────────────
  const meetingMatch = routePath.match(/^\/meetings\/([^/]+)$/);
  if (meetingMatch) {
    const meetingId = meetingMatch[1];
    return withEntries(origin, async () => {
      if (req.method === "GET") {
        const entry = await getEntrySecure(supabase, meetingId, { groupId, telegramId: telegram_id });
        return json(entry, 200, origin);
      }
      if (req.method === "PATCH") {
        const entry = await getEntrySecure(supabase, meetingId, { groupId, telegramId: telegram_id });
        let body: Record<string, unknown>;
        try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
        const fields: Record<string, unknown> = {};
        if ("confirmed" in body) {
          fields.metadata = { ...(entry.metadata as Record<string, unknown>), confirmed: body.confirmed };
        }
        if ("summary" in body) fields.summary = body.summary;
        if ("countries" in body && Array.isArray(body.countries)) fields.countries = normalizeCountries(body.countries as string[]);
        await supabase.from("entries").update(fields).eq("id", entry.id);
        const { data } = await supabase.from("entries").select("*").eq("id", entry.id).single();
        return json(data, 200, origin);
      }
      if (req.method === "DELETE") {
        await getEntrySecure(supabase, meetingId, { groupId, telegramId: telegram_id });
        await supabase.from("entries").delete().eq("id", meetingId);
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      return apiErr(405, "Method not allowed", origin);
    });
  }

  // ── GET /integrations ─────────────────────────────────────────────────────────
  if (req.method === "GET" && routePath === "/integrations") {
    const { data } = await supabase.from("user_integrations")
      .select("service, last_polled_at, skipped_note_ids")
      .eq("telegram_id", telegram_id);
    return json(data ?? [], 200, origin);
  }

  // ── POST /integrations/granola ────────────────────────────────────────────────
  if (req.method === "POST" && routePath === "/integrations/granola") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    if (!body.api_key || typeof body.api_key !== "string") return apiErr(400, "api_key required", origin);
    const validRes = await fetch("https://public-api.granola.ai/v1/notes?limit=1", {
      headers: { Authorization: `Bearer ${body.api_key}` },
    });
    if (!validRes.ok) return apiErr(400, "Invalid Granola API key", origin);
    await supabase.from("user_integrations").upsert(
      { telegram_id, service: "granola", api_key: body.api_key, skipped_note_ids: [] },
      { onConflict: "telegram_id,service" },
    );
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── DELETE /integrations/granola ──────────────────────────────────────────────
  if (req.method === "DELETE" && routePath === "/integrations/granola") {
    await supabase.from("user_integrations").delete().eq("telegram_id", telegram_id).eq("service", "granola");
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── GET /granola/notes ────────────────────────────────────────────────────────
  if (req.method === "GET" && routePath === "/granola/notes") {
    const { data: integration } = await supabase.from("user_integrations")
      .select("api_key, skipped_note_ids").eq("telegram_id", telegram_id).eq("service", "granola").maybeSingle();
    if (!integration) return apiErr(404, "Granola not connected", origin);

    const period = url.searchParams.get("period") ?? "7d";
    const daysMap: Record<string, number> = { today: 1, "7d": 7, "30d": 30 };
    const days = daysMap[period] ?? 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const granolaRes = await fetch(
      `https://public-api.granola.ai/v1/notes?created_after=${encodeURIComponent(since)}&limit=50`,
      { headers: { Authorization: `Bearer ${(integration as { api_key: string }).api_key}` } },
    );
    if (!granolaRes.ok) return apiErr(502, "Granola API error", origin);
    const { notes } = await granolaRes.json() as { notes: Array<{ id: string }> };

    const skipped: string[] = (integration as { skipped_note_ids: string[] }).skipped_note_ids ?? [];
    const { data: imported } = await supabase.from("entries")
      .select("metadata").eq("group_id", groupId).eq("added_by", String(telegram_id));
    const importedIds = new Set(
      (imported ?? []).map((e: { metadata: Record<string, unknown> }) => e.metadata?.granola_note_id as string).filter(Boolean),
    );

    const unprocessed = (notes ?? []).filter((n) => !skipped.includes(n.id) && !importedIds.has(n.id));
    return json(unprocessed, 200, origin);
  }

  // ── GET /granola/notes/:id/preview ────────────────────────────────────────────
  const granolaPreviewMatch = routePath.match(/^\/granola\/notes\/([^/]+)\/preview$/);
  if (granolaPreviewMatch && req.method === "GET") {
    const noteId = granolaPreviewMatch[1];
    const { data: integration } = await supabase.from("user_integrations")
      .select("api_key").eq("telegram_id", telegram_id).eq("service", "granola").maybeSingle();
    if (!integration) return apiErr(404, "Granola not connected", origin);

    const noteRes = await fetch(`https://public-api.granola.ai/v1/notes/${noteId}?include=transcript`, {
      headers: { Authorization: `Bearer ${(integration as { api_key: string }).api_key}` },
    });
    if (!noteRes.ok) return apiErr(404, "Note not found", origin);
    const note = await noteRes.json() as Record<string, unknown>;

    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    const content = [note.title, note.content ?? note.transcript ?? ""].filter(Boolean).join("\n\n");
    const summaryRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Сделай краткие тезисы встречи. Только конкретные факты: участники, решения, действия. 3–7 пунктов на русском." },
          { role: "user", content: String(content).slice(0, 6000) },
        ],
        max_tokens: 500,
      }),
    });
    if (!summaryRes.ok) return apiErr(500, "GPT error", origin);
    const summary = (await summaryRes.json()).choices[0].message.content;
    return json({ summary }, 200, origin);
  }

  // ── POST /granola/notes/:id/import ────────────────────────────────────────────
  const granolaImportMatch = routePath.match(/^\/granola\/notes\/([^/]+)\/import$/);
  if (granolaImportMatch && req.method === "POST") {
    const noteId = granolaImportMatch[1];
    const { data: integration } = await supabase.from("user_integrations")
      .select("api_key").eq("telegram_id", telegram_id).eq("service", "granola").maybeSingle();
    if (!integration) return apiErr(404, "Granola not connected", origin);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { body = {}; }
    const isPrivate = body.visibility === "private";

    const noteRes = await fetch(`https://public-api.granola.ai/v1/notes/${noteId}?include=transcript`, {
      headers: { Authorization: `Bearer ${(integration as { api_key: string }).api_key}` },
    });
    if (!noteRes.ok) return apiErr(404, "Note not found", origin);
    const note = await noteRes.json() as Record<string, unknown>;

    const { data: profile } = await supabase.from("user_profiles")
      .select("first_name, username").eq("telegram_id", telegram_id).maybeSingle();
    const addedBy = (profile as { first_name?: string } | null)?.first_name || String(telegram_id);

    const calEvent = note.calendar_event as Record<string, unknown> | undefined;
    const ts = calEvent?.scheduled_start_time as string | undefined ?? note.created_at as string;
    const date = ts ? new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const attendees = (note.attendees as Array<{ name?: string; email?: string }> | undefined) ?? [];
    const attendeeNames = attendees.map((a) => a.name || a.email || "").filter(Boolean).join(", ");

    const content = [
      `Встреча: ${note.title ?? ""}`,
      date ? `Дата: ${date}` : "",
      attendeeNames ? `Участники: ${attendeeNames}` : "",
      "",
      String(note.content ?? note.transcript ?? ""),
    ].filter((l) => l !== null && l !== undefined && !(l === "" && !date)).join("\n").trim();

    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    const [embRes, summaryRes] = await Promise.all([
      fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: content.slice(0, 8000) }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Сделай краткие тезисы встречи. 3–7 пунктов на русском." },
            { role: "user", content: content.slice(0, 6000) },
          ],
          max_tokens: 500,
        }),
      }),
    ]);
    const embedding = embRes.ok ? (await embRes.json()).data[0].embedding : null;
    const summary = summaryRes.ok ? (await summaryRes.json()).choices[0].message.content : null;

    await supabase.from("entries").insert({
      content, summary, embedding, added_by: addedBy, source: "granola",
      metadata: { granola_note_id: noteId, title: note.title, confirmed: true },
      countries: [], entry_type: "meeting",
      entry_date: ts ? ts.slice(0, 10) : null,
      group_id: groupId, is_private: isPrivate, owner_id: telegram_id,
    });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── POST /granola/notes/:id/skip ──────────────────────────────────────────────
  const granolaSkipMatch = routePath.match(/^\/granola\/notes\/([^/]+)\/skip$/);
  if (granolaSkipMatch && req.method === "POST") {
    const noteId = granolaSkipMatch[1];
    const { data: integration } = await supabase.from("user_integrations")
      .select("skipped_note_ids").eq("telegram_id", telegram_id).eq("service", "granola").maybeSingle();
    if (!integration) return apiErr(404, "Granola not connected", origin);
    const current: string[] = (integration as { skipped_note_ids: string[] }).skipped_note_ids ?? [];
    if (!current.includes(noteId)) {
      await supabase.from("user_integrations")
        .update({ skipped_note_ids: [...current, noteId] })
        .eq("telegram_id", telegram_id).eq("service", "granola");
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── POST /feedback ────────────────────────────────────────────────────────────
  if (req.method === "POST" && routePath === "/feedback") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    if (!body.text || typeof body.text !== "string") return apiErr(400, "text required", origin);

    const { data: profile } = await supabase.from("user_profiles")
      .select("first_name, username").eq("telegram_id", telegram_id).maybeSingle();
    const p = profile as { first_name?: string; username?: string } | null;
    const username = p?.username ?? String(telegram_id);

    const { data: feedbackRow } = await supabase.from("feedback")
      .insert({ telegram_id, username, text: body.text as string })
      .select("id").single();

    const { data: channelRow } = await supabase.from("app_settings")
      .select("value").eq("key", "feedback_channel_id").maybeSingle();
    const channelId = (channelRow as { value?: string } | null)?.value;
    if (channelId && feedbackRow) {
      const date = new Date().toLocaleDateString("ru-RU");
      const text = `<b>[Mini App]</b> 🐛 @${username} · ${date}\n\n${body.text}`;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: channelId, text, parse_mode: "HTML" }),
      });
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── POST /digest ──────────────────────────────────────────────────────────────
  if (req.method === "POST" && routePath === "/digest") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { body = {}; }
    const daysBack = typeof body.days === "number" ? body.days : 7;
    const since = new Date(Date.now() - daysBack * 86400000).toISOString();

    const { data: profile } = await supabase.from("user_profiles")
      .select("first_name, last_name, role, markets").eq("telegram_id", telegram_id).maybeSingle();
    const p = profile as { first_name?: string; last_name?: string; role?: string; markets?: string[] } | null;
    const userName = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "";
    const markets: string[] = p?.markets ?? [];
    const role: string = p?.role ?? "";

    const { data: entries } = await supabase.from("entries")
      .select("summary, content, source, created_at")
      .gte("created_at", since)
      .eq("group_id", groupId)
      .not("source", "eq", "digest")
      .or(`is_private.eq.false,and(is_private.eq.true,owner_id.eq.${telegram_id})`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!entries?.length) return json({ text: "За указанный период нет записей." }, 200, origin);

    type EntryRow = { summary: string | null; content: string; source: string; created_at: string };

    const { data: allProfiles } = await supabase.from("user_profiles").select("markets");
    const allMarkets = [...new Set(
      (allProfiles ?? []).flatMap((pr: { markets?: string[] }) => pr.markets ?? [])
    )].filter((m): m is string => typeof m === "string").map((m) => m.toLowerCase());

    const userKeywords = [...markets, role, userName].filter(Boolean).map((k) => k.toLowerCase());
    const relevant = (entries as EntryRow[]).filter((e) => {
      const lower = (e.summary ?? e.content).toLowerCase();
      return userKeywords.some((k) => lower.includes(k)) || !allMarkets.some((m) => lower.includes(m));
    });

    if (!relevant.length) return json({ text: "За этот период нет релевантных для тебя записей." }, 200, origin);

    const periodStart = new Date(Date.now() - daysBack * 86400000).toLocaleDateString("ru-RU");
    const periodEnd = new Date().toLocaleDateString("ru-RU");
    const periodLabel = `${periodStart} — ${periodEnd}`;
    const entriesText = relevant.map((e) => {
      const date = new Date(e.created_at).toLocaleDateString("ru-RU");
      return `[${e.source} · ${date}] ${(e.summary ?? e.content).slice(0, 300)}`;
    }).join("\n\n---\n\n");

    const contextLine = [markets.length ? `Рынки: ${markets.join(", ")}` : "", role ? `Роль: ${role}` : "", userName ? `Имя: ${userName}` : ""].filter(Boolean).join(" | ");
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `Ты аналитик команды. Составь персональный дайджест за ${periodLabel} для сотрудника.\nПрофиль: ${contextLine}\n\nСтруктура:\n🌍 По рынкам\n✅ Что сделано\n🔥 Проблемы\n📋 На следующий период\n\nОтвечай на русском.` },
          { role: "user", content: entriesText.slice(0, 8000) },
        ],
        max_tokens: 1500,
      }),
    });
    if (!gptRes.ok) return apiErr(500, "GPT error", origin);
    const text = (await gptRes.json()).choices[0].message.content;
    return json({ text }, 200, origin);
  }

  // ── POST /tasks/extract ───────────────────────────────────────────────────────
  if (req.method === "POST" && routePath === "/tasks/extract") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    if (!body.text || typeof body.text !== "string") return apiErr(400, "text required", origin);

    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: 'Извлеки задачи из текста. Верни JSON массив (только JSON, без markdown): [{"title":"...","description":"...","assignee":"...","due_date":"YYYY-MM-DD или null","country":"... или null"}]. Если задач нет — пустой массив.' },
          { role: "user", content: body.text.slice(0, 6000) },
        ],
        max_tokens: 1000,
      }),
    });
    if (!gptRes.ok) return apiErr(500, "GPT error", origin);
    let extracted: Array<{ title: string; description?: string; assignee?: string; due_date?: string | null; country?: string | null }> = [];
    try { extracted = JSON.parse((await gptRes.json()).choices[0].message.content.replace(/```json\n?|\n?```/g, "").trim()); } catch { return json([], 200, origin); }

    const created = [];
    for (const item of extracted.slice(0, 10)) {
      if (!item.title) continue;
      const task = await createTask({ title: item.title, description: item.description ?? null, country: item.country ?? null, due_date: item.due_date ?? null, source: "mini_app", confirmed: true, created_by_telegram_id: telegram_id ?? null }, groupId);
      created.push(task);
    }
    return json(created, 201, origin);
  }

  return apiErr(404, "Not found", origin);
});
