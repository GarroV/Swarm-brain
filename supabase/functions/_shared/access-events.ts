// Журнал событий доступа (#797): вход в веб, обмен токена на веб-доступ, «выйти везде», выпуск и
// отзыв токенов MCP и рекордера. Таблица access_events — миграция 20261012160000.
//
// Запись — best effort: сбой журнала не должен ронять вход или выпуск токена, поэтому ошибка
// уходит в console.error и дальше не идёт. Секретов сюда не пишем — только факт, канал и откуда.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AccessKind =
  | "web_login"
  | "web_access_exchanged"
  | "sessions_revoked"
  | "mcp_token_issued"
  | "mcp_token_revoked"
  | "recorder_token_issued"
  | "recorder_token_revoked";

/** Канал события и, если есть, сам запрос — из него берутся адрес и страна. */
export interface AccessContext {
  via: string;
  req?: Request;
}

/**
 * Откуда пришёл запрос — СЫРЫЕ заголовки, не доказательство. Левый адрес x-forwarded-for клиент
 * может прислать сам, а какие звенья добавляют прокси (Cloudflare Pages → Supabase) мы не
 * сверяли, поэтому пишем всю цепочку как есть и не выбираем «настоящий» адрес за читателя.
 */
export function requestOrigin(req?: Request): { ip: string | null; country: string | null } {
  if (!req) return { ip: null, country: null };
  const chain = [req.headers.get("x-forwarded-for"), req.headers.get("cf-connecting-ip")]
    .filter((v): v is string => !!v && v.trim() !== "")
    .map((v) => v.trim())
    .join(" | ");
  const country = req.headers.get("cf-ipcountry") || null;
  return { ip: chain ? chain.slice(0, 256) : null, country: country ? country.slice(0, 8) : null };
}

export async function logAccess(
  supabase: SupabaseClient,
  telegramId: number,
  kind: AccessKind,
  ctx: AccessContext,
  sessionAuthTime?: number,
): Promise<void> {
  try {
    const { ip, country } = requestOrigin(ctx.req);
    const row = {
      telegram_id: telegramId,
      kind,
      via: ctx.via,
      ip,
      country,
      session_auth_time: sessionAuthTime ?? null,
    };
    // Вход пишется один раз на сессию: повтор той же сессии упирается в уникальный индекс.
    const { error } = kind === "web_login"
      ? await supabase.from("access_events").upsert(row, {
        onConflict: "telegram_id,session_auth_time",
        ignoreDuplicates: true,
      })
      : await supabase.from("access_events").insert(row);
    if (error) console.error("access_events:", kind, telegramId, error.message);
  } catch (e) {
    console.error("access_events:", kind, telegramId, e);
  }
}

// Вход замечается в swarm-api по первому запросу новой сессии. Чтобы не писать в базу на каждый
// запрос экрана, инстанс помнит уже записанные сессии; холодный старт — максимум ещё одна попытка,
// которую отсечёт уникальный индекс.
const seenLogins = new Set<string>();
const SEEN_LIMIT = 5000;

export function isNewLogin(telegramId: number, authTime: number): boolean {
  const key = `${telegramId}:${authTime}`;
  if (seenLogins.has(key)) return false;
  if (seenLogins.size >= SEEN_LIMIT) seenLogins.clear();
  seenLogins.add(key);
  return true;
}
