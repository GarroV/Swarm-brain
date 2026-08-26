import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyInitData } from "./auth.ts";
import { verifyJWT, signJWT } from "../_shared/jwt.ts";
import { getRecorderTokenStatus, mintRecorderToken, buildRecorderSetupOneLiner } from "../_shared/recorder-token.ts";
import { getMcpTokenStatus, mintMcpToken, buildSetupOneLiner } from "../_shared/mcp-token.ts";
import { buildClaudeProjectPrompt } from "../_shared/claude-project-prompt.ts";
import { feedbackCategoryLabel, isFeedbackCategory } from "../_shared/feedback-categories.ts";
import {
  EntryAccessError,
  buildEntriesQuery,
  buildReviewQueueQuery,
  getEntrySecure,
} from "./entries-guard.ts";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
} from "../_shared/tasks/db.ts";
import type { TaskInput, SprintInput, ProjectInput } from "../_shared/tasks/types.ts";
import {
  listSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  setTasksSprint,
} from "../_shared/tasks/sprints.ts";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  projectInWorkspace,
} from "../_shared/tasks/projects.ts";
import { normalizeCountries, COUNTRY_NAMES, detectQueryCountry } from "../_shared/countries.ts";
import { extractEntryMeta, applyGeneralSentinel, buildEmbeddingInput, embed } from "../_shared/meta-extract.ts";
import { pickSuggestedMarkets } from "../_shared/market-suggest.ts";
import { matchEntries, type MatchedEntry } from "../_shared/search.ts";
import { detectQuerySince } from "../_shared/query-time.ts";
import { resummarizeFromTranscript } from "../_shared/meeting-processor.ts";
import { findDuplicateMeeting, type MeetingAttendee } from "../_shared/meeting-dedup.ts";
import { canMutateTask, canViewTask } from "../_shared/tasks/access.ts";
import { normalizeExtractedDueDate, todayIso } from "../_shared/llm-date.ts";
import { canAccessDraftMeeting, draftMeetingsOwnScoped, type DraftMeetingRow } from "../_shared/meeting-access.ts";
import { handleAdminRoutes } from "./admin.ts";
import { corsHeaders, json, apiErr } from "./http.ts";
import { handleTaskLabelRoutes } from "./task-labels.ts";
import { handleTaskCommentRoutes } from "./task-comments.ts";
import { handleNotificationRoutes } from "./notifications.ts";
import { handleTaskSubscriptionRoutes } from "./task-subscriptions.ts";

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
export async function resolveNames(ids: number[]): Promise<Map<number, string>> {
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
async function withImporterNames<T extends { id?: string; owner_id?: number | null; metadata?: unknown }>(
  rows: T[],
  fallbackById?: Map<string, number>,
): Promise<Array<T & { importer_name: string | null }>> {
  const idOf = (r: T): number | null => {
    const raw = (r.metadata as Record<string, unknown> | null)?.added_by_telegram_id;
    const fromMeta = typeof raw === "number" ? raw : (typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null);
    const own = typeof r.owner_id === "number" ? r.owner_id : null;
    // Фолбэк — кто записал/импортировал (из meetings.recorders), если в самой записи атрибуции нет.
    const fb = (fallbackById && r.id) ? (fallbackById.get(r.id) ?? null) : null;
    return fromMeta ?? own ?? fb;
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
  const today = todayIso();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Сегодня ${today}. Извлеки задачи из тезисов встречи. Верни JSON массив (только JSON, без markdown): [{"title":"короткая формулировка действия","description":"1 фраза контекста из обсуждения: зачем/какой ожидаемый результат/важная деталь. НЕ повторяй заголовок другими словами. null, если заголовок самодостаточен","assignee":"Полное имя или null","due_date":"YYYY-MM-DD или null","country":"... или null"}]. Бери только реальные поручения/действия с конкретным результатом. Если задач нет — пустой массив [].\ndue_date: год считай от сегодняшней даты. Если в тексте назван только день и месяц («до 17 августа») — подставь ближайший подходящий год, НИКОГДА не бери год из головы. Если срок не назван — null.` },
        { role: "user", content: text.slice(0, 8000) },
      ],
      max_tokens: 1200,
    }),
  });
  if (!res.ok) return [];
  try {
    const raw = (await res.json()).choices[0].message.content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Слой 2: выдуманный моделью год чиним здесь — промпт можно проигнорировать, проверку нет.
    return (parsed as ExtractedTask[]).map((t) => ({ ...t, due_date: normalizeExtractedDueDate(t.due_date, today) }));
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

// canViewTask / canMutateTask переехали в общий `_shared/tasks/access.ts` (issue #45): здесь
// лежала одна из шести рукописных копий правила, и именно расхождение копий дало дыру в
// swarm-mcp. Импорт — вверху файла; локальные определения удалены сознательно, не восстанавливать.

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
    .select("group_id, is_admin, email")
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
  // E-mail нужен очереди вычитки: причастность к встрече определяется по metadata.attendees.
  const userEmail = isDemo ? null : ((userRow as { email?: string | null }).email ?? null);

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

  // GET /mcp/instructions — текст инструкций для проекта Claude Desktop (зеркало бот-команды
  // /claude), персонализирован Telegram ID. Кнопка «инструкции для проекта» в секции miniapp.
  if (req.method === "GET" && routePath === "/mcp/instructions") {
    return json({ instructions: buildClaudeProjectPrompt(telegram_id) }, 200, origin);
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

  // Комментарии к задачам (/tasks/:id/comments) — доступ по видимости задачи.
  const commentResp = await handleTaskCommentRoutes(supabase, req, routePath, telegram_id, groupId, isAdmin, origin, resolveNames);
  if (commentResp) return commentResp;

  // Подписка на уведомления о комментариях к задаче (/tasks/:id/subscription) — issue #82.
  const subResp = await handleTaskSubscriptionRoutes(supabase, req, routePath, telegram_id, groupId, isAdmin, origin);
  if (subResp) return subResp;

  // Лента уведомлений (/notifications*) — строго свои: фильтр по recipient_telegram_id.
  const notifResp = await handleNotificationRoutes(supabase, req, routePath, telegram_id, isAdmin, origin, resolveNames);
  if (notifResp) return notifResp;

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
      const projectId = url.searchParams.get("project_id") ?? undefined;
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
          projectId,
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
        // Имя + фамилия: в карточке задачи автор стоит рядом с исполнителем, а тот показан
        // полным именем («Vasiliy Garro»). Одно голое имя рядом с полным читается как разные
        // люди. Фамилии может не быть — тогда остаётся имя.
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("telegram_id, first_name, last_name")
          .in("telegram_id", creatorIds);
        (profiles ?? []).forEach((p: { telegram_id: number; first_name: string | null; last_name: string | null }) => {
          const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
          if (full) creatorMap.set(p.telegram_id, full);
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

      const projectId = (body.project_id as string | null) ?? null;
      if (projectId && !(await projectInWorkspace(projectId, groupId))) {
        return apiErr(400, "project_id не найден в этом воркспейсе", origin);
      }
      // parent_id при создании (подзадача): родитель того же воркспейса. Если задан — форсим project_linked.
      const parentId = (body.parent_id as string | null) ?? null;
      if (parentId) {
        const { data: par } = await supabase.from("tasks").select("id, project_id, group_id").eq("id", parentId).maybeSingle();
        if (!par || par.group_id !== groupId) return apiErr(400, "parent_id не найден в этом воркспейсе", origin);
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
        project_id: projectId,
        project_linked: body.project_linked === true || !!parentId,
        parent_id: parentId,
        tree_x: typeof body.tree_x === "number" ? body.tree_x : null,
        tree_y: typeof body.tree_y === "number" ? body.tree_y : null,
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
      // Пинг: перенос ВЗВОДИТ его заново (reminded_at = null) — иначе уже сработавший пинг,
      // передвинутый на новую дату, молча не пришёл бы: крон берёт только неотправленные.
      // Снятие пинга (null) заодно чистит след, чтобы карточка не показывала «напомнили».
      if ("remind_date" in body) {
        fields.remind_date = body.remind_date as string | null;
        fields.reminded_at = null;
        fields.remind_set_by = fields.remind_date ? telegram_id : null;
      }
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

      // Привязка к проекту (с проверкой воркспейса; null — открепить).
      if ("project_id" in body) {
        const pid = body.project_id as string | null;
        if (pid && !(await projectInWorkspace(pid, groupId))) {
          return apiErr(400, "project_id не найден в этом воркспейсе", origin);
        }
        fields.project_id = pid;
        // Открепление от проекта сбрасывает связь линией.
        if (!pid) fields.project_linked = false;
      }
      // Связать/отвязать линией (drag-to-connect). Осмысленно только у задачи с проектом.
      if (typeof body.project_linked === "boolean") {
        const effProject = "project_id" in fields ? fields.project_id : task.project_id;
        if (!effProject && body.project_linked) {
          return apiErr(400, "project_linked требует project_id", origin);
        }
        fields.project_linked = body.project_linked;
        if (!body.project_linked) fields.parent_id = null; // ушла из дерева → без родителя
      }

      // parent_id (подзадача) + защита от цикла
      if ("parent_id" in body) {
        const rawParent = body.parent_id as string | null;
        if (rawParent) {
          if (rawParent === taskId) return apiErr(400, "задача не может быть подзадачей самой себя", origin);
          const { data: par } = await supabase.from("tasks").select("id, group_id").eq("id", rawParent).maybeSingle();
          if (!par || par.group_id !== groupId) return apiErr(400, "parent_id не найден в этом воркспейсе", origin);
          // цикл: rawParent не должен быть потомком текущей задачи (идём вверх по parent_id)
          const sibQ = supabase.from("tasks").select("id, parent_id").eq("group_id", groupId);
          const { data: proj } = await (task.project_id ? sibQ.eq("project_id", task.project_id) : sibQ.is("project_id", null));
          const parents = new Map(((proj ?? []) as Array<{ id: string; parent_id: string | null }>).map((t) => [t.id, t.parent_id]));
          let cur: string | null = rawParent, guard = 0;
          while (cur && guard++ < 1000) { if (cur === taskId) return apiErr(400, "нельзя привязать к своему потомку (цикл)", origin); cur = parents.get(cur) ?? null; }
          fields.parent_id = rawParent;
          fields.project_linked = true; // подзадача всегда в дереве
        } else {
          fields.parent_id = null;
        }
      }

      // ручные координаты узла в дереве
      if (typeof body.tree_x === "number") fields.tree_x = body.tree_x;
      if (typeof body.tree_y === "number") fields.tree_y = body.tree_y;

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
        // Каскад: если задача ушла из дерева (project_linked=false) — её поддерево тоже в бэклог
        // (иначе висели бы подзадачи с родителем-в-бэклоге, нарушая инвариант дерева).
        if (fields.project_linked === false) {
          const sibQ = supabase.from("tasks").select("id, parent_id").eq("group_id", groupId);
          const { data: proj } = await (task.project_id ? sibQ.eq("project_id", task.project_id) : sibQ.is("project_id", null));
          const kids = new Map<string, string[]>();
          ((proj ?? []) as Array<{ id: string; parent_id: string | null }>).forEach((t) => { if (t.parent_id) { const a = kids.get(t.parent_id) ?? []; a.push(t.id); kids.set(t.parent_id, a); } });
          const subtree: string[] = []; const stack = [taskId];
          while (stack.length) { const id = stack.pop()!; for (const c of kids.get(id) ?? []) { subtree.push(c); stack.push(c); } }
          if (subtree.length) {
            await supabase.from("tasks").update({ project_linked: false, parent_id: null, updated_at: new Date().toISOString() }).in("id", subtree).eq("group_id", groupId);
          }
        }
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

  // Эндпоинты зависимостей задач (/dependencies, /tasks/:id/dependencies) СНЕСЕНЫ 2026-08-12
  // (issue #4): фронтовый потребитель (вкладка «Граф»/DependencyGraph) удалён при замене на
  // «Проекты», потребителей в web/MCP/боте не осталось. Таблица `task_dependencies` + RPC
  // `get_all_dependencies` дропаются отдельной миграцией ПОСЛЕ этого деплоя (2-шаговый снос схемы).

  // ── Sprints (Рой) ──────────────────────────────────────────────────────────
  // Чтение — любой в воркспейсе; создание/изменение/удаление — только админ.
  if (routePath === "/sprints") {
    if (req.method === "GET") {
      return json(await listSprints(groupId), 200, origin);
    }
    if (req.method === "POST") {
      // Создание вкладки — любой участник воркспейса (владелец 2026-08-19: юзер уткнулся в
      // голый «Forbidden», фронт кнопку «+» показывает всем). Правка/удаление ниже остаются
      // admin-only как и были с 09.06.2026 — не даём случайно/умышленно снести общую вкладку.
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

  // ── Projects (Project Space) ────────────────────────────────────────────────
  if (routePath === "/projects") {
    if (req.method === "GET") {
      return json(await listProjects(groupId, { viewerId: telegram_id, isAdmin }), 200, origin);
    }
    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      if (typeof body.name !== "string" || !body.name.trim()) {
        return apiErr(400, "name обязателен", origin);
      }
      const sprintId = (body.sprint_id as string | null) ?? null;
      if (sprintId && !(await sprintInWorkspace(sprintId, groupId))) {
        return apiErr(400, "sprint_id не найден в этом воркспейсе", origin);
      }
      const input: ProjectInput = {
        name: body.name.trim(),
        color: (body.color as string | null) ?? null,
        emoji: (body.emoji as string | null) ?? null,
        parent_id: (body.parent_id as string | null) ?? null,
        sprint_id: sprintId,
        is_private: typeof body.is_private === "boolean" ? body.is_private : false,
      };
      try {
        return json(await createProject(input, groupId, telegram_id ?? null), 201, origin);
      } catch (e) {
        return apiErr(400, e instanceof Error ? e.message : "invalid parent", origin);
      }
    }
    return apiErr(405, "Method not allowed", origin);
  }

  const projectMatch = routePath.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectId = projectMatch[1];
    if (req.method === "PATCH") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      const fields: Partial<ProjectInput> = {};
      if (typeof body.name === "string") fields.name = body.name.trim();
      if ("color" in body) fields.color = body.color as string | null;
      if ("emoji" in body) fields.emoji = body.emoji as string | null;
      if ("parent_id" in body) fields.parent_id = (body.parent_id as string | null) ?? null;
      if (typeof body.is_private === "boolean") fields.is_private = body.is_private;
      if ("sprint_id" in body) {
        const sid = (body.sprint_id as string | null) ?? null;
        if (sid && !(await sprintInWorkspace(sid, groupId))) {
          return apiErr(400, "sprint_id не найден в этом воркспейсе", origin);
        }
        fields.sprint_id = sid;
      }
      let updated;
      try {
        updated = await updateProject(projectId, fields, groupId, { viewerId: telegram_id });
      } catch (e) {
        return apiErr(400, e instanceof Error ? e.message : "invalid parent", origin);
      }
      if (!updated) return apiErr(404, "Not found", origin);
      return json(updated, 200, origin);
    }
    if (req.method === "DELETE") {
      const ok = await deleteProject(projectId, groupId, { viewerId: telegram_id });
      if (!ok) return apiErr(404, "Not found", origin);
      return json({ ok: true }, 200, origin);
    }
    return apiErr(405, "Method not allowed", origin);
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
          { role: "system", content: isDemo
            ? "Make concise bullet points from the text. Only concrete facts: names, numbers, decisions, dates. 3–7 points. A bulleted list in English."
            : "Сделай краткие тезисы из текста. Только конкретные факты: имена, цифры, решения, даты. 3–7 пунктов. Маркированный список на русском." },
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
        limit: 20,
        queryText: q,                       // лексический сигнал (full-text)
        country: detectQueryCountry(q),     // буст по стране, если она названа в запросе
        since: detectQuerySince(q),         // жёсткое окно для временных запросов («за 2 недели»)
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
      matched = await matchEntries(supabase, embedding, { groupId, requestingUserId: telegram_id, limit: 8, queryText: q, country: detectQueryCountry(q), since: detectQuerySince(q) });
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
      date: e.entry_date,
      similarity: e.similarity,
    }));
    // 3) пусто — без вызова GPT
    if (sources.length === 0) {
      return json({ query: q, answer: "По базе, встречам и задачам ничего релевантного не нашлось. Попробуй переформулировать запрос.", sources: [], followups: [] }, 200, origin);
    }
    // 4) синтез ответа строго по источникам
    const ctx = sources.map((s) => `[${s.n}] (${s.entry_type}${s.market ? ", " + s.market : ""}${s.date ? ", " + s.date : ""}) ${s.title} — ${s.snippet}`).join("\n");
    const askRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: isDemo
            ? 'You are the Dodo CEE team assistant. Answer the question ONLY from the numbered sources, in English. Put a footnote [n] on every statement (you may use [1][3]).\nIMPORTANT: if the sources concern DIFFERENT meetings / topics / countries — do NOT glue them into one artificial paragraph and do NOT invent shared trends/conclusions («revenue drop», «overall we see…») that aren\'t in the sources. In that case give a SHORT list: one «- » point per meeting/topic with the key fact and a footnote [n]. If the question is narrow and the sources are on one topic — answer coherently in 2–4 sentences.\nDon\'t invent facts, numbers or generalizations. If there\'s little data — say so honestly. Return STRICTLY JSON: {"answer":"...","followups":["...","..."]}. In answer you may use line breaks and «- » points. followups — 2–3 short clarifying questions.'
            : 'Ты — ассистент команды Dodo CEE. Отвечай на вопрос ТОЛЬКО на основе пронумерованных источников, по-русски. Ставь сноску [n] на каждое утверждение (можно [1][3]).\nВАЖНО: если источники относятся к РАЗНЫМ встречам / темам / странам — НЕ склеивай их в один искусственный абзац и НЕ выдумывай общие тренды/выводы («падение выручки», «в целом наблюдается…»), которых нет в источниках. В этом случае дай КОРОТКИЙ список: по одному пункту «- » на встречу/тему с ключевым фактом и сноской [n]. Если вопрос узкий и источники об одной теме — ответь связно в 2–4 предложения.\nНе выдумывай факты, цифры и обобщения. Если данных мало — скажи честно. Даты источников указаны в скобках — при вопросе о «последнем/недавнем» или если источники разных дат, предпочитай более свежие и называй даты. Верни СТРОГО JSON: {"answer":"...","followups":["...","..."]}. В answer можно использовать переносы строк и пункты «- ». followups — 2–3 коротких уточняющих вопроса.' },
          { role: "user", content: isDemo ? `Question: ${q}\n\nSources:\n${ctx}` : `Вопрос: ${q}\n\nИсточники:\n${ctx}` },
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
  // Видимость: ТОЛЬКО свои встречи (публичные воркспейса + свои приватные) через
  // privacy-фильтр buildEntriesQuery — для ВСЕХ, включая админа. Прежний admin-override
  // ?all=true (показывал чужие приватные) убран (решение владельца 2026-08-07): приватное
  // видит только владелец. Оверсайт-исключение осталось лишь для задач, не для встреч.
  if (req.method === "GET" && routePath === "/meetings") {
    const confirmedParam = url.searchParams.get("confirmed");
    // Лимит настраиваемый (?limit=), дефолт 500 — прежний хардкод 50 обрезал список «Все встречи»
    // (у команды уже 60+ встреч только за 2 недели). Потолок 2000 — защита от гигантского payload.
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 1), 2000);
    // Несогласованные (очередь вычитки) — по причастности: владелец ИЛИ участник встречи.
    // Обычный фильтр видимости тут не годится: «ничья» неприватная встреча из read-ai висела
    // бы в очереди у всего воркспейса (issue #66). Согласованные — обычное правило.
    let q = (confirmedParam === "false"
      ? buildReviewQueueQuery(supabase, "*", { groupId, telegramId: telegram_id, email: userEmail })
      : buildEntriesQuery(supabase, "*", { groupId, telegramId: telegram_id }))
      .eq("entry_type", "meeting")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (confirmedParam === "true") q = q.eq("metadata->>confirmed", "true");
    if (confirmedParam === "false") q = q.or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false");
    const { data, error } = await q;
    if (error) return apiErr(500, error.message, origin);
    const rows = (data ?? []) as unknown as Array<{ id: string; owner_id?: number | null; metadata?: unknown }>;
    // «Кто записал» часто не продублирован в metadata записи, но есть в связанной строке meetings
    // (recorders — источник истины). Подтягиваем как фолбэк атрибуции для ВСЕХ встреч (прошлых и новых).
    const recMap = new Map<string, number>();
    if (rows.length) {
      const { data: mrows } = await supabase
        .from("meetings").select("entry_id, recorders")
        .in("entry_id", rows.map((r) => r.id));
      for (const m of (mrows ?? []) as Array<{ entry_id: string | null; recorders: Array<{ telegram_id?: number | string }> | null }>) {
        const raw = m.recorders?.[0]?.telegram_id;
        const tg = typeof raw === "number" ? raw : (typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null);
        if (m.entry_id && tg !== null) recMap.set(m.entry_id, tg);
      }
    }
    return json(await withImporterNames(rows, recMap), 200, origin);
  }

  // ── POST /meetings/:id/resummarize — пересобрать тезисы УЖЕ опубликованной встречи ──
  // Текущим промптом, из транскрипта связанной meetings-строки (metadata.meeting_id), без
  // ре-транскрибации. Обновляет summary+content+embedding записи. :id = entry.id.
  const meetingResummarizeMatch = routePath.match(/^\/meetings\/([^/]+)\/resummarize$/);
  if (meetingResummarizeMatch && req.method === "POST") {
    return withEntries(origin, async () => {
      const entry = await getEntrySecure(supabase, meetingResummarizeMatch[1], { groupId, telegramId: telegram_id });
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
          // Confirm = публикация: встреча становится видимой всему воркспейсу (is_private=false;
          // ниже перезапишется, если пользователь выбрал «Личное»).
          //
          // Владельца при этом НЕ обнуляем. Раньше здесь стояло owner_id = null, и отсюда в базе
          // 159 «ничьих» встреч — у записи не было автора, а несогласованная «ничья» встреча
          // висела в очереди вычитки у всего воркспейса (issue #66). Решение владельца
          // 2026-08-22: «не должно быть ничьих — вся информация принадлежит кому-то».
          // Хозяин = тот, кто её принёс; если автор неизвестен (Read.ai пишет без владельца) —
          // тот, кто согласовал: «сохранит тот, кто успеет».
          // Видимость это не меняет: общую встречу по-прежнему видят все (is_private=false).
          if (body.confirmed === true) {
            fields.is_private = false;
            fields.owner_id = entry.owner_id ?? telegram_id;
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
          // Владелец остаётся и у общей встречи: is_private отвечает за ВИДИМОСТЬ, owner_id —
          // за авторство. Прежнее `: null` обнуляло хозяина при выборе «Общее» и было вторым
          // источником «ничьих» записей (первый — блок confirmed выше, issue #66).
          fields.owner_id = entry.owner_id ?? telegram_id;
        }
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

  // ── Swarm Meetings (desktop-agent): черновики на вычитке (таблица meetings) ─────
  // Видимость: тот же воркспейс + по умолчанию только свои (caller среди recorders).
  // Это касается всех, включая админа. Override ?all=true работает ТОЛЬКО для админа
  // и снимает фильтр по recorders (показывает все черновики воркспейса).
  // GET /agent-meetings?status=awaiting_review|in_base — очередь вычитки / опубликованные
  if (req.method === "GET" && routePath === "/agent-meetings") {
    const status = url.searchParams.get("status") ?? "awaiting_review";
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
    // ВСЕГДА только свои: черновик на вычитке — сырая запись чужого разговора, у админа тут
    // оверсайта нет (решение владельца 2026-08-20). Прежний `?all=true` для админа убран;
    // пригляд «у кого копится» — агрегат без контента GET /admin/review-counts.
    q = q.contains("recorders", JSON.stringify(draftMeetingsOwnScoped(telegram_id)));
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
  const agentMarketMatch = routePath.match(/^\/agent-meetings\/([^/]+)\/market-suggestion$/);
  if (agentMeetingMatch || agentPublishMatch || agentNotesMatch || agentResummarizeMatch || agentMarketMatch) {
    const mId = (agentMeetingMatch ?? agentPublishMatch ?? agentNotesMatch ?? agentResummarizeMatch ?? agentMarketMatch)![1];
    const { data: mRow } = await supabase.from("meetings").select("*").eq("id", mId).maybeSingle();
    const meeting = mRow as Record<string, unknown> | null;
    // Черновик (в т.ч. правка, публикация, удаление) — только записавшему; админ НЕ исключение.
    if (!canAccessDraftMeeting(meeting as DraftMeetingRow | null, telegram_id, isAdmin, groupId)) {
      return apiErr(404, "Not found", origin);
    }
    // Сужение для компилятора: гард уже вернул 404 при meeting=null. Строка недостижима.
    if (!meeting) return apiErr(404, "Not found", origin);

    // POST /:id/resummarize — пере-сводка тезисов ТЕКУЩИМ промптом из сохранённого транскрипта
    // (без повторной транскрибации). Только до публикации; заголовок не трогаем.
    if (agentResummarizeMatch && req.method === "POST") {
      if (meeting.status === "in_base") return apiErr(409, "Уже опубликовано — правьте запись в базе", origin);
      let note = "";
      try { const b = await req.json() as { note?: unknown }; note = typeof b?.note === "string" ? b.note.slice(0, 500) : ""; } catch { /* тело необязательно */ }
      await resummarizeFromTranscript(supabase, mId, note);
      const { data } = await supabase.from("meetings").select("*").eq("id", mId).single();
      const [enriched] = await withRecorderNames([(data ?? {}) as { recorders?: unknown }]);
      return json(enriched, 200, origin);
    }

    // GET /:id/market-suggestion — что предложить в чипах рынков на вычитке (issue #73).
    // Дорогой сигнал (классификатор по тезисам) считается ТОЛЬКО когда название и участники
    // молчат: он же исторический источник перетега, и звать OpenAI на каждое открытие
    // карточки незачем.
    if (agentMarketMatch && req.method === "GET") {
      const title = (meeting.title as string | null) ?? null;
      const emails = new Set(
        ((meeting as { attendees?: MeetingAttendee[] }).attendees ?? [])
          .map((a) => (a?.email ?? "").trim().toLowerCase())
          .filter(Boolean),
      );
      let participantMarkets: string[][] = [];
      if (emails.size > 0) {
        // Матчим по lower(email) в коде: в базе уникальность тоже по lower(email), а .in()
        // сравнивал бы регистрозависимо и терял участников с «Ivan.Petrov@…».
        const { data: users } = await supabase.from("allowed_users")
          .select("telegram_id, email").eq("group_id", groupId);
        const ids = ((users ?? []) as Array<{ telegram_id: number | null; email: string | null }>)
          .filter((u) => u.telegram_id && emails.has((u.email ?? "").trim().toLowerCase()))
          .map((u) => u.telegram_id as number);
        if (ids.length > 0) {
          const { data: profiles } = await supabase.from("user_profiles").select("markets").in("telegram_id", ids);
          participantMarkets = ((profiles ?? []) as Array<{ markets: string[] | null }>)
            .map((pr) => pr.markets ?? []).filter((m) => m.length > 0);
        }
      }
      let suggestion = pickSuggestedMarkets({ title, participantMarkets, notesMarkets: [] });
      const draftNotes = meeting.draft_notes_md as string | null;
      if (!suggestion.source && draftNotes) {
        try {
          const meta = await extractEntryMeta(draftNotes, Deno.env.get("OPENAI_API_KEY")!);
          suggestion = pickSuggestedMarkets({ title, participantMarkets, notesMarkets: meta.countries });
        } catch (e) {
          // Подсказка не критична: чипы просто откроются пустыми и человек выберет сам.
          // Молчать нельзя — иначе «подсказка всегда пустая» выглядит как задумка.
          console.error("market-suggestion: классификатор по тезисам не ответил", e);
        }
      }
      return json(suggestion, 200, origin);
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

      // Рынки: приоритет у человека (issue #73). Пришли в теле с экрана вычитки — они и
      // авторитетны, классификатор не зовём вовсе (ни лишнего вызова, ни его перетега), и
      // applyGeneralSentinel не применяем: несколько рынков разрешены, раз их выбрал человек.
      // Пустой список = «Общее», а в базе это тег General, а не отсутствие тега.
      // Поля countries в теле нет (бот, старый клиент) → прежнее поведение классификатора.
      const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
      const manualCountries = Array.isArray(body.countries)
        ? normalizeCountries(body.countries as string[])
        : null;
      const countries = manualCountries !== null
        ? (manualCountries.length > 0 ? manualCountries : ["General"])
        : applyGeneralSentinel((await extractEntryMeta(draft, OPENAI_KEY)).countries);
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
        // identity_key (календарное событие+день) — решающий сигнал: тот же ключ → дубль,
        // разный → РАЗНАЯ встреча, не склеиваем (без него 4 встречи IMF BD 23.07 слиплись в одну).
        identityKey: (meeting.identity_key as string | null) ?? null,
        viewerId: telegram_id,
      });
      // Фильтр приватности теперь ВНУТРИ findDuplicateMeeting (issue #45) — чужое личное сюда
      // не доходит; прежняя ручная проверка на этой строке была единственной из четырёх.
      if (dup) {
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
        // identity_key несём в запись, чтобы будущий дедуп мог отличить разные встречи одного дня
        // с тем же составом (регулярные командные созвоны) от повторной записи той же встречи.
        metadata: { meeting_id: mId, title: meeting.title ?? null, confirmed: true, attendees: (meeting as { attendees?: unknown }).attendees ?? [], identity_key: (meeting.identity_key as string | null) ?? null },
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
          { role: "system", content: isDemo
            ? "Make concise meeting bullet points. Only concrete facts: participants, decisions, actions. 3–7 points in English."
            : "Сделай краткие тезисы встречи. Только конкретные факты: участники, решения, действия. 3–7 пунктов на русском." },
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
            { role: "system", content: isDemo
              ? "Make concise meeting bullet points. 3–7 points in English."
              : "Сделай краткие тезисы встречи. 3–7 пунктов на русском." },
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
      groupId, entryDate, startedAt: ts ?? null, attendees, viewerId: telegram_id,
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
  // Принимает ОБА формата (backward-compat на время раскатки со старым кэш-бандлом):
  //   • multipart/form-data — новый веб: text + category + опц. screenshot (→ swarm_drive)
  //   • application/json    — legacy-клиент (старый service-worker кэш): только { text, category? }
  if (req.method === "POST" && routePath === "/feedback") {
    let text = "";
    let category = "other";
    let screenshotFile: File | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
      if (typeof body.text !== "string" || !body.text.trim()) return apiErr(400, "text required", origin);
      text = body.text.trim();
      if (isFeedbackCategory(body.category)) category = body.category;
    } else {
      let form: FormData;
      try { form = await req.formData(); } catch { return apiErr(400, "Invalid form data", origin); }
      const rawText = form.get("text");
      if (typeof rawText !== "string" || !rawText.trim()) return apiErr(400, "text required", origin);
      text = rawText.trim();
      const rawCat = form.get("category");
      if (isFeedbackCategory(rawCat)) category = rawCat;
      const screenshot = form.get("screenshot");
      if (screenshot instanceof File && screenshot.size > 0) screenshotFile = screenshot;
    }

    // username — в allowed_users (не в user_profiles), иначе селект падал и было всегда «#id».
    const { data: au } = await supabase.from("allowed_users")
      .select("username").eq("telegram_id", telegram_id).maybeSingle();
    const username = (au as { username?: string } | null)?.username ?? String(telegram_id);

    // Скрин — durable URL в swarm_drive (единственный способ увидеть его вне Telegram).
    let screenshotUrl: string | null = null;
    if (screenshotFile) {
      const buf = await screenshotFile.arrayBuffer();
      const date = new Date().toISOString().slice(0, 10);
      const safeName = (screenshotFile.name || "screenshot.png").replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `feedback/${date}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("swarm_drive")
        .upload(path, buf, { contentType: screenshotFile.type || "image/png", upsert: true });
      if (!upErr) screenshotUrl = supabase.storage.from("swarm_drive").getPublicUrl(path).data.publicUrl;
    }

    const { data: feedbackRow } = await supabase.from("feedback")
      .insert({ telegram_id, username, text, category, source: "web", screenshot_url: screenshotUrl })
      .select("id").single();

    const { data: channelRow } = await supabase.from("app_settings")
      .select("value").eq("key", "feedback_channel_id").maybeSingle();
    const channelId = (channelRow as { value?: string } | null)?.value;
    if (channelId && feedbackRow) {
      const date = new Date().toLocaleDateString("ru-RU");
      const caption = `<b>[Веб]</b> 🐛 ${feedbackCategoryLabel(category)} · @${username} · ${date}\n\n${text}`;
      const method = screenshotUrl ? "sendPhoto" : "sendMessage";
      const payload = screenshotUrl
        ? { chat_id: channelId, photo: screenshotUrl, caption, parse_mode: "HTML" }
        : { chat_id: channelId, text: caption, parse_mode: "HTML" };
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
          { role: "system", content: isDemo
            ? `You are a team analyst. Compile a personal digest for ${periodLabel} for the employee (${contextLine}).\n\nKEY: group STRICTLY BY COUNTRY. Each record is tagged with its country at the start — [Country · date]. For EACH country that has records, make a separate block strictly in this format:\n## <Country>\n- point (what was discussed / done / a problem / a plan for this country) [N]\nAt the END of each point put a footnote [N] — the number of the source the fact came from (the number is given at the start of each record as «[источник N]»). Exactly ONE number per point — the record the fact came from.\n3–7 points per country — don't spare details: concrete facts, numbers, decisions, problems, plans, open questions. Do NOT mention countries with no records. Don't mix different countries in one block.\n\nNO DUPLICATES: use each record in EXACTLY ONE country block (per its tag) — do NOT repeat the same fact/point across countries.\n\nSTRICT: use ONLY facts from the records. Do NOT invent numbers, company names, people's NAMES, events, dates. If an owner/name isn't stated in a record, don't write it. Don't write intro paragraphs or conclusions — only country blocks. Reply in English.`
            : `Ты аналитик команды. Составь персональный дайджест за ${periodLabel} для сотрудника (${contextLine}).\n\nГЛАВНОЕ: сгруппируй СТРОГО ПО СТРАНАМ. Каждая запись помечена страной в начале — [Страна · дата]. Для КАЖДОЙ страны, по которой есть записи, сделай отдельный блок строго в формате:\n## <Страна>\n- пункт (что обсуждали / сделали / проблема / план по этой стране) [N]\nВ КОНЦЕ каждого пункта ставь сноску [N] — номер источника, из которого взят факт (номер указан в начале каждой записи как «[источник N]»). Ровно ОДИН номер на пункт — та запись, откуда факт.\n3–7 пунктов на страну — не жалей деталей: конкретные факты, числа, решения, проблемы, планы, открытые вопросы. Страны без записей НЕ упоминай. Не смешивай разные страны в один блок.\n\nБЕЗ ДУБЛЕЙ: каждую запись используй РОВНО в ОДНОМ страновом блоке (по её метке) — НЕ повторяй один и тот же факт/пункт в разных странах.\n\nЖЁСТКО: используй ТОЛЬКО факты из записей. НЕ придумывай цифры, названия компаний, ИМЕНА людей, события, сроки. Если ответственный/имя не указаны в записи — не пиши их. Не пиши вводных абзацев и итогов — только блоки по странам. Отвечай на русском.` },
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
