import { supabase } from "./supabase.ts";

// Авто-сетап Claude Desktop: минт MCP-токена и сборка команды установки.
// Токен хранится только sha256-хэшем в allowed_users.claude_mcp_token_hash;
// plaintext отдаётся пользователю один раз (в /mytoken и /setup).

const SETUP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-setup";

export interface MintedToken {
  token: string;
}

// Минтит новый бессрочный smcp_-токен, перезаписывая старый (старый сразу мёртв).
// expires_at = null → swarm-mcp трактует как «без срока» (см. swarm-mcp/index.ts).
// Возвращает null при ошибке записи в БД.
export async function mintMcpToken(telegramId: number): Promise<MintedToken | null> {
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

// Есть ли у пользователя уже активный (непротухший) MCP-токен.
// Нужно, чтобы /mytoken не убивал молча рабочий конфиг — сначала предупреждаем.
export async function hasActiveMcpToken(telegramId: number): Promise<boolean> {
  const { data } = await supabase
    .from("allowed_users")
    .select("claude_mcp_token_hash, claude_mcp_token_expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return false;
  const row = data as { claude_mcp_token_hash: string | null; claude_mcp_token_expires_at: string | null };
  if (!row.claude_mcp_token_hash) return false;
  if (row.claude_mcp_token_expires_at && Date.parse(row.claude_mcp_token_expires_at) < Date.now()) return false;
  return true;
}

// Однострочник для Терминала с уже вшитым токеном.
export function buildSetupOneLiner(token: string): string {
  return `curl -fsSL ${SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}
