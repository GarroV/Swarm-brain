// Приглашение бота на созвон из веба (решение D017): «вставь ссылку — бот постучится».
//
// Человек своей обычной авторизацией веба (JWT / initData — её уже проверил index.ts) вставляет
// ссылку на звонок. Сервер заводит одноразовое приглашение: кто позвал, воркспейс, ссылка, срок.
// Оркестратор забирает его (функция meeting-invite), бот предъявляет его в meeting-claim.
//
//   POST /meeting-invites      { "join_url": "https://meet.google.com/abc-defg-hij" }
//        201 { invite: InviteView }         — заведено
//        200 { invite: InviteView }         — та же ссылка уже ждёт бота: отдаём её же, не дубль
//        400 invalid_link · 403 demo_not_allowed · 429 too_many_invites
//   GET  /meeting-invites/:id  200 { invite: InviteView } — только своё; чужое и несуществующее — 404
//
//   InviteView = { id, join_url, platform: "meet"|"kontur"|"zoom", status: "pending"|"taken"|
//                  "used"|"expired", created_at, expires_at, meeting_id: string|null }
//   Ошибка     = { error: <EN>, error_ru: <RU>, code: <код> } — веб показывает по коду на своём языке.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { INVITE_TTL_MS, type InviteRow, inviteStatus, parseInviteLink } from "../_shared/meeting-invite.ts";
import { json } from "./http.ts";

/** Сколько живых приглашений держит один человек: больше — это уже рассылка бота по ссылкам. */
export const MAX_ACTIVE_INVITES = 3;

const COLUMNS = "id, group_id, invited_by, join_url, platform, created_at, expires_at, taken_at, used_at, meeting_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERRORS = {
  invalid_link: {
    status: 400,
    en: "Paste a link to a Google Meet, Kontur.Talk or Zoom call",
    ru: "Вставьте ссылку на звонок Google Meet, Контур.Толк или Zoom",
  },
  demo_not_allowed: {
    status: 403,
    en: "The bot cannot be invited from the demo",
    ru: "В демо бота позвать нельзя",
  },
  too_many_invites: {
    status: 429,
    en: `You already have ${MAX_ACTIVE_INVITES} invites waiting — wait for the bot or try again in a few minutes`,
    ru: `У вас уже ${MAX_ACTIVE_INVITES} приглашения ждут бота — дождитесь его или повторите через несколько минут`,
  },
  not_found: { status: 404, en: "Invite not found", ru: "Приглашение не найдено" },
} as const;

type ErrorCode = keyof typeof ERRORS;

function inviteErr(code: ErrorCode, origin: string): Response {
  const e = ERRORS[code];
  return json({ error: e.en, error_ru: e.ru, code }, e.status, origin);
}

function view(row: InviteRow, nowMs: number) {
  return {
    id: row.id,
    join_url: row.join_url,
    platform: row.platform,
    status: inviteStatus(row, nowMs),
    created_at: row.created_at,
    expires_at: row.expires_at,
    meeting_id: row.meeting_id,
  };
}

export interface InviteContext {
  supabase: SupabaseClient;
  telegramId: number;
  groupId: string;
  isDemo: boolean;
  origin: string;
}

async function createInvite(ctx: InviteContext, req: Request): Promise<Response> {
  if (ctx.isDemo) return inviteErr("demo_not_allowed", ctx.origin);
  let raw: unknown;
  try {
    raw = ((await req.json()) as { join_url?: unknown }).join_url;
  } catch {
    return inviteErr("invalid_link", ctx.origin);
  }
  const link = parseInviteLink(raw);
  if (!link) return inviteErr("invalid_link", ctx.origin);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const { data: active, error: listErr } = await ctx.supabase
    .from("meeting_invites")
    .select(COLUMNS)
    .eq("invited_by", ctx.telegramId)
    .eq("group_id", ctx.groupId)
    .is("used_at", null)
    .gt("expires_at", nowIso);
  if (listErr) return json({ error: `invite lookup failed: ${listErr.message}` }, 500, ctx.origin);
  const rows = (active ?? []) as InviteRow[];

  // Вставил ту же ссылку ещё раз, пока бот не пришёл, — это то же приглашение, а не второе.
  const same = rows.find((r) => parseInviteLink(r.join_url)?.room === link.room);
  if (same) return json({ invite: view(same, nowMs) }, 200, ctx.origin);
  if (rows.length >= MAX_ACTIVE_INVITES) return inviteErr("too_many_invites", ctx.origin);

  const { data, error } = await ctx.supabase
    .from("meeting_invites")
    .insert({
      group_id: ctx.groupId,
      invited_by: ctx.telegramId,
      join_url: link.url,
      platform: link.platform,
      created_at: nowIso,
      expires_at: new Date(nowMs + INVITE_TTL_MS).toISOString(),
    })
    .select(COLUMNS)
    .single();
  if (error || !data) return json({ error: `invite create failed: ${error?.message ?? "unknown"}` }, 500, ctx.origin);
  console.log(`swarm-api: приглашение ${(data as InviteRow).id} от ${ctx.telegramId} (${link.platform})`);
  return json({ invite: view(data as InviteRow, nowMs) }, 201, ctx.origin);
}

async function readInvite(ctx: InviteContext, id: string): Promise<Response> {
  if (!UUID.test(id)) return inviteErr("not_found", ctx.origin);
  const { data, error } = await ctx.supabase
    .from("meeting_invites")
    .select(COLUMNS)
    .eq("id", id)
    .eq("invited_by", ctx.telegramId)
    .eq("group_id", ctx.groupId)
    .maybeSingle();
  if (error) return json({ error: `invite lookup failed: ${error.message}` }, 500, ctx.origin);
  if (!data) return inviteErr("not_found", ctx.origin);
  return json({ invite: view(data as InviteRow, Date.now()) }, 200, ctx.origin);
}

export async function handleMeetingInviteRoutes(
  ctx: InviteContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  if (routePath === "/meeting-invites" && req.method === "POST") return await createInvite(ctx, req);
  const match = routePath.match(/^\/meeting-invites\/([^/]+)$/);
  if (match && req.method === "GET") return await readInvite(ctx, match[1]);
  return null;
}
