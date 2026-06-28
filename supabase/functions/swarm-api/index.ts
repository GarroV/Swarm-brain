import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyInitData } from "./auth.ts";
import { verifyJWT, signJWT } from "../_shared/jwt.ts";
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
import type { TaskInput, SprintInput } from "../_shared/tasks/types.ts";
import {
  listSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  setTasksSprint,
} from "../_shared/tasks/sprints.ts";
import {
  listDependencies,
  listWorkspaceDependencies,
  createDependency,
  deleteDependency,
} from "../_shared/tasks/dependencies.ts";
import type { DependencyType } from "../_shared/tasks/types.ts";
import { normalizeCountries, COUNTRY_NAMES, COUNTRY_PROMPT_RULE, ENTRY_TYPE_PROMPT_RULE } from "../_shared/countries.ts";
import { matchEntries, type MatchedEntry } from "../_shared/search.ts";
import { handleAdminRoutes } from "./admin.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const MINIAPP_ORIGIN = Deno.env.get("MINIAPP_ORIGIN") ?? "*";
const MAX_AGE = parseInt(Deno.env.get("INITDATA_MAX_AGE") ?? "86400", 10);
const ADMIN_USER_ID = 744230399; // см. lib/supabase.ts swarm-bot — единый суперадмин
const WEB_JWT_SECRET = Deno.env.get("WEB_JWT_SECRET"); // подпись веб-сессий (Login Widget, B+)

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
// Имена пользователей по telegram_id. ВАЖНО: имя (first/last) — в user_profiles, а
// username — в allowed_users (НЕ в user_profiles). Раньше код селектил username прямо из
// user_profiles → PostgREST падал на несуществующей колонке → data=null → имена не
// резолвились (в UI «#744230399»). Берём first+last, фолбэк на @username, затем «#id».
async function resolveNames(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const [{ data: profs }, { data: aus }] = await Promise.all([
    supabase.from("user_profiles").select("telegram_id, first_name, last_name").in("telegram_id", ids),
    supabase.from("allowed_users").select("telegram_id, username").in("telegram_id", ids),
  ]);
  const uname = new Map<number, string>();
  (aus ?? []).forEach((u: { telegram_id: number; username?: string | null }) => {
    if (u.username) uname.set(u.telegram_id, u.username);
  });
  const nameFor = (id: number, first?: string | null, last?: string | null): string => {
    const full = [first, last].filter(Boolean).join(" ");
    return full || (uname.get(id) ? `@${uname.get(id)}` : "");
  };
  (profs ?? []).forEach((p: { telegram_id: number; first_name?: string | null; last_name?: string | null }) => {
    const name = nameFor(p.telegram_id, p.first_name, p.last_name);
    if (name) out.set(p.telegram_id, name);
  });
  // id, у которых нет user_profiles, но есть @username
  ids.forEach((id) => { if (!out.has(id) && uname.get(id)) out.set(id, `@${uname.get(id)}`); });
  return out;
}

// Прикрепляет к встрече(ам) человекочитаемые имена записавших: recorders[].telegram_id →
// user_profiles, одним батч-резолвом на весь список. recorder_names — уникальные имена,
// фолбэк «#id» для тех, кого нет в профилях. Источник «кто записал» — claim рекордера.
async function withRecorderNames<T extends { recorders?: unknown }>(
  rows: T[],
): Promise<Array<T & { recorder_names: string[] }>> {
  const idsOf = (r: T): number[] =>
    ((r.recorders as Array<{ telegram_id?: number }> | null) ?? [])
      .map((x) => x?.telegram_id)
      .filter((n): n is number => typeof n === "number");
  const names = await resolveNames([...new Set(rows.flatMap(idsOf))]);
  return rows.map((r) => ({
    ...r,
    recorder_names: [...new Set(idsOf(r).map((id) => names.get(id) ?? `#${id}`))],
  }));
}

// Имя импортёра встречи-записи (Granola/Read.ai): кто из команды вкинул её. Источник —
// metadata.added_by_telegram_id (кладут оба пути сохранения), фолбэк owner_id (для pending =
// импортёр). Резолв в user_profiles. importer_name=null, если не из профилей. added_by="granola"
// (источник) на фронте больше не путаем с человеком.
async function withImporterNames<T extends { owner_id?: number | null; metadata?: unknown }>(
  rows: T[],
): Promise<Array<T & { importer_name: string | null }>> {
  const idOf = (r: T): number | null => {
    const raw = (r.metadata as Record<string, unknown> | null)?.added_by_telegram_id;
    const fromMeta = typeof raw === "number" ? raw : (typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null);
    return fromMeta ?? (typeof r.owner_id === "number" ? r.owner_id : null);
  };
  const names = await resolveNames([...new Set(rows.map(idOf).filter((n): n is number => n !== null))]);
  return rows.map((r) => {
    const id = idOf(r);
    return { ...r, importer_name: id !== null ? (names.get(id) ?? null) : null };
  });
}

async function resolveAssignee(
  telegramId: number,
): Promise<{ telegram_id: number; name: string } | null> {
  const { data: au } = await supabase
    .from("allowed_users").select("telegram_id").eq("telegram_id", telegramId).maybeSingle();
  if (!au) return null; // не член воркспейса — не назначаем
  const name = (await resolveNames([telegramId])).get(telegramId) ?? String(telegramId);
  return { telegram_id: telegramId, name };
}

