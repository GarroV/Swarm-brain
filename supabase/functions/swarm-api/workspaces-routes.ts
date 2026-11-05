// Пространства в админке (этап 4 «Второго пространства», решение 05.11.2026): создание,
// переименование и сводка по пространству для мастер-админа.
//   • POST  /admin/workspaces            — создать (только мастер-админ): название + необязательные страны
//                                           и админы. Слаг генерируется здесь (_shared/workspaces.ts).
//   • PATCH /admin/workspaces/:id        — название и список стран; название проходит ту же проверку.
//   • GET   /admin/workspaces/:id/stats  — СЧЁТЧИКИ пространства (мастер — любое, админ — своё).
// Сводка — только числа: ни названий, ни текстов, ни имён. Что именно считается — `workspaceStats`.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeCountries } from "../_shared/countries.ts";
import { onlyLiveEntries } from "../_shared/entries/live.ts";
import { type AdminActor, canManageWorkspace, isSuperadmin } from "../_shared/users/admin-scope.ts";
import { addUserToWorkspace, escapeLike, normalizeUsername } from "../_shared/users/membership.ts";
import { parseUserRef, type UserRef } from "../_shared/users/user-ref.ts";
import { createWorkspace, validateWorkspaceName } from "../_shared/workspaces.ts";
import { serverError } from "./client-error.ts";
import { apiErr, json } from "./http.ts";

/** Окно «активных людей» и расхода модели в сводке, дней. */
export const STATS_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const PAGE = 1000;
/** Потолок строк при выборке «кто что делал»: сводка обязана ответить, а не читать таблицу целиком. */
const MAX_ROWS = 20_000;
/** Сколько админов можно назвать при создании пространства. */
const MAX_NEW_ADMINS = 20;

const STATS_ROUTE = /^\/admin\/workspaces\/([^/]+)\/stats$/;
const WS_ROUTE = /^\/admin\/workspaces\/([^/]+)$/;

export type WorkspaceStats = {
  window_days: number;
  people: { total: number; pending: number; admins: number; active: number };
  /** Встречи: домашние пространства этого и «пришедшие» — видны здесь, но живут в другом. */
  meetings: { home: number; shared_in: number };
  /** Записи, кроме встреч. */
  entries: number;
  /** Задачи не закрыты и не в «бэклоге»: open, in_progress или без статуса. */
  tasks_open: number;
  /** Расход модели за окно, USD (по строкам с известной ценой); null — расход не читался. */
  model_spend_usd: number | null;
  /** Есть ли у пространства свой бот-записыватель (service_agents с токеном). */
  recorder_bot: { configured: boolean; active: boolean; last_seen_at: string | null };
};

type Db = SupabaseClient;

