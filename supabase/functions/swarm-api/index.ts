import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyInitData } from "./auth.ts";
import { verifyJWT, signJWT } from "../_shared/jwt.ts";
import { getRecorderTokenStatus, mintRecorderToken, buildRecorderSetupOneLiner } from "../_shared/recorder-token.ts";
import { getMcpTokenStatus, mintMcpToken, buildSetupOneLiner } from "../_shared/mcp-token.ts";
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
import { normalizeCountries, COUNTRY_NAMES } from "../_shared/countries.ts";
import { extractEntryMeta, applyGeneralSentinel, buildEmbeddingInput, embed } from "../_shared/meta-extract.ts";
import { matchEntries, type MatchedEntry } from "../_shared/search.ts";
import { resummarizeFromTranscript } from "../_shared/meeting-processor.ts";
import { findDuplicateMeeting, type MeetingAttendee } from "../_shared/meeting-dedup.ts";
import { handleAdminRoutes } from "./admin.ts";
import { corsHeaders, json, apiErr } from "./http.ts";
import { handleTaskLabelRoutes } from "./task-labels.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const MAX_AGE = parseInt(Deno.env.get("INITDATA_MAX_AGE") ?? "86400", 10);
const ADMIN_USER_ID = 744230399; // см. lib/supabase.ts swarm-bot — единый суперадмин
// Demo-сессия для показа заказчику (секретная ссылка → JWT с этим telegram_id). Жёстко
// изолирована в воркспейс 'demo': не админ, не видит рабочие данные, не минтит токены.
const DEMO_USER_ID = 900000001;
const WEB_JWT_SECRET = Deno.env.get("WEB_JWT_SECRET"); // подпись веб-сессий (Login Widget, B+)

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Helpers ───────────────────────────────────────────────────────────────────
// corsHeaders / json / apiErr вынесены в ./http.ts (общие с доменными роут-модулями).

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
    .select("group_id, is_admin")
    .eq("telegram_id", telegram_id)
    .maybeSingle();

  if (!userRow) {
    return apiErr(401, "User not in allowed list", origin);
  }
  // Demo-сессия (секретная ссылка, telegram_id === DEMO_USER_ID): жёсткая изоляция.
  // Группа форсится в 'demo' (НЕ из БД), админ-права запрещены. Барьер «нет дыр в рабочие»:
  // все data-запросы фильтруются по этому group_id, admin-роуты недоступны (isAdmin=false).
  const isDemo = telegram_id === DEMO_USER_ID;
  const groupId = isDemo ? "demo" : (userRow as { group_id: string | null }).group_id;
  if (!groupId) {
    return apiErr(403, "No workspace assigned", origin);
  }
  const isAdmin = !isDemo && (telegram_id === ADMIN_USER_ID || (userRow as { is_admin?: boolean }).is_admin === true);

  // ── Routing ──────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  // Strip /functions/v1/swarm-api prefix to get the route path
  const routePath = url.pathname.split("/swarm-api").pop() || "/";

  // Admin routes (gated to telegram_id === 744230399)
  const adminResp = await handleAdminRoutes(supabase, req, routePath, telegram_id, isAdmin, origin);
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
    return json({ telegram_id, name, username, group_id: groupId, language: language_code, role: p?.role ?? null, markets: p?.markets ?? [], is_admin: isAdmin, is_demo: isDemo }, 200, origin);
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

  // GET /recorder/setup — статус токена рекордера (активен ли + до когда) для секции «Рекордер» в вебе.
  if (req.method === "GET" && routePath === "/recorder/setup") {
    const st = await getRecorderTokenStatus(supabase, telegram_id);
    return json(st, 200, origin);
  }

  // POST /recorder/token — минт/перевыпуск токена рекордера → { oneLiner, expiresAt }.
  // Токен ОТДЕЛЬНЫЙ от Claude-Desktop MCP-токена; доступно всем участникам (не только админ).
  if (req.method === "POST" && routePath === "/recorder/token") {
    if (isDemo) return apiErr(403, "Демо: выпуск токенов недоступен", origin);
    const minted = await mintRecorderToken(supabase, telegram_id);
    if (!minted) return apiErr(500, "Не удалось создать токен рекордера", origin);
    return json({ oneLiner: buildRecorderSetupOneLiner(minted.token), expiresAt: minted.expiresAt.toISOString() }, 200, origin);
  }

  // GET /mcp/setup — статус MCP-токена (Claude Desktop) для секции «Claude Desktop» в вебе.
  if (req.method === "GET" && routePath === "/mcp/setup") {
    const st = await getMcpTokenStatus(supabase, telegram_id);
    return json(st, 200, origin);
  }

  // POST /mcp/token — минт/перевыпуск MCP-токена → { oneLiner } (команда установки Claude Desktop).
  // Токен бессрочный; доступно всем участникам.
  if (req.method === "POST" && routePath === "/mcp/token") {
    if (isDemo) return apiErr(403, "Демо: выпуск токенов недоступен", origin);
    const minted = await mintMcpToken(supabase, telegram_id);
    if (!minted) return apiErr(500, "Не удалось создать токен", origin);
    return json({ oneLiner: buildSetupOneLiner(minted.token) }, 200, origin);
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

  // Персональные смарт-метки задач (/task-labels*) — доступ строго свой (owner_id).
  const labelResp = await handleTaskLabelRoutes(supabase, req, routePath, telegram_id, groupId, origin);
  if (labelResp) return labelResp;

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

      // IDOR-guard: meeting_id — это entry.id. Принимаем, только если эта запись видна
      // запросившему (воркспейс + приватность через getEntrySecure), иначе задачу можно
      // подцепить к чужой/приватной встрече и засветить её в чужом блоке «Задачи из встречи».
      const safeMeetingId = (body.meeting_id as string | null) ?? null;
      if (safeMeetingId) {
        try {
          await getEntrySecure(supabase, safeMeetingId, { groupId, telegramId: telegram_id ?? 0 });
        } catch (e) {
          if (e instanceof EntryAccessError) return apiErr(e.status, e.message, origin);
          throw e;
        }
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
        meeting_id: safeMeetingId,
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

      // Персональные смарт-метки: только на своей личной задаче (учитываем смену is_private в этом же PATCH).
      if (Array.isArray(body.label_ids)) {
        const effPrivate = typeof fields.is_private === "boolean" ? fields.is_private : task.is_private;
        const effOwner = "owner_id" in fields ? fields.owner_id : task.owner_id;
        if (!(effPrivate === true && effOwner === telegram_id)) {
          return apiErr(400, "Метки доступны только на личных задачах", origin);
        }
        const ids = (body.label_ids as unknown[]).filter((x): x is string => typeof x === "string");
        if (ids.length > 0) {
          const { data: mine } = await supabase
            .from("task_labels").select("id").eq("owner_id", telegram_id).in("id", ids);
          const valid = new Set(((mine ?? []) as Array<{ id: string }>).map((r) => r.id));
          if (ids.some((id) => !valid.has(id))) return apiErr(400, "Неизвестная метка", origin);
        }
        fields.label_ids = ids;
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

    // Ручная заметка из miniapp: эмбеддинг по контенту + страны/тип/дата через общее
    // COUNTRY_PROMPT_RULE (тот же извлекатель, что и в остальных путях ингеста).
    const [embedding, meta] = await Promise.all([
      embed(body.content, OPENAI_KEY),
      extractEntryMeta(body.content, OPENAI_KEY),
    ]);

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
          { role: "system", content: 'Ты — ассистент команды Dodo CEE. Отвечай на вопрос ТОЛЬКО на основе пронумерованных источников, по-русски. Ставь сноску [n] на каждое утверждение (можно [1][3]).\nВАЖНО: если источники относятся к РАЗНЫМ встречам / темам / странам — НЕ склеивай их в один искусственный абзац и НЕ выдумывай общие тренды/выводы («падение выручки», «в целом наблюдается…»), которых нет в источниках. В этом случае дай КОРОТКИЙ список: по одному пункту «- » на встречу/тему с ключевым фактом и сноской [n]. Если вопрос узкий и источники об одной теме — ответь связно в 2–4 предложения.\nНе выдумывай факты, цифры и обобщения. Если данных мало — скажи честно. Верни СТРОГО JSON: {"answer":"...","followups":["...","..."]}. В answer можно использовать переносы строк и пункты «- ». followups — 2–3 коротких уточняющих вопроса.' },
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

  // ── POST /meetings/:id/resummarize — пересобрать тезисы УЖЕ опубликованной встречи ──
  // Текущим промптом, из транскрипта связанной meetings-строки (metadata.meeting_id), без
  // ре-транскрибации. Обновляет summary+content+embedding записи. :id = entry.id.
  const meetingResummarizeMatch = routePath.match(/^\/meetings\/([^/]+)\/resummarize$/);
  if (meetingResummarizeMatch && req.method === "POST") {
    return withEntries(origin, async () => {
      const entry = await getEntrySecure(supabase, meetingResummarizeMatch[1], { groupId, telegramId: telegram_id, isAdmin });
      const meetingRowId = (entry.metadata as { meeting_id?: string } | null)?.meeting_id;
      if (!meetingRowId) return apiErr(400, "У записи нет транскрипта встречи — переобработка недоступна", origin);
      const tezisi = await resummarizeFromTranscript(supabase, meetingRowId);
      // Освежаем эмбеддинг (контент изменился) — как при публикации. Не критично при сбое.
      const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
      let embedding: number[] | null = null;
      try {
        const r = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({ model: "text-embedding-3-small", input: tezisi.slice(0, 8000) }),
        });
        if (r.ok) embedding = (await r.json()).data[0].embedding;
      } catch { /* эмбеддинг не критичен — текст обновим в любом случае */ }
      const upd: Record<string, unknown> = { summary: tezisi, content: tezisi };
      if (embedding) upd.embedding = embedding;
      await supabase.from("entries").update(upd).eq("id", entry.id);
      const { data } = await supabase.from("entries").select("*").eq("id", entry.id).single();
      return json(data, 200, origin);
    });
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
    // recorders — JSONB-массив объектов. supabase-js .contains() с JS-массивом сериализует
    // через .join(",") в Postgres-литерал cs.{[object Object]} → 400 (invalid json), и весь
    // запрос «Мои» падал (собственная запись не показывалась). Для jsonb-containment передаём
    // JSON-СТРОКУ → строковая ветка .contains даёт cs.[{"telegram_id":N}] (корректно).
    if (!(showAll && isAdmin)) q = q.contains("recorders", JSON.stringify([{ telegram_id }]));
    const { data, error } = await q;
    if (error) return apiErr(500, error.message, origin);
    return json(await withRecorderNames((data ?? []) as Array<{ recorders?: unknown }>), 200, origin);
  }

  // GET/PATCH/DELETE /agent-meetings/:id, POST /:id/publish, GET/POST /:id/notes (live-пометки),
  // POST /:id/resummarize (пере-сводка тезисов текущим промптом из сохранённого транскрипта)
  const agentMeetingMatch = routePath.match(/^\/agent-meetings\/([^/]+)$/);
  const agentPublishMatch = routePath.match(/^\/agent-meetings\/([^/]+)\/publish$/);
  const agentNotesMatch = routePath.match(/^\/agent-meetings\/([^/]+)\/notes$/);
  const agentResummarizeMatch = routePath.match(/^\/agent-meetings\/([^/]+)\/resummarize$/);
  if (agentMeetingMatch || agentPublishMatch || agentNotesMatch || agentResummarizeMatch) {
    const mId = (agentMeetingMatch ?? agentPublishMatch ?? agentNotesMatch ?? agentResummarizeMatch)![1];
    const { data: mRow } = await supabase.from("meetings").select("*").eq("id", mId).maybeSingle();
    const meeting = mRow as Record<string, unknown> | null;
    const recorders = (meeting?.recorders as Array<{ telegram_id: number }> | undefined) ?? [];
    const isRecorder = recorders.some((r) => r.telegram_id === telegram_id);
    if (!meeting || meeting.group_id !== groupId || (!isRecorder && !isAdmin)) {
      return apiErr(404, "Not found", origin);
    }

    // POST /:id/resummarize — пере-сводка тезисов ТЕКУЩИМ промптом из сохранённого транскрипта
    // (без повторной транскрибации). Только до публикации; заголовок не трогаем.
    if (agentResummarizeMatch && req.method === "POST") {
      if (meeting.status === "in_base") return apiErr(409, "Уже опубликовано — правьте запись в базе", origin);
      await resummarizeFromTranscript(supabase, mId);
      const { data } = await supabase.from("meetings").select("*").eq("id", mId).single();
      const [enriched] = await withRecorderNames([(data ?? {}) as { recorders?: unknown }]);
      return json(enriched, 200, origin);
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
      // Пометки можно добавлять к встрече в любом статусе (в т.ч. аннотировать уже опубликованную).
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

      // Встреча нашего рекордера: привязываем к рынкам через общее COUNTRY_PROMPT_RULE
      // (раньше countries хардкодился []), затем эмбеддим тезисы ВМЕСТЕ со странами.
      const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
      const meta = await extractEntryMeta(draft, OPENAI_KEY);
      const countries = applyGeneralSentinel(meta.countries);
      const embedding = await embed(buildEmbeddingInput(draft, countries), OPENAI_KEY);

      const startedAt = meeting.started_at as string | null;
      const entryDate = startedAt ? startedAt.split("T")[0] : null;
      const mAttendees = ((meeting as { attendees?: MeetingAttendee[] }).attendees ?? []);

      // Кросс-источниковый дедуп: эта встреча уже в базе (Granola / повторный паблиш)?
      // Если совпавшая запись видима публикующему (публичная или его личная) — привязываем
      // meeting к ней и возвращаем её, а не плодим вторую. Чужие приватные записи игнорируем
      // (не привязываемся к ним и не раскрываем) — тогда публикуем как обычно.
      const dup = await findDuplicateMeeting(supabase, {
        groupId, entryDate, startedAt, attendees: mAttendees,
      });
      if (dup && (!dup.isPrivate || String(dup.ownerId ?? "") === String(telegram_id))) {
        await supabase.from("meetings")
          .update({ entry_id: dup.id, status: "in_base", updated_at: new Date().toISOString() })
          .eq("id", mId)
          .is("entry_id", null);
        const { data: existing } = await supabase.from("entries").select("*").eq("id", dup.id).single();
        return json(existing, 200, origin);
      }

      const { data: created, error: insErr } = await supabase.from("entries").insert({
        content: draft,
        summary: draft,
        embedding,
        added_by: String(telegram_id),
        source: (meeting.source as string) ?? "desktop-agent",  // рекордер/granola/… — сохраняем провенанс
        entry_type: "meeting",
        // attendees из календаря (meetings.attendees, собран рекордером при claim) — несём в запись,
        // чтобы участники были видны и после публикации (UI: блок «Участники»).
        metadata: { meeting_id: mId, title: meeting.title ?? null, confirmed: true, attendees: (meeting as { attendees?: unknown }).attendees ?? [] },
        countries,
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
      // Задачи НЕ генерируем автоматически. Пользователь создаёт их вручную кнопкой
      // «Сгенерировать задачи» в ревью встречи / на экране встречи (preview → добавить).
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
      .select("api_key, skipped_note_ids").eq("telegram_id", telegram_id).eq("service", "granola").maybeSingle();
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
    // Granola-импорт из miniapp: раньше countries хардкодился [] (в отличие от бот-пути
    // Granola, который тегирует). Привязываем к рынкам через общее COUNTRY_PROMPT_RULE,
    // затем эмбеддим контент ВМЕСТЕ со странами.
    const meta = await extractEntryMeta(content, OPENAI_KEY);
    const countries = applyGeneralSentinel(meta.countries);
    const [embedding, summaryRes] = await Promise.all([
      embed(buildEmbeddingInput(content, countries), OPENAI_KEY),
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
    const summary = summaryRes.ok ? (await summaryRes.json()).choices[0].message.content : null;

    const entryDate = ts ? ts.slice(0, 10) : null;

    // Кросс-источниковый дедуп: встреча уже в базе (другой участник / рекордер / повторный импорт)?
    // Помечаем заметку обработанной (чтобы ушла из очереди ревью) и не создаём дубль.
    const dup = await findDuplicateMeeting(supabase, {
      groupId, entryDate, startedAt: ts ?? null, attendees,
    });
    if (dup) {
      const current: string[] = (integration as { skipped_note_ids?: string[] }).skipped_note_ids ?? [];
      if (!current.includes(noteId)) {
        await supabase.from("user_integrations")
          .update({ skipped_note_ids: [...current, noteId] })
          .eq("telegram_id", telegram_id).eq("service", "granola");
      }
      return json({ duplicate: true, id: dup.id, title: dup.title }, 200, origin);
    }

    await supabase.from("entries").insert({
      content, summary, embedding, added_by: addedBy, source: "granola",
      metadata: { granola_note_id: noteId, title: note.title, confirmed: true },
      countries, entry_type: "meeting",
      entry_date: entryDate,
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
    // Опция «весь воркспейс» — чекбокс в настройках дайджеста, ТОЛЬКО для админа (руководителю
    // нужен обзор по всем рынкам). Дефолт выкл: даже админ видит дайджест по своим markets, как все.
    // Гейт `isAdmin &&` — чтобы не-админ не мог снять фильтр рынков, подделав флаг в теле.
    const allCountries = isAdmin && body.all_countries === true;

    const { data: profile } = await supabase.from("user_profiles")
      .select("first_name, last_name, role, markets").eq("telegram_id", telegram_id).maybeSingle();
    const p = profile as { first_name?: string; last_name?: string; role?: string; markets?: string[] } | null;
    const userName = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "";
    const markets: string[] = p?.markets ?? [];
    const role: string = p?.role ?? "";

    type EntryRow = { id: string; summary: string | null; content: string; source: string; created_at: string; countries?: string[]; metadata: Record<string, unknown>; entry_type: string };

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
      .select("id, summary, content, source, created_at, countries, metadata, entry_type")
      .gte("created_at", since)
      .eq("group_id", groupId)
      .not("source", "eq", "digest")
      .or(`is_private.eq.false,and(is_private.eq.true,owner_id.eq.${telegram_id})`)
      .order("created_at", { ascending: false })
      .limit(80);
    // Охват: по умолчанию строго по своим рынкам (markets) — для всех, включая админа. Админ может
    // включить «весь воркспейс» чекбордом (allCountries) → фильтр рынков снимается.
    // Тег General НЕ дисквалифицирует запись — он есть почти у всех записей рядом с конкретными
    // странами. Раньше `.not(countries cs General)` выкидывал легитимные рыночные записи
    // (напр. [ME,SI,HR,RS,BG,General]) → дайджест схлопывался до 1–2 стран. Фильтр «пан-компанийного
    // шума» ниже смотрит на КОНКРЕТНЫЕ страны (без General), а не на наличие General.
    if (!allCountries && countryVariants.length) q = q.overlaps("countries", countryVariants);
    const { data: entriesRaw } = await q;
    // Пан-компанийный шум (не рыночная новость, давал «ахинею»): нет ни одной конкретной страны
    // ЛИБО охват >6 стран (широкое объявление на всю сеть). В персональный дайджест не берём.
    const meaningfulCountries = (cs?: string[]): string[] => (cs ?? []).filter((c) => c !== "General");
    const entries = (entriesRaw ?? []).filter((e: { countries?: string[] }) => {
      const m = meaningfulCountries(e.countries);
      return m.length >= 1 && m.length <= 6;
    });

    if (!entries?.length) {
      const msg = (!allCountries && markets.length)
        ? `За этот период нет записей по вашим странам (${markets.map((m) => COUNTRY_NAMES[m] ?? m).join(", ")}).`
        : "За указанный период нет записей.";
      return json({ text: msg }, 200, origin);
    }

    const periodStart = new Date(Date.now() - daysBack * 86400000).toLocaleDateString("ru-RU");
    const periodEnd = new Date().toLocaleDateString("ru-RU");
    const periodLabel = `${periodStart} — ${periodEnd}`;
    // Помечаем каждую запись страной(ами) пользователя (рус. названия) — чтобы GPT сгруппировал по странам.
    const marketCodes = new Set(markets.map((m) => (COUNTRY_NAMES[m] ? m : (NAME_TO_CODE[m.toLowerCase()] ?? m))));
    const entryCountryLabel = (cs?: string[]): string => {
      const own = (cs ?? []).filter((c) => marketCodes.has(c));
      const use = own.length ? own : (cs ?? []).filter((c) => c !== "General");
      // РОВНО ОДНА страна на запись (первая релевантная). Иначе мультистрановая запись
      // получает метку «RS, BG» и LLM дублирует её в КАЖДЫЙ страновой блок дайджеста
      // (была ошибка: одна встреча RS+BG → два одинаковых блока Сербия/Болгария).
      return use.length ? (COUNTRY_NAMES[use[0]] ?? use[0]) : "Общее";
    };
    const entriesText = (entries as EntryRow[]).map((e, i) => {
      const date = new Date(e.created_at).toLocaleDateString("ru-RU");
      return `[источник ${i + 1}] [${entryCountryLabel(e.countries)} · ${date}] ${(e.summary ?? e.content).slice(0, 500)}`;
    }).join("\n\n---\n\n");
    // Источники дайджеста (формат совместим с RAG /ask): клик по сноске [n] в пункте открывает
    // исходную запись. Порядок = нумерация «[источник N]» в тексте выше.
    const sources = (entries as EntryRow[]).map((e, i) => ({
      n: i + 1,
      id: e.id,
      tag: entryTagKey(e.entry_type, e.metadata),
      entry_type: e.entry_type,
      title: deriveEntryTitle(e),
      market: (e.countries && e.countries.find((c) => c !== "General")) || null,
      snippet: (e.summary || e.content || "").replace(/\s+/g, " ").trim().slice(0, 220),
      similarity: 1, // поле для совместимости с AskSource на фронте (у дайджеста нет ранга)
    }));

    const marketNames = markets.map((m) => COUNTRY_NAMES[m] ?? m).join(", ");
    const contextLine = [marketNames ? `Рынки: ${marketNames}` : "", role ? `Роль: ${role}` : "", userName ? `Имя: ${userName}` : ""].filter(Boolean).join(" | ");
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `Ты аналитик команды. Составь персональный дайджест за ${periodLabel} для сотрудника (${contextLine}).\n\nГЛАВНОЕ: сгруппируй СТРОГО ПО СТРАНАМ. Каждая запись помечена страной в начале — [Страна · дата]. Для КАЖДОЙ страны, по которой есть записи, сделай отдельный блок строго в формате:\n## <Страна>\n- пункт (что обсуждали / сделали / проблема / план по этой стране) [N]\nВ КОНЦЕ каждого пункта ставь сноску [N] — номер источника, из которого взят факт (номер указан в начале каждой записи как «[источник N]»). Ровно ОДИН номер на пункт — та запись, откуда факт.\n3–7 пунктов на страну — не жалей деталей: конкретные факты, числа, решения, проблемы, планы, открытые вопросы. Страны без записей НЕ упоминай. Не смешивай разные страны в один блок.\n\nБЕЗ ДУБЛЕЙ: каждую запись используй РОВНО в ОДНОМ страновом блоке (по её метке) — НЕ повторяй один и тот же факт/пункт в разных странах.\n\nЖЁСТКО: используй ТОЛЬКО факты из записей. НЕ придумывай цифры, названия компаний, ИМЕНА людей, события, сроки. Если ответственный/имя не указаны в записи — не пиши их. Не пиши вводных абзацев и итогов — только блоки по странам. Отвечай на русском.` },
          { role: "user", content: entriesText.slice(0, 13000) },
        ],
        max_tokens: 2600,
      }),
    });
    if (!gptRes.ok) return apiErr(500, "GPT error", origin);
    const text = (await gptRes.json()).choices[0].message.content;
    return json({ text, sources }, 200, origin);
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