// Имена исполнителей денормализованы в tasks.assignees при создании задачи и со временем
// устаревают: если профиля ещё не было, туда попадал сырой telegram_id (в UI — «#744230399»).
// Перерезолвим имена из актуальных user_profiles по assignee_telegram_ids (батч на список).
// Если у профиля по-прежнему нет имени — оставляем как было (деградация, а не регресс).
async function withFreshAssignees<
  T extends { assignee_telegram_ids?: number[]; assignees?: string[] },
>(tasks: T[]): Promise<T[]> {
  const ids = [...new Set(tasks.flatMap((t) => t.assignee_telegram_ids ?? []))];
  if (ids.length === 0) return tasks;
  const nameById = await resolveNames(ids);
  return tasks.map((t) => {
    const tids = t.assignee_telegram_ids ?? [];
    if (tids.length === 0) return t;
    const fresh = tids.map((id) => nameById.get(id)).filter((n): n is string => !!n);
    return fresh.length === tids.length ? { ...t, assignees: fresh } : t;
  });
}

// ── Извлечение задач из тезисов встречи (тот же подход, что POST /tasks/extract,
//    плюс резолв исполнителей и привязка к встрече) ───────────────────────────────
type ExtractedTask = { title: string; description?: string; assignee?: string; due_date?: string | null; country?: string | null };

