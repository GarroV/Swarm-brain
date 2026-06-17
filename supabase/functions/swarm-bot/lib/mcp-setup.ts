import { supabase } from "./supabase.ts";

// Авто-сетап Claude Desktop: минт MCP-токена и сборка команды установки.
// Токен хранится только sha256-хэшем в allowed_users.claude_mcp_token_hash;
// plaintext отдаётся пользователю один раз (в /mytoken и /setup).

export const TOKEN_TTL_DAYS = 90;

const SETUP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-setup";

export interface MintedToken {
  token: string;
  expiresAt: Date;
}

// Минтит новый smcp_-токен для пользователя, перезаписывая старый (старый сразу мёртв).
// Возвращает null при ошибке записи в БД.
export async function mintMcpToken(telegramId: number): Promise<MintedToken | null> {
  // Без дефисов: на десктоп-Telegram двойной клик по <code> выделяет «слово» до дефиса.
  const token = "smcp_" + crypto.randomUUID().replaceAll("-", "");
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await supabase
    .from("allowed_users")
    .update({ claude_mcp_token_hash: hashHex, claude_mcp_token_expires_at: expiresAt.toISOString() })
    .eq("telegram_id", telegramId);
  if (error) return null;
  return { token, expiresAt };
}

// Однострочник для Терминала с уже вшитым токеном.
export function buildSetupOneLiner(token: string): string {
  return `curl -fsSL ${SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}