/** Страницами прочитать колонку чисел из запроса (с потолком). */
async function readPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`stats: ${(error as { message?: string }).message ?? "db"}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

async function count(q: PromiseLike<{ count: number | null; error: unknown }>, what: string): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(`stats ${what}: ${(error as { message?: string }).message ?? "db"}`);
  return n ?? 0;
}

/**
 * Сводка по пространству. «Активный человек» — тот, кто за последние STATS_WINDOW_DAYS дней:
 * держал открытым веб (`presence.last_seen_at`), менял статус задачи (`task_history`) или завёл
 * запись (`entries.owner_id`) — и состоит в этом пространстве сейчас. Присутствие пишется с
 * 09.10.2026, до него остаются два других источника.
 */
export async function workspaceStats(supabase: Db, wsId: string, now = new Date()): Promise<WorkspaceStats> {
  const since = new Date(now.getTime() - STATS_WINDOW_DAYS * DAY_MS).toISOString();

  const { data: members, error: mErr } = await supabase.from("allowed_users").select("telegram_id, is_admin").eq(
    "group_id",
    wsId,
  );
  if (mErr) throw new Error(`stats members: ${mErr.message}`);
  const rows = (members ?? []) as Array<{ telegram_id: number | null; is_admin: boolean | null }>;
  const memberIds = new Set(rows.filter((r) => r.telegram_id != null).map((r) => Number(r.telegram_id)));

  const [seen, moved, authors, meetingsHome, meetingsShared, entries, tasksOpen, usage, agents] = await Promise.all([
    readPages<{ telegram_id: number }>((a, b) =>
      supabase.from("presence").select("telegram_id").eq("group_id", wsId).gte("last_seen_at", since).range(a, b)
    ),
    readPages<{ changed_by_telegram_id: number }>((a, b) =>
      supabase.from("task_history").select("changed_by_telegram_id").eq("group_id", wsId).gte("created_at", since)
        .not("changed_by_telegram_id", "is", null).range(a, b)
    ),
    readPages<{ owner_id: number }>((a, b) =>
      onlyLiveEntries(supabase.from("entries").select("owner_id")).eq("group_id", wsId).gte("created_at", since)
        .not("owner_id", "is", null).range(a, b)
    ),
    count(
      onlyLiveEntries(supabase.from("entries").select("id", { count: "exact", head: true }))
        .eq("group_id", wsId).eq("entry_type", "meeting"),
      "meetings",
    ),
    count(
      // Пришедшие: видны здесь по признаку, домашнее — другое. Личные встречи круг не расширяют.
      onlyLiveEntries(supabase.from("entries").select("id", { count: "exact", head: true }))
        .contains("visible_group_ids", [wsId]).neq("group_id", wsId).eq("entry_type", "meeting").eq(
          "is_private",
          false,
        ),
      "shared meetings",
    ),
    count(
      onlyLiveEntries(supabase.from("entries").select("id", { count: "exact", head: true }))
        .eq("group_id", wsId).neq("entry_type", "meeting"),
      "entries",
    ),
    count(
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("group_id", wsId).is("archived_at", null)
        .or("status.is.null,status.in.(open,in_progress)"),
      "tasks",
    ),
    readPages<{ cost_usd: number | null }>((a, b) =>
      supabase.from("model_usage").select("cost_usd").eq("group_id", wsId).gte("created_at", since).range(a, b)
    ),
    supabase.from("service_agents").select("is_active, token_hash, last_seen_at").eq("group_id", wsId),
  ]);
  if (agents.error) throw new Error(`stats agents: ${agents.error.message}`);

  const activeIds = new Set<number>();
  for (
    const id of [
      ...seen.map((r) => r.telegram_id),
      ...moved.map((r) => r.changed_by_telegram_id),
      ...authors.map((r) => r.owner_id),
    ]
  ) {
    if (memberIds.has(Number(id))) activeIds.add(Number(id));
  }

  const agentRows =
    ((agents.data ?? []) as Array<{ is_active: boolean; token_hash: string | null; last_seen_at: string | null }>)
      .filter((a) => !!a.token_hash);
  const lastSeen = agentRows.map((a) => a.last_seen_at).filter((t): t is string => !!t).sort().pop() ?? null;

  return {
    window_days: STATS_WINDOW_DAYS,
    people: {
      total: rows.length,
      pending: rows.filter((r) => r.telegram_id == null).length,
      admins: rows.filter((r) => r.is_admin === true).length,
      active: activeIds.size,
    },
    meetings: { home: meetingsHome, shared_in: meetingsShared },
    entries,
    tasks_open: tasksOpen,
    model_spend_usd:
      Math.round(usage.reduce((s, r) => s + (typeof r.cost_usd === "number" ? r.cost_usd : 0), 0) * 100) / 100,
    recorder_bot: {
      configured: agentRows.length > 0,
      active: agentRows.some((a) => a.is_active),
      last_seen_at: lastSeen,
    },
  };
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const nameError = (message: string, origin: string) =>
  apiErr(400, message, origin, message.includes("длиннее") ? "name_too_long" : "name_required");

/** Строка allowed_users, которую затронет добавление по ссылке (тот же ключ, что у канона). */
async function findByRef(supabase: Db, ref: UserRef): Promise<{ group_id: string | null } | null> {
  const cols = "group_id";
  let q;
  if (ref.kind === "telegram") q = supabase.from("allowed_users").select(cols).eq("telegram_id", ref.telegramId);
  else if (ref.kind === "email") q = supabase.from("allowed_users").select(cols).eq("email", ref.email);
  else if (ref.kind === "username") {
    q = supabase.from("allowed_users").select(cols).ilike("username", escapeLike(normalizeUsername(ref.username)))
      .order("id");
  } else return null;
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(`admin lookup: ${error.message}`);
  return (data as { group_id: string | null } | null) ?? null;
}

/**
 * Админы нового пространства. Человек состоит ровно в одном пространстве, поэтому назвать можно
 * только НОВОГО человека (приглашение по почте, @username или Telegram ID): того, кто уже где-то
 * числится, создание не переносит — перенос с данными идёт отдельной операцией «Перенести в…».
 */
async function parseNewAdmins(
  supabase: Db,
  raw: unknown,
): Promise<{ refs: UserRef[] } | { error: string; code: string }> {
  if (raw == null) return { refs: [] };
  if (!Array.isArray(raw) || raw.length > MAX_NEW_ADMINS) {
    return { error: "admins: список ссылок, не более 20", code: "admins_invalid" };
  }
  const refs: UserRef[] = [];
  for (const item of raw) {
    const ref = typeof item === "string" ? parseUserRef(item) : { kind: "invalid" } as UserRef;
    if (ref.kind === "invalid") return { error: "admins: не разобрать ссылку на человека", code: "admins_invalid" };
    if (await findByRef(supabase, ref)) {
      return {
        error: "Этот человек уже состоит в пространстве — перенесите его кнопкой «Перенести в…»",
        code: "admin_in_other_workspace",
      };
    }
    refs.push(ref);
  }
  return { refs };
}

async function createRoute(supabase: Db, req: Request, actor: AdminActor, origin: string): Promise<Response> {
  if (!isSuperadmin(actor)) return apiErr(403, "Forbidden", origin);
  const body = await readBody(req);
  if (!body) return apiErr(400, "Invalid JSON", origin);
  const name = validateWorkspaceName(body.name);
  if (!name.ok) return nameError(name.message, origin);
  const countries = Array.isArray(body.countries) ? normalizeCountries(body.countries.map(String)) : [];
  // Всё, что может отказать по входным данным, — ДО записи: пространство не должно появляться наполовину.
  const admins = await parseNewAdmins(supabase, body.admins);
  if ("error" in admins) {
    return apiErr(admins.code === "admin_in_other_workspace" ? 409 : 400, admins.error, origin, admins.code);
  }

  const ws = await createWorkspace(supabase, { name: name.name, countries });
  for (const ref of admins.refs) {
    const r = await addUserToWorkspace(supabase, {
      telegramId: ref.kind === "telegram" ? ref.telegramId : null,
      username: ref.kind === "username" ? ref.username : null,
      email: ref.kind === "email" ? ref.email : null,
      workspaceId: ws.id,
      addedBy: actor.telegramId,
    });
    if (r.status !== "ok") {
      // Пространство уже создано и пригодно; не прошедшего админа сообщаем, а не откатываем всё.
      return json({ ...ws, user_count: 0, admins_failed: [r.status] }, 201, origin);
    }
    const flag = supabase.from("allowed_users").update({ is_admin: true }).eq("group_id", ws.id);
    const { error } = await (ref.kind === "telegram"
      ? flag.eq("telegram_id", ref.telegramId)
      : ref.kind === "email"
      ? flag.eq("email", ref.email)
      : flag.ilike("username", escapeLike(ref.kind === "username" ? ref.username : "")));
    if (error) {
      throw new Error(`workspace admin flag: ${error.message}`);
    }
  }
  return json({ ...ws, user_count: admins.refs.length }, 201, origin);
}

async function patchRoute(
  supabase: Db,
  req: Request,
  wsId: string,
  actor: AdminActor,
  origin: string,
): Promise<Response> {
  if (!canManageWorkspace(actor, wsId)) return apiErr(404, "Workspace not found", origin);
  const body = await readBody(req);
  if (!body) return apiErr(400, "Invalid JSON", origin);
  const fields: Record<string, unknown> = {};
  if ("name" in body) {
    const name = validateWorkspaceName(body.name);
    if (!name.ok) return nameError(name.message, origin);
    fields.name = name.name;
  }
  if ("allowed_markets" in body) {
    fields.allowed_markets = body.allowed_markets === null
      ? null
      : normalizeCountries((body.allowed_markets as string[]) ?? []);
  }
  if (!Object.keys(fields).length) return json({ ok: true }, 200, origin);
  const { error } = await supabase.from("workspaces").update(fields).eq("id", wsId);
  if (error) throw new Error(`workspace update: ${error.message}`);
  const { data } = await supabase.from("workspaces").select("id, name, allowed_markets").eq("id", wsId).single();
  return json(data, 200, origin);
}

export async function handleWorkspacesRoutes(
  supabase: Db,
  req: Request,
  routePath: string,
  actor: AdminActor,
  origin: string,
): Promise<Response | null> {
  try {
    if (req.method === "POST" && routePath === "/admin/workspaces") {
      return await createRoute(supabase, req, actor, origin);
    }
    const stats = routePath.match(STATS_ROUTE);
    if (stats && req.method === "GET") {
      if (!canManageWorkspace(actor, stats[1])) return apiErr(404, "Workspace not found", origin);
      const { data } = await supabase.from("workspaces").select("id, name").eq("id", stats[1]).maybeSingle();
      if (!data) return apiErr(404, "Workspace not found", origin);
      return json(
        { id: stats[1], name: (data as { name: string }).name, ...(await workspaceStats(supabase, stats[1])) },
        200,
        origin,
      );
    }
    const ws = routePath.match(WS_ROUTE);
    if (ws && req.method === "PATCH") return await patchRoute(supabase, req, ws[1], actor, origin);
    return null;
  } catch (e) {
    return serverError(origin, "admin: workspaces", e);
  }
}