async function gptExtractTasks(text: string): Promise<ExtractedTask[]> {
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: 'Извлеки задачи из тезисов встречи. Верни JSON массив (только JSON, без markdown): [{"title":"короткая формулировка действия","description":"1 фраза контекста из обсуждения: зачем/какой ожидаемый результат/важная деталь. НЕ повторяй заголовок другими словами. null, если заголовок самодостаточен","assignee":"Полное имя или null","due_date":"YYYY-MM-DD или null","country":"... или null"}]. Бери только реальные поручения/действия с конкретным результатом. Если задач нет — пустой массив [].' },
        { role: "user", content: text.slice(0, 8000) },
      ],
      max_tokens: 1200,
    }),
  });
  if (!res.ok) return [];
  try {
    const raw = (await res.json()).choices[0].message.content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildNameResolver(): Promise<(raw: string | null | undefined) => { name: string; id: number } | null> {
  // username — в allowed_users (не в user_profiles), иначе селект падает и список пуст.
  const [{ data: profs }, { data: aus }] = await Promise.all([
    supabase.from("user_profiles").select("telegram_id, first_name, last_name"),
    supabase.from("allowed_users").select("telegram_id, username"),
  ]);
  const uname = new Map<number, string>();
  ((aus ?? []) as Array<{ telegram_id: number; username?: string | null }>).forEach((u) => {
    if (u.username) uname.set(u.telegram_id, u.username);
  });
  const members = ((profs ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string }>).map((p) => ({
    id: p.telegram_id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || (uname.get(p.telegram_id) ? `@${uname.get(p.telegram_id)}` : "") || String(p.telegram_id),
  }));
  return (raw) => {
    if (!raw) return null;
    const lower = raw.toLowerCase().trim();
    if (!lower) return null;
    return members.find((m) => {
      const mn = m.name.toLowerCase();
      return mn.includes(lower) || lower.includes(mn.split(" ").pop() ?? mn);
    }) ?? null;
  };
}

// Извлекает задачи из тезисов и создаёт их с привязкой к встрече. Возвращает число созданных.
async function createMeetingTasks(
  text: string,
  opts: { groupId: string; createdBy: number | null; meetingId: string; isPrivate: boolean },
): Promise<number> {
  const extracted = await gptExtractTasks(text);
  if (!extracted.length) return 0;
  const resolve = await buildNameResolver();
  let n = 0;
  for (const item of extracted.slice(0, 15)) {
    if (!item.title) continue;
    let assignees: string[] = [];
    let assignee_telegram_ids: number[] = [];
    const matched = resolve(item.assignee);
    if (matched) {
      assignees = [matched.name];
      assignee_telegram_ids = [matched.id];
    }
    await createTask({
      title: item.title,
      description: item.description ?? null,
      country: item.country ?? null,
      due_date: item.due_date ?? null,
      source: "transcript",
      confirmed: true,
      created_by_telegram_id: opts.createdBy,
      meeting_id: opts.meetingId,
      assignees,
      assignee_telegram_ids,
      is_private: opts.isPrivate,
      owner_id: opts.isPrivate ? opts.createdBy : null,
    }, opts.groupId);
    n++;
  }
  return n;
}

// Человеческий заголовок записи: metadata.title → первая непустая строка summary → срез content.
function deriveEntryTitle(e: { summary: string | null; content: string; metadata: Record<string, unknown> }): string {
  const metaTitle = typeof e.metadata?.title === "string" ? (e.metadata.title as string).trim() : "";
  if (metaTitle) return metaTitle;
  const base = (e.summary && e.summary.trim()) || e.content || "";
  const firstLine = base.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  if (!firstLine) return "Запись";
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
}

// Ключ типа для TypeTag фронта (doc/mic/note/meet/pdf) из entry_type + metadata.file_type.
function entryTagKey(entryType: string, metadata: Record<string, unknown>): string {
  const ft = typeof metadata?.file_type === "string" ? (metadata.file_type as string) : "";
  if (ft.includes("pdf")) return "pdf";
  switch (entryType) {
    case "transcript": return "mic";
    case "meeting": return "meet";
    case "note": return "note";
    case "document": return "doc";
    case "summary": return "note";
    default: return "doc";
  }
}

// ── Task privacy / validation helpers (Рой) ────────────────────────────────────

// Приватную задачу видит только владелец или админ; командную — любой в воркспейсе.
function canViewTask(
  task: { is_private: boolean; owner_id: number | null },
  viewerId: number,
  isAdmin: boolean,
): boolean {
  return !task.is_private || isAdmin || task.owner_id === viewerId;
}

// Мутировать приватную задачу может только владелец или админ.
function canMutateTask(
  task: { is_private: boolean; owner_id: number | null },
  viewerId: number,
  isAdmin: boolean,
): boolean {
  return !task.is_private || isAdmin || task.owner_id === viewerId;
}

// start_date не должен быть позже due_date. Возвращает текст ошибки или null.
function validateTaskDates(start?: string | null, due?: string | null): string | null {
  if (start && due && start > due) return "start_date не может быть позже due_date";
  return null;
}

// Проверяет, что спринт существует и принадлежит тому же воркспейсу.
async function sprintInWorkspace(sprintId: string, groupId: string): Promise<boolean> {
  const { data } = await supabase
    .from("sprints").select("id").eq("id", sprintId).eq("group_id", groupId).maybeSingle();
  return !!data;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── Auth: два способа ─────────────────────────────────────────────────────
  //   • Telegram Mini App:  Authorization: tma <initData>
  //   • Веб (Login Widget):  Authorization: Bearer <JWT>  (вариант B+, проксируется CF Pages Function)
  const authHeader = req.headers.get("Authorization") ?? "";
  let telegram_id: number;
  let language_code = "en";

  if (authHeader.startsWith("tma ")) {
    const verified = await verifyInitData(authHeader.slice(4).trim(), BOT_TOKEN, MAX_AGE);
    if (!verified) return apiErr(401, "Unauthorized", origin);
    telegram_id = verified.telegram_id;
    language_code = verified.language_code;
  } else if (authHeader.startsWith("Bearer ")) {
    if (!WEB_JWT_SECRET) return apiErr(500, "Web auth not configured", origin);
    const verified = await verifyJWT(authHeader.slice(7).trim(), WEB_JWT_SECRET);
    if (!verified) return apiErr(401, "Unauthorized", origin);
    telegram_id = verified.telegram_id;
  } else {
    return apiErr(401, "Unauthorized", origin);
  }

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
  const isAdmin = telegram_id === ADMIN_USER_ID;

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
      const sprintId = url.searchParams.get("sprint_id") ?? undefined;
      const tagsParam = url.searchParams.get("tags");
      const tags = tagsParam ? tagsParam.split(",").map(t => t.trim()).filter(Boolean) : undefined;
      const startDateFrom = url.searchParams.get("start_date_from") ?? undefined;
      const startDateTo = url.searchParams.get("start_date_to") ?? undefined;
      const dueDateFrom = url.searchParams.get("due_date_from") ?? undefined;
      const dueDateTo = url.searchParams.get("due_date_to") ?? undefined;

      const tasks = await listTasks(
        {
          status,
          country,
          assigneeText,
          telegramId: mine ? telegram_id : undefined,
          limit,
          confirmed: confirmedFilter,
          // Приватность: владелец видит свои личные задачи; админ — все
          viewerId: telegram_id,
          isAdmin,
          sprintId,
          tags,
          startDateFrom,
          startDateTo,
          dueDateFrom,
          dueDateTo,
        },
        groupId,
      );
      // Batch-resolve creator names
      const creatorIds = [...new Set(
        tasks.map(t => t.created_by_telegram_id)
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
      const tasksWithCreator = (await withFreshAssignees(tasks)).map(t => ({
        ...t,
        created_by_name: t.created_by_telegram_id != null ? (creatorMap.get(t.created_by_telegram_id) ?? null) : null,
      }));

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

      const dueDate = (body.due_date as string | null) ?? null;
      const startDate = (body.start_date as string | null) ?? null;
      const dateErr = validateTaskDates(startDate, dueDate);
      if (dateErr) return apiErr(400, dateErr, origin);

      const isPrivate = body.is_private === true;
      const sprintId = (body.sprint_id as string | null) ?? null;
      if (sprintId && !(await sprintInWorkspace(sprintId, groupId))) {
        return apiErr(400, "sprint_id не найден в этом воркспейсе", origin);
      }

      const input: TaskInput = {
        title: body.title as string,
        description: (body.description as string | null) ?? null,
        country: (body.country as string | null) ?? null,
        task_role: (body.task_role as string | null) ?? null,
        priority: ["high", "med", "low"].includes(body.priority as string) ? (body.priority as string) : null,
        due_date: dueDate,
        status: (body.status as string) ?? "open",
        source: "mini_app",
        assignees,
        assignee_telegram_ids,
        confirmed: true,
        created_by_telegram_id: telegram_id ?? null,
        // Модуль задач (Рой):
        is_private: isPrivate,
        owner_id: isPrivate ? telegram_id : null,
        start_date: startDate,
        sprint_id: sprintId,
        timeline_position: typeof body.timeline_position === "number" ? body.timeline_position : null,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
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
      // Приватная задача чужого пользователя — 404 (не раскрываем существование)
      if (!canViewTask(task, telegram_id, isAdmin)) return apiErr(404, "Not found", origin);
      const [fresh] = await withFreshAssignees([task]);
      return json(fresh, 200, origin);
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
      if (!canViewTask(task, telegram_id, isAdmin)) return apiErr(404, "Not found", origin);
      // Мутировать приватную может только владелец/админ
      if (!canMutateTask(task, telegram_id, isAdmin)) return apiErr(403, "Forbidden", origin);

      const fields: Partial<TaskInput> & { status?: string; due_date?: string | null } = {};
      if (body.title !== undefined) fields.title = body.title as string;
      if (body.description !== undefined) fields.description = body.description as string | null;
      if (body.country !== undefined) fields.country = body.country as string | null;
      if (body.task_role !== undefined) fields.task_role = body.task_role as string | null;
      if ("due_date" in body) fields.due_date = body.due_date as string | null;
      if (body.status !== undefined) fields.status = body.status as string;
      if ("start_date" in body) fields.start_date = body.start_date as string | null;
      if (typeof body.timeline_position === "number") fields.timeline_position = body.timeline_position;
      if (Array.isArray(body.tags)) fields.tags = body.tags as string[];
      if (body.priority !== undefined) fields.priority = ["high", "med", "low"].includes(body.priority as string) ? (body.priority as string) : null;

      // Смена приватности: владелец задаётся/снимается вместе с флагом
      if (typeof body.is_private === "boolean") {
        fields.is_private = body.is_private;
        fields.owner_id = body.is_private ? (task.owner_id ?? telegram_id) : null;
      }

      // Привязка к спринту (с проверкой воркспейса; null — отвязать)
      if ("sprint_id" in body) {
        const sid = body.sprint_id as string | null;
        if (sid && !(await sprintInWorkspace(sid, groupId))) {
          return apiErr(400, "sprint_id не найден в этом воркспейсе", origin);
        }
        fields.sprint_id = sid;
      }

      // Валидация дат с учётом итогового состояния (новое значение или текущее)
      const effStart = "start_date" in fields ? fields.start_date : task.start_date;
      const effDue = "due_date" in fields ? fields.due_date : task.due_date;
      const dateErr = validateTaskDates(effStart, effDue);
      if (dateErr) return apiErr(400, dateErr, origin);

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
      if (!canViewTask(task, telegram_id, isAdmin)) return apiErr(404, "Not found", origin);
      if (!canMutateTask(task, telegram_id, isAdmin)) return apiErr(403, "Forbidden", origin);
      try {
        await deleteTask(taskId);
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }
  }

  // ── Task dependencies (Рой) ─────────────────────────────────────────────────
  // Bulk: все рёбра воркспейса одним запросом (граф зависимостей, без N+1).
  if (routePath === "/dependencies" && req.method === "GET") {
    return json(await listWorkspaceDependencies(groupId, telegram_id, isAdmin), 200, origin);
  }

  // GET список; POST создать (с цикл-детекцией); DELETE удалить.
  const depsMatch = routePath.match(/^\/tasks\/([^/]+)\/dependencies$/);
  if (depsMatch) {
    const taskId = depsMatch[1];
    const task = await getTask(taskId);
    if (!task || task.group_id !== groupId || !canViewTask(task, telegram_id, isAdmin)) {
      return apiErr(404, "Not found", origin);
    }

    if (req.method === "GET") {
      return json(await listDependencies(taskId), 200, origin);
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      const dependsOnId = body.depends_on_id as string | undefined;
      if (!dependsOnId) return apiErr(400, "depends_on_id is required", origin);
      if (dependsOnId === taskId) return apiErr(400, "Задача не может зависеть от себя", origin);

      const depTask = await getTask(dependsOnId);
      if (!depTask || depTask.group_id !== groupId || !canViewTask(depTask, telegram_id, isAdmin)) {
        return apiErr(404, "depends_on задача не найдена", origin);
      }

      const allowed: DependencyType[] = ["blocks", "relates_to", "duplicates"];
      const type = allowed.includes(body.dependency_type as DependencyType)
        ? (body.dependency_type as DependencyType) : "blocks";

      const result = await createDependency(taskId, dependsOnId, type);
      if (!result.ok) {
        if (result.reason === "cycle") return apiErr(422, "Нельзя создать зависимость: образует цикл", origin);
        return apiErr(409, "Такая зависимость уже существует", origin);
      }
      return json(result.dependency, 201, origin);
    }
  }

  const depItemMatch = routePath.match(/^\/tasks\/([^/]+)\/dependencies\/([^/]+)$/);
  if (depItemMatch && req.method === "DELETE") {
    const [, taskId, depId] = depItemMatch;
    const task = await getTask(taskId);
    if (!task || task.group_id !== groupId || !canViewTask(task, telegram_id, isAdmin)) {
      return apiErr(404, "Not found", origin);
    }
    const ok = await deleteDependency(taskId, depId);
    if (!ok) return apiErr(404, "Not found", origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── Sprints (Рой) ──────────────────────────────────────────────────────────
  // Чтение — любой в воркспейсе; создание/изменение/удаление — только админ.
  if (routePath === "/sprints") {
    if (req.method === "GET") {
      return json(await listSprints(groupId), 200, origin);
    }
    if (req.method === "POST") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      if (!body.name || typeof body.name !== "string") return apiErr(400, "name is required", origin);
      if (!body.start_date || !body.end_date) return apiErr(400, "start_date и end_date обязательны", origin);
      if ((body.start_date as string) > (body.end_date as string)) {
        return apiErr(400, "start_date не может быть позже end_date", origin);
      }
      const input: SprintInput = {
        name: body.name as string,
        start_date: body.start_date as string,
        end_date: body.end_date as string,
        status: (body.status as SprintInput["status"]) ?? "planned",
      };
      try {
        return json(await createSprint(input, groupId), 201, origin);
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }
  }

  const sprintMatch = routePath.match(/^\/sprints\/([^/]+)$/);
  if (sprintMatch) {
    const sprintId = sprintMatch[1];
    if (req.method === "PATCH") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      const fields: Partial<SprintInput> = {};
      if (typeof body.name === "string") fields.name = body.name;
      if (typeof body.start_date === "string") fields.start_date = body.start_date;
      if (typeof body.end_date === "string") fields.end_date = body.end_date;
      if (typeof body.status === "string") fields.status = body.status as SprintInput["status"];
      const updated = await updateSprint(sprintId, fields, groupId);
      if (!updated) return apiErr(404, "Not found", origin);
      return json(updated, 200, origin);
    }
    if (req.method === "DELETE") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      const ok = await deleteSprint(sprintId, groupId);
      if (!ok) return apiErr(404, "Not found", origin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
  }

  // POST /sprints/:id/tasks { task_ids: [] } — привязать; DELETE — отвязать (sprint_id = null)
  const sprintTasksMatch = routePath.match(/^\/sprints\/([^/]+)\/tasks$/);
  if (sprintTasksMatch) {
    const sprintId = sprintTasksMatch[1];
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    const taskIds = Array.isArray(body.task_ids) ? (body.task_ids as string[]) : [];
    if (req.method === "POST") {
      if (!(await sprintInWorkspace(sprintId, groupId))) return apiErr(404, "Not found", origin);
      const n = await setTasksSprint(taskIds, sprintId, groupId);
      return json({ updated: n }, 200, origin);
    }
    if (req.method === "DELETE") {
      const n = await setTasksSprint(taskIds, null, groupId);
      return json({ updated: n }, 200, origin);
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
      .eq("entry_type", "note")
      .not("source", "eq", "digest")
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
      .select("first_name").eq("telegram_id", telegram_id).maybeSingle();
    const addedBy = (profile as { first_name?: string } | null)?.first_name || String(telegram_id);

    const { data: entry, error: insertError } = await supabase.from("entries").insert({
      content: `Файл: ${file.name}`,
      summary: null,
      embedding: null,
      added_by: addedBy,
      source: "file",
      metadata: { filename: file.name, file_url: publicUrl, file_type: file.type },
      countries: [],
      entry_type: "note",
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
      .select("first_name").eq("telegram_id", telegram_id).maybeSingle();
    const addedBy = (profile as { first_name?: string } | null)?.first_name || String(telegram_id);

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
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: 'Проанализируй текст и верни JSON (только JSON, без markdown): {"countries":["Spain","Bulgaria"],"entry_type":"meeting|note","entry_date":null}\n' + COUNTRY_PROMPT_RULE + "\n" + ENTRY_TYPE_PROMPT_RULE + "\nentry_date — дата события из текста, null если нет." },
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
      metadata: {}, countries: meta.countries, entry_type: meta.entry_type === "meeting" ? "meeting" : "note", entry_date: meta.entry_date,
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
    const embedding: number[] = (await embRes.json()).data[0].embedding;
    try {
      const results = await matchEntries(supabase, embedding, {
        groupId,
        requestingUserId: telegram_id,
        threshold: 0.3,
        limit: 20,
      });
      return json(results, 200, origin);
    } catch (e) {
      return apiErr(500, e instanceof Error ? e.message : "Search failed", origin);
    }
  }

  // ── POST /ask — RAG: семантический ответ + пронумерованные источники (экран Answer) ──
  if (req.method === "POST" && routePath === "/ask") {
    let askBody: { q?: string };
    try { askBody = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    const q = (askBody.q ?? "").trim();
    if (!q) return apiErr(400, "q required", origin);
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    // 1) эмбеддинг запроса
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: q.slice(0, 8000) }),
    });
    if (!embRes.ok) return apiErr(500, "Embedding failed", origin);
    const embedding: number[] = (await embRes.json()).data[0].embedding;
    // 2) retrieve (воркспейс-изоляция и приватность — внутри matchEntries/RPC)
    let matched: MatchedEntry[];
    try {
      matched = await matchEntries(supabase, embedding, { groupId, requestingUserId: telegram_id, threshold: 0.3, limit: 8 });
    } catch (e) {
      return apiErr(500, e instanceof Error ? e.message : "Search failed", origin);
    }
    const sources = matched.map((e, i) => ({
      n: i + 1,
      id: e.id,
      tag: entryTagKey(e.entry_type, e.metadata),
      entry_type: e.entry_type,
      title: deriveEntryTitle(e),
      snippet: (e.summary || e.content || "").replace(/\s+/g, " ").trim().slice(0, 220),
      market: (e.countries && e.countries[0]) || null,
      similarity: e.similarity,
    }));
    // 3) пусто — без вызова GPT
    if (sources.length === 0) {
      return json({ query: q, answer: "По базе, встречам и задачам ничего релевантного не нашлось. Попробуй переформулировать запрос.", sources: [], followups: [] }, 200, origin);
    }
    // 4) синтез ответа строго по источникам
    const ctx = sources.map((s) => `[${s.n}] (${s.entry_type}${s.market ? ", " + s.market : ""}) ${s.title} — ${s.snippet}`).join("\n");
    const askRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Ты — ассистент команды Dodo CEE. Отвечай на вопрос ТОЛЬКО на основе пронумерованных источников. По-русски, кратко и по делу (2–5 предложений). Где утверждение опирается на источник — ставь сноску [n] (можно несколько подряд: [1][3]). Не выдумывай факты вне источников; если данных недостаточно — честно скажи. Верни СТРОГО JSON: {"answer": "...", "followups": ["...","..."]}. followups — 2–3 коротких логичных уточняющих вопроса.' },
          { role: "user", content: `Вопрос: ${q}\n\nИсточники:\n${ctx}` },
        ],
        max_tokens: 700,
      }),
    });
    if (!askRes.ok) {
      // деградация: вернуть источники без AI-ответа, экран покажет список
      return json({ query: q, answer: "", sources, followups: [] }, 200, origin);
    }
    let answer = "";
    let followups: string[] = [];
    try {
      const raw = (await askRes.json()).choices[0].message.content as string;
      const parsed = JSON.parse(raw);
      answer = typeof parsed.answer === "string" ? parsed.answer : "";
      followups = Array.isArray(parsed.followups) ? parsed.followups.filter((x: unknown) => typeof x === "string").slice(0, 3) : [];
    } catch { /* answer пустой → фронт покажет только источники */ }
    return json({ query: q, answer, sources, followups }, 200, origin);
  }

  // ── GET /meetings ─────────────────────────────────────────────────────────────
  // Видимость: по умолчанию (без ?all) — только свои встречи (через privacy-фильтр
  // buildEntriesQuery, где pending = is_private/owner_id). Это касается всех, включая
  // админа. Override ?all=true работает ТОЛЬКО для админа и показывает все встречи
  // воркспейса (минуя privacy-фильтр).
  if (req.method === "GET" && routePath === "/meetings") {
    const confirmedParam = url.searchParams.get("confirmed");
    const showAll = url.searchParams.get("all") === "true";
    let q = (showAll && isAdmin)
      ? supabase
          .from("entries")
          .select("*")
          .eq("group_id", groupId)
          .eq("entry_type", "meeting")
          .order("created_at", { ascending: false })
          .limit(50)
      : buildEntriesQuery(supabase, "*", { groupId, telegramId: telegram_id })
          .eq("entry_type", "meeting")
          .order("created_at", { ascending: false })
          .limit(50);
    if (confirmedParam === "true") q = q.eq("metadata->>confirmed", "true");
    if (confirmedParam === "false") q = q.or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false");
    const { data, error } = await q;
    if (error) return apiErr(500, error.message, origin);
    return json(await withImporterNames((data ?? []) as Array<{ owner_id?: number | null; metadata?: unknown }>), 200, origin);
  }

  // ── GET/PATCH/DELETE /meetings/:id ────────────────────────────────────────────
  const meetingMatch = routePath.match(/^\/meetings\/([^/]+)$/);
  if (meetingMatch) {
    const meetingId = meetingMatch[1];
    return withEntries(origin, async () => {
      if (req.method === "GET") {
        const entry = await getEntrySecure(supabase, meetingId, { groupId, telegramId: telegram_id, isAdmin });
        return json(entry, 200, origin);
      }
      if (req.method === "PATCH") {
        const entry = await getEntrySecure(supabase, meetingId, { groupId, telegramId: telegram_id, isAdmin });
        let body: Record<string, unknown>;
        try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
        const fields: Record<string, unknown> = {};
        if ("confirmed" in body) {
          fields.metadata = { ...(entry.metadata as Record<string, unknown>), confirmed: body.confirmed };
          // Confirm = публикация в воркспейс: pending-встреча становится видимой всем
          // (снимаем приватность и владельца).
          if (body.confirmed === true) {
            fields.is_private = false;
            fields.owner_id = null;
          }
        }
        if ("summary" in body) fields.summary = body.summary;
        if ("content" in body && typeof body.content === "string") fields.content = body.content;
        if ("entry_type" in body && typeof body.entry_type === "string") fields.entry_type = body.entry_type;
        // Переименование встречи: пишем в metadata.title (его предпочитает deriveEntryTitle на фронте).
        // Мержим в уже собранный fields.metadata (если был confirmed) либо в текущую metadata записи.
        if (typeof body.title === "string" && body.title.trim()) {
          const meta = (fields.metadata as Record<string, unknown>) ?? { ...(entry.metadata as Record<string, unknown>) };
          meta.title = body.title.trim().slice(0, 200);
          fields.metadata = meta;
        }
        // Смена приватности встречи-записи: владелец задаётся/снимается вместе с флагом (как у задач).
        if (typeof body.is_private === "boolean") {
          fields.is_private = body.is_private;
          fields.owner_id = body.is_private ? (entry.owner_id ?? telegram_id) : null;
        }
        if ("countries" in body && Array.isArray(body.countries)) fields.countries = normalizeCountries(body.countries as string[]);
        await supabase.from("entries").update(fields).eq("id", entry.id);
        const { data } = await supabase.from("entries").select("*").eq("id", entry.id).single();
        return json(data, 200, origin);
      }
      if (req.method === "DELETE") {
        await getEntrySecure(supabase, meetingId, { groupId, telegramId: telegram_id, isAdmin });
        await supabase.from("entries").delete().eq("id", meetingId);
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      return apiErr(405, "Method not allowed", origin);
    });
  }

  // ── Swarm Meetings (desktop-agent): черновики на вычитке (таблица meetings) ─────
  // Видимость: тот же воркспейс + по умолчанию только свои (caller среди recorders).
  // Это касается всех, включая админа. Override ?all=true работает ТОЛЬКО для админа
  // и снимает фильтр по recorders (показывает все черновики воркспейса).
  // GET /agent-meetings?status=awaiting_review|in_base — очередь вычитки / опубликованные
  if (req.method === "GET" && routePath === "/agent-meetings") {
    const status = url.searchParams.get("status") ?? "awaiting_review";
    const showAll = url.searchParams.get("all") === "true";
    let q = supabase.from("meetings")
      .select("id, title, source, identity_kind, started_at, ended_at, status, draft_notes_md, recorders, entry_id, created_at")
      .eq("group_id", groupId)
      .eq("status", status)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(50);
    if (!(showAll && isAdmin)) q = q.contains("recorders", [{ telegram_id }]);
    const { data, error } = await q;
    if (error) return apiErr(500, error.message, origin);
    return json(await withRecorderNames((data ?? []) as Array<{ recorders?: unknown }>), 200, origin);
  }

  // GET/PATCH/DELETE /agent-meetings/:id, POST /:id/publish, GET/POST /:id/notes (live-пометки)
  const agentMeetingMatch = routePath.match(/^\/agent-meetings\/([^/]+)$/);
  const agentPublishMatch = routePath.match(/^\/agent-meetings\/([^/]+)\/publish$/);
  const agentNotesMatch = routePath.match(/^\/agent-meetings\/([^/]+)\/notes$/);
  if (agentMeetingMatch || agentPublishMatch || agentNotesMatch) {
    const mId = (agentMeetingMatch ?? agentPublishMatch ?? agentNotesMatch)![1];
    const { data: mRow } = await supabase.from("meetings").select("*").eq("id", mId).maybeSingle();
    const meeting = mRow as Record<string, unknown> | null;
    const recorders = (meeting?.recorders as Array<{ telegram_id: number }> | undefined) ?? [];
    const isRecorder = recorders.some((r) => r.telegram_id === telegram_id);
    if (!meeting || meeting.group_id !== groupId || (!isRecorder && !isAdmin)) {
      return apiErr(404, "Not found", origin);
    }

    // ── Live-пометки «Роя» (meeting_live_notes) — для экрана /live ──────────────
    if (agentNotesMatch && req.method === "GET") {
      const { data, error } = await supabase
        .from("meeting_live_notes")
        .select("id, offset_sec, text, author_id, created_at")
        .eq("meeting_id", mId)
        .order("offset_sec", { ascending: true });
      if (error) return apiErr(500, error.message, origin);
      return json(data ?? [], 200, origin);
    }
    if (agentNotesMatch && req.method === "POST") {
      if (meeting.status === "in_base") return apiErr(409, "Встреча уже в базе — пометки закрыты", origin);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return apiErr(400, "Пустая пометка", origin);
      const offsetSec = Math.max(0, Math.floor(Number(body.offset_sec) || 0));
      const { data, error } = await supabase.from("meeting_live_notes")
        .insert({ meeting_id: mId, group_id: groupId, author_id: telegram_id, offset_sec: offsetSec, text: text.slice(0, 2000) })
        .select("id, offset_sec, text, author_id, created_at")
        .single();
      if (error) return apiErr(500, error.message, origin);
      return json(data, 201, origin);
    }

    // GET — полный черновик (транскрипт + тезисы + участники + имена записавших)
    if (agentMeetingMatch && req.method === "GET") {
      const [enriched] = await withRecorderNames([meeting]);
      return json(enriched, 200, origin);
    }

    // PATCH — вычитка/правка черновика: тезисы и/или название (только до публикации)
    if (agentMeetingMatch && req.method === "PATCH") {
      if (meeting.status === "in_base") return apiErr(409, "Уже опубликовано — правьте запись в базе", origin);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      const nowIso = new Date().toISOString();
      const upd: Record<string, unknown> = { updated_at: nowIso };
      if (typeof body.draft_notes_md === "string") {
        upd.draft_notes_md = body.draft_notes_md;
        upd.notes_edited_at = nowIso;
      }
      if (typeof body.title === "string") {
        const t = body.title.trim();
        if (t) upd.title = t.slice(0, 200);
      }
      if (Object.keys(upd).length === 1) return apiErr(400, "Нужно draft_notes_md или title", origin);
      await supabase.from("meetings").update(upd).eq("id", mId);
      const { data } = await supabase.from("meetings").select("*").eq("id", mId).single();
      const [enriched] = await withRecorderNames([(data ?? {}) as { recorders?: unknown }]);
      return json(enriched, 200, origin);
    }

    // DELETE — убрать черновик из очереди вычитки (до публикации)
    if (agentMeetingMatch && req.method === "DELETE") {
      if (meeting.status === "in_base") return apiErr(409, "Уже в базе — удаляйте через раздел «База»", origin);
      await supabase.from("meetings").delete().eq("id", mId);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // POST publish — аппрув: создаём entries (выбор базы), привязываем, status=in_base
    if (agentPublishMatch && req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { body = {}; }
      const isPrivate = body.base === "personal";

      // идемпотентность: уже опубликовано → вернуть существующую запись
      if (meeting.status === "in_base" && meeting.entry_id) {
        const { data: existing } = await supabase.from("entries").select("*").eq("id", meeting.entry_id as string).single();
        return json(existing, 200, origin);
      }
      const draft = meeting.draft_notes_md as string | null;
      if (!draft) return apiErr(400, "Тезисы ещё не готовы — публиковать нечего", origin);

      // эмбеддинг тезисов (как в /search)
      const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: draft.slice(0, 8000) }),
      });
      const embedding: number[] | null = embRes.ok ? (await embRes.json()).data[0].embedding : null;

      const startedAt = meeting.started_at as string | null;
      const entryDate = startedAt ? startedAt.split("T")[0] : null;

      const { data: created, error: insErr } = await supabase.from("entries").insert({
        content: draft,
        summary: draft,
        embedding,
        added_by: String(telegram_id),
        source: "desktop-agent",
        entry_type: "meeting",
        metadata: { meeting_id: mId, title: meeting.title ?? null, confirmed: true },
        countries: [],
        entry_date: entryDate,
        group_id: groupId,
        is_private: isPrivate,
        owner_id: isPrivate ? telegram_id : null,
      }).select("*").single();
      if (insErr || !created) return apiErr(500, insErr?.message ?? "publish failed", origin);

      // привязка + статус с защитой от гонки (только если ещё не привязано)
      const { data: linked } = await supabase.from("meetings")
        .update({ entry_id: (created as { id: string }).id, status: "in_base", updated_at: new Date().toISOString() })
        .eq("id", mId)
        .is("entry_id", null)
        .select("id")
        .maybeSingle();
      if (!linked) {
        // параллельная публикация — убираем дубль, возвращаем уже привязанную запись
        await supabase.from("entries").delete().eq("id", (created as { id: string }).id);
        const { data: m2 } = await supabase.from("meetings").select("entry_id").eq("id", mId).single();
        const existingId = (m2 as { entry_id: string | null }).entry_id;
        const { data: existing } = await supabase.from("entries").select("*").eq("id", existingId as string).single();
        return json(existing, 200, origin);
      }
      // Авто-извлечение задач из тезисов (привязка к встрече mId, резолв исполнителей).
      // Не валит публикацию при сбое — entry уже создан.
      try {
        await createMeetingTasks(draft, { groupId, createdBy: telegram_id, meetingId: mId, isPrivate });
      } catch (e) {
        console.error("publish: извлечение задач не удалось для " + mId + ":", e);
      }
      return json(created, 201, origin);
    }

    return apiErr(405, "Method not allowed", origin);
  }

  // ── GET /integrations ─────────────────────────────────────────────────────────
  if (req.method === "GET" && routePath === "/integrations") {
    const { data } = await supabase.from("user_integrations")
      .select("service, last_polled_at, skipped_note_ids")
      .eq("telegram_id", telegram_id);
    return json(data ?? [], 200, origin);
  }

  // ── GET /google/connect-url — OAuth-ссылка для подключения Google-календаря ──────
  if (req.method === "GET" && routePath === "/google/connect-url") {
    if (!WEB_JWT_SECRET) return apiErr(500, "Web auth not configured", origin);
    const state = await signJWT({ telegram_id }, WEB_JWT_SECRET, 600);
    const base = Deno.env.get("SUPABASE_URL")!;
    return json({ url: `${base}/functions/v1/google-oauth/start?state=${encodeURIComponent(state)}` }, 200, origin);
  }

  // ── DELETE /integrations/google — отключить Google-календарь ─────────────────────
  if (req.method === "DELETE" && routePath === "/integrations/google") {
    await supabase.from("user_integrations").delete().eq("telegram_id", telegram_id).eq("service", "google_calendar");
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
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
      .select("first_name").eq("telegram_id", telegram_id).maybeSingle();
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

    // username — в allowed_users (не в user_profiles), иначе селект падал и было всегда «#id».
    const { data: au } = await supabase.from("allowed_users")
      .select("username").eq("telegram_id", telegram_id).maybeSingle();
    const username = (au as { username?: string } | null)?.username ?? String(telegram_id);

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

    type EntryRow = { summary: string | null; content: string; source: string; created_at: string };

    // Варианты стран для матчинга: код + русское имя (entries.countries может хранить любой формат).
    const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
      Object.entries(COUNTRY_NAMES).map(([c, n]) => [n.toLowerCase(), c]),
    );
    const countryVariants = [...new Set(markets.flatMap((m) => {
      const code = COUNTRY_NAMES[m] ? m : (NAME_TO_CODE[m.toLowerCase()] ?? m);
      return [code, COUNTRY_NAMES[code] ?? m];
    }))];

    // Персональный дайджест — СТРОГО по странам пользователя (entries.countries ∩ markets),
    // если рынки заданы. Без рынков — по всему воркспейсу.
    let q = supabase.from("entries")
      .select("summary, content, source, created_at")
      .gte("created_at", since)
      .eq("group_id", groupId)
      .not("source", "eq", "digest")
      .or(`is_private.eq.false,and(is_private.eq.true,owner_id.eq.${telegram_id})`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (countryVariants.length) q = q.overlaps("countries", countryVariants);
    const { data: entries } = await q;

    if (!entries?.length) {
      const msg = markets.length
        ? `За этот период нет записей по вашим странам (${markets.map((m) => COUNTRY_NAMES[m] ?? m).join(", ")}).`
        : "За указанный период нет записей.";
      return json({ text: msg }, 200, origin);
    }

    const periodStart = new Date(Date.now() - daysBack * 86400000).toLocaleDateString("ru-RU");
    const periodEnd = new Date().toLocaleDateString("ru-RU");
    const periodLabel = `${periodStart} — ${periodEnd}`;
    const entriesText = (entries as EntryRow[]).map((e) => {
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

    // Единый экстрактор (тот же `gptExtractTasks`, что на публикации встречи) — без дубля промпта.
    // Та же форма {title,description,assignee,due_date,country}; при сбое GPT отдаёт [] (мягко, не 500).
    const extracted = await gptExtractTasks(body.text);

    // Preview-режим: вернуть предложенные задачи БЕЗ создания (ревью на экране встреч —
    // пользователь правит/удаляет/добавляет к себе). save !== false → старое поведение (создать).
    if (body.save === false) {
      return json(extracted.slice(0, 10).filter((t) => t.title), 200, origin);
    }

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
