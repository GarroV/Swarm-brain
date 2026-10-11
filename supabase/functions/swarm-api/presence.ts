import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, corsHeaders, json } from "./http.ts";
import { resolvePersonNames } from "../_shared/users/display-name.ts";

// Присутствие (#751): кто, где, что и когда делает в вебе. БЕЗ вывода на экран — данные только
// для админа через GET /presence. Канон схемы — миграция 20261009140000_presence.sql.
//
// Роуты: POST /presence (пульс любого вошедшего), GET /presence (только админ).
// Возвращает null, если путь не про присутствие.

/** Раздел — короткий путь вида «tasks/mine/today» или «meetings/meetingdetail» (собирает веб). */
const SECTION_RE = /^[a-z0-9_\-/]{1,40}$/;
/** Пульс веба раз в 30 с; три пропущенных — человека в системе нет. */
const ONLINE_WINDOW_MS = 90_000;
const LOG_MINUTES_DEFAULT = 60;
const LOG_MINUTES_MAX = 1440;
const LOG_ROWS_MAX = 5000;

export type PresenceState = "active" | "idle" | "away";

/** Тело пульса → раздел и состояние. Строка — текст ошибки для 400. */
export function parsePing(body: unknown): { section: string; state: PresenceState } | string {
  if (!body || typeof body !== "object") return "Invalid body";
  const b = body as Record<string, unknown>;
  const section = typeof b.section === "string" ? b.section : "";
  if (!SECTION_RE.test(section)) return "Invalid section";
  if (b.active !== undefined && typeof b.active !== "boolean") return "Invalid active";
  if (b.away !== undefined && typeof b.away !== "boolean") return "Invalid away";
  // Состояние считает сервер: клиент сообщает факты, а не выбирает себе статус.
  const state: PresenceState = b.away === true ? "away" : b.active === true ? "active" : "idle";
  return { section, state };
}

/** ?minutes= → окно журнала в минутах (1…1440, по умолчанию 60). */
export function parseLogMinutes(raw: string | null): number {
  const n = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < 1) return LOG_MINUTES_DEFAULT;
  return Math.min(Math.floor(n), LOG_MINUTES_MAX);
}

type PresenceRow = {
  telegram_id: number;
  group_id: string;
  section: string;
  state: PresenceState;
  last_seen_at: string;
  since: string;
};

type LogRow = {
  telegram_id: number;
  group_id: string;
  section: string;
  state: PresenceState;
  at: string;
};

/** Кто сейчас в системе: свежий пульс и вкладка не скрыта. */
export function isOnline(row: Pick<PresenceRow, "state" | "last_seen_at">, now: number): boolean {
  return row.state !== "away" && now - Date.parse(row.last_seen_at) < ONLINE_WINDOW_MS;
}

async function readPresence(
  supabase: SupabaseClient,
  scopeGroup: string | null,
  minutes: number,
  origin: string,
): Promise<Response> {
  const now = Date.now();
  const sinceIso = new Date(now - minutes * 60_000).toISOString();
  const onlineIso = new Date(now - ONLINE_WINDOW_MS).toISOString();

  let nowQ = supabase.from("presence")
    .select("telegram_id, group_id, section, state, last_seen_at, since")
    .gte("last_seen_at", onlineIso).neq("state", "away");
  let logQ = supabase.from("presence_log")
    .select("telegram_id, group_id, section, state, at")
    .gte("at", sinceIso).order("at", { ascending: false }).limit(LOG_ROWS_MAX);
  if (scopeGroup) {
    nowQ = nowQ.eq("group_id", scopeGroup);
    logQ = logQ.eq("group_id", scopeGroup);
  }
  const [nowRes, logRes] = await Promise.all([nowQ, logQ]);
  if (nowRes.error || logRes.error) {
    console.error("presence: чтение", nowRes.error?.message ?? logRes.error?.message);
    return apiErr(500, "Could not read presence", origin);
  }
  const online = ((nowRes.data ?? []) as PresenceRow[]).filter((r) => isOnline(r, now));
  const log = (logRes.data ?? []) as LogRow[];
  const names = await resolvePersonNames(supabase, [
    ...online.map((r) => r.telegram_id),
    ...log.map((r) => r.telegram_id),
  ]);
  const name = (tg: number) => names.get(tg) ?? String(tg);

  return json(
    {
      now: online
        .sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
        .map((r) => ({ ...r, name: name(r.telegram_id) })),
      log: log.map((r) => ({ ...r, name: name(r.telegram_id) })),
      minutes,
      truncated: log.length >= LOG_ROWS_MAX,
    },
    200,
    origin,
  );
}

export async function handlePresenceRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  ctx: {
    telegramId: number;
    groupId: string;
    isAdmin: boolean;
    isSuperadmin: boolean;
    isDemo: boolean;
  },
  origin: string,
): Promise<Response | null> {
  if (routePath !== "/presence") return null;

  if (req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiErr(400, "Invalid JSON", origin);
    }
    const parsed = parsePing(body);
    if (typeof parsed === "string") return apiErr(400, parsed, origin);
    // Демо-сессия — одна на всех зрителей витрины: её «присутствие» ничего не говорит.
    if (ctx.isDemo) return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const { error } = await supabase.rpc("presence_ping", {
      p_tg: ctx.telegramId,
      p_group: ctx.groupId,
      p_section: parsed.section,
      p_state: parsed.state,
    });
    if (error) {
      console.error("presence: пульс не записан", ctx.telegramId, error.message);
      return apiErr(500, "Could not record presence", origin);
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method === "GET") {
    if (!ctx.isAdmin) return apiErr(403, "Forbidden", origin);
    const minutes = parseLogMinutes(new URL(req.url).searchParams.get("minutes"));
    // Объём как у админских маршрутов: админ — свой воркспейс, суперадмин — все (admin-scope.ts).
    return readPresence(supabase, ctx.isSuperadmin ? null : ctx.groupId, minutes, origin);
  }

  return apiErr(405, "Method not allowed", origin);
}
