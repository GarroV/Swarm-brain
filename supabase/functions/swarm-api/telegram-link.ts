// POST /telegram/link — одноразовая ссылка привязки Telegram для вошедшего по почте (issue #92).
// Код и правила — _shared/telegram-link.ts; привязку завершает бот по `/start link_<код>`.
// Ответ: { url, expires_at }. Ошибка = { error: <EN>, error_ru: <RU>, code } ·
//   403 demo_not_allowed · 409 already_linked · 502 bot_unavailable.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { externalFetch, VIA_TELEGRAM } from "../_shared/external-fetch.ts";
import { hashLinkCode, linkDeepLink, linkExpiresAt, newLinkCode } from "../_shared/telegram-link.ts";

export const TELEGRAM_LINK_PATH = "/telegram/link";

const ERRORS = {
  demo_not_allowed: {
    status: 403,
    en: "Telegram cannot be linked in the demo",
    ru: "В демо Telegram не привязывается",
  },
  already_linked: { status: 409, en: "Telegram is already linked", ru: "Telegram уже привязан" },
  bot_unavailable: { status: 502, en: "The bot is unavailable, try again later", ru: "Бот недоступен, попробуй позже" },
} as const;

function linkErr(code: keyof typeof ERRORS, origin: string): Response {
  const e = ERRORS[code];
  return json({ error: e.en, error_ru: e.ru, code }, e.status, origin);
}

let botUsername: string | null = null;
async function getBotUsername(token: string): Promise<string | null> {
  if (botUsername) return botUsername;
  const res = await externalFetch(`https://api.telegram.org/bot${token}/getMe`, {}, VIA_TELEGRAM);
  if (!res.ok) return null;
  const body = await res.json() as { result?: { username?: string } };
  botUsername = body.result?.username ?? null;
  return botUsername;
}

export interface TelegramLinkContext {
  supabase: SupabaseClient;
  telegramId: number;
  isDemo: boolean;
  botToken: string;
  origin: string;
}

export async function handleTelegramLinkRoutes(
  ctx: TelegramLinkContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  if (req.method !== "POST" || routePath !== TELEGRAM_LINK_PATH) return null;
  if (ctx.isDemo) return linkErr("demo_not_allowed", ctx.origin);
  try {
    const { data: row, error } = await ctx.supabase.from("allowed_users")
      .select("id, telegram_id, telegram_chat_id").eq("telegram_id", ctx.telegramId).maybeSingle();
    if (error) throw new Error(`allowed_users: ${error.message}`);
    const r = row as { id: number; telegram_id: number; telegram_chat_id: number | null } | null;
    if (!r) throw new Error("allowed_users row missing for session");
    if (r.telegram_id > 0 || r.telegram_chat_id) return linkErr("already_linked", ctx.origin);

    const username = await getBotUsername(ctx.botToken);
    if (!username) return linkErr("bot_unavailable", ctx.origin);

    const code = newLinkCode();
    const expiresAt = linkExpiresAt(new Date());
    const { error: upErr } = await ctx.supabase.from("allowed_users")
      .update({ telegram_link_code_hash: await hashLinkCode(code), telegram_link_expires_at: expiresAt })
      .eq("id", r.id);
    if (upErr) throw new Error(`allowed_users update: ${upErr.message}`);
    return json({ url: linkDeepLink(username, code), expires_at: expiresAt }, 200, ctx.origin);
  } catch (e) {
    return serverError(ctx.origin, "telegram link", e);
  }
}
