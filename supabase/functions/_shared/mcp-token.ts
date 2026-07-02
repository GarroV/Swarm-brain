// Общий модуль MCP-токена (Claude Desktop). Единый источник для бота (/setup, /mytoken)
// и swarm-api (веб «Настройки → Claude Desktop»). Функции принимают supabase-клиент.
//
// MCP-токен — для подключения Claude Desktop к базе знаний через swarm-mcp. Отдельный от
// токена рекордера (recorder-token.ts). Бессрочный: expires_at = null (swarm-mcp трактует
// null как «без срока»). Хранится только sha256-хэшем в allowed_users.claude_mcp_token_hash.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SETUP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-setup";

export interface MintedToken {
  token: string;
}

// Минтит новый бессрочный smcp_-токен, перезаписывая старый (старый сразу мёртв). null при ошибке.
export async function mintMcpToken(supabase: SupabaseClient, telegramId: number): Promise<MintedToken | null> {
  // Без дефисов: на десктоп-Telegram двойной клик по <code> выделяет «слово» до дефиса.
  const token = "smcp_" + crypto.randomUUID().replaceAll("-", "");
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const { error } = await supabase
    .from("allowed_users")
    .update({ claude_mcp_token_hash: hashHex, claude_mcp_token_expires_at: null })
    .eq("telegram_id", telegramId);
  if (error) return null;
  return { token };
}

// Статус MCP-токена: активен ли + срок (у бессрочного expiresAt = null).
export async function getMcpTokenStatus(
  supabase: SupabaseClient,
  telegramId: number,
): Promise<{ active: boolean; expiresAt: string | null }> {
  const { data } = await supabase
    .from("allowed_users")
    .select("claude_mcp_token_hash, claude_mcp_token_expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return { active: false, expiresAt: null };
  const row = data as { claude_mcp_token_hash: string | null; claude_mcp_token_expires_at: string | null };
  const active =
    !!row.claude_mcp_token_hash &&
    (!row.claude_mcp_token_expires_at || Date.parse(row.claude_mcp_token_expires_at) >= Date.now());
  return { active, expiresAt: row.claude_mcp_token_expires_at };
}

export async function hasActiveMcpToken(supabase: SupabaseClient, telegramId: number): Promise<boolean> {
  return (await getMcpTokenStatus(supabase, telegramId)).active;
}

// Однострочник для Терминала с уже вшитым токеном (Claude Desktop).
export function buildSetupOneLiner(token: string): string {
  return `curl -fsSL ${SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}
