// Общий модуль MCP-токена (Claude Desktop). Единый источник для бота (/setup, /mytoken)
// и swarm-api (веб «Настройки → Claude Desktop»). Функции принимают supabase-клиент.
//
// MCP-токен — для подключения Claude Desktop к базе знаний через swarm-mcp. Отдельный от
// токена рекордера (recorder-token.ts). Живёт 30 дней (MCP_TOKEN_TTL_DAYS): expires_at пишется
// при выпуске, swarm-mcp сверяет его на каждый вызов. Хранится только sha256-хэшем в
// allowed_users.claude_mcp_token_hash. Гасит токен и триггер БД при смене воркспейса/роли.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type AccessContext, logAccess } from "./access-events.ts";
import { FUNCTIONS_BASE_URL } from "./public-url.ts";

export const SETUP_URL = `${FUNCTIONS_BASE_URL}/swarm-setup`;

/** Срок жизни MCP-токена (стандарт MCP-сервера: 30 дней). */
export const MCP_TOKEN_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Момент истечения токена, выпущенного в `nowMs`. */
export function mcpTokenExpiry(nowMs: number = Date.now()): string {
  return new Date(nowMs + MCP_TOKEN_TTL_DAYS * DAY_MS).toISOString();
}

export interface MintedToken {
  token: string;
}

// Минтит новый smcp_-токен на 30 дней, перезаписывая старый (старый сразу мёртв). null при ошибке.
export async function mintMcpToken(
  supabase: SupabaseClient,
  telegramId: number,
  ctx: AccessContext = { via: "unknown" },
): Promise<MintedToken | null> {
  // Без дефисов: на десктоп-Telegram двойной клик по <code> выделяет «слово» до дефиса.
  const token = "smcp_" + crypto.randomUUID().replaceAll("-", "");
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const { error } = await supabase
    .from("allowed_users")
    .update({ claude_mcp_token_hash: hashHex, claude_mcp_token_expires_at: mcpTokenExpiry() })
    .eq("telegram_id", telegramId);
  if (error) return null;
  await logAccess(supabase, telegramId, "mcp_token_issued", ctx);
  return { token };
}

// Статус MCP-токена: активен ли + срок (expiresAt = null у токена без срока — такие остались только до миграции 20261027120000).
export async function getMcpTokenStatus(
  supabase: SupabaseClient,
  telegramId: number,
): Promise<{ active: boolean; expiresAt: string | null; lastSeenAt: string | null }> {
  const { data } = await supabase
    .from("allowed_users")
    .select("claude_mcp_token_hash, claude_mcp_token_expires_at, mcp_last_seen_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return { active: false, expiresAt: null, lastSeenAt: null };
  const row = data as {
    claude_mcp_token_hash: string | null;
    claude_mcp_token_expires_at: string | null;
    mcp_last_seen_at: string | null;
  };
  const active = !!row.claude_mcp_token_hash &&
    (!row.claude_mcp_token_expires_at || Date.parse(row.claude_mcp_token_expires_at) >= Date.now());
  return { active, expiresAt: row.claude_mcp_token_expires_at, lastSeenAt: row.mcp_last_seen_at };
}

export async function hasActiveMcpToken(supabase: SupabaseClient, telegramId: number): Promise<boolean> {
  return (await getMcpTokenStatus(supabase, telegramId)).active;
}

// Однострочник для Терминала с уже вшитым токеном (Claude Desktop).
export function buildSetupOneLiner(token: string): string {
  return `curl -fsSL ${SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}
