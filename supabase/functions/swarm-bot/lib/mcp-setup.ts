import { supabase } from "./supabase.ts";

// Авто-сетап Claude Desktop: минт MCP-токена и сборка команды установки.
// Токен хранится только sha256-хэшем в allowed_users.claude_mcp_token_hash;
// plaintext отдаётся пользователю один раз (в /mytoken и /setup).

const SETUP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-setup";
const RECORDER_SETUP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-recorder-setup";

export interface MintedToken {
  token: string;
}

export interface MintedRecorderToken {
  token: string;
  expiresAt: Date;
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

// Минтит отдельный токен для рекордера встреч (recorder_token_hash), независимый от
// claude_mcp_token (/mytoken, /setup). Перевыпуск MCP-токена рекордер не трогает и наоборот.
// expires_at выставляется явно (TTL по умолчанию 365 дней) — рекордер уважает срок.
// Возвращает null при ошибке записи в БД. Plaintext отдаётся один раз.
export async function mintRecorderToken(
  telegramId: number,
  ttlDays = 365,
): Promise<MintedRecorderToken | null> {
  // Без дефисов: на десктоп-Telegram двойной клик по <code> выделяет «слово» до дефиса.
  const token = "smcp_" + crypto.randomUUID().replaceAll("-", "");
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const { error } = await supabase
    .from("allowed_users")
    .update({ recorder_token_hash: hashHex, recorder_token_expires_at: expiresAt.toISOString() })
    .eq("telegram_id", telegramId);
  if (error) return null;
  return { token, expiresAt };
}

// Есть ли у пользователя уже активный (непротухший) токен рекордера.
// Нужно, чтобы /recordertoken не убивал молча рабочую авторизацию рекордера — сначала предупреждаем.
export async function hasActiveRecorderToken(telegramId: number): Promise<boolean> {
  const { data } = await supabase
    .from("allowed_users")
    .select("recorder_token_hash, recorder_token_expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return false;
  const row = data as { recorder_token_hash: string | null; recorder_token_expires_at: string | null };
  if (!row.recorder_token_hash) return false;
  if (row.recorder_token_expires_at && Date.parse(row.recorder_token_expires_at) < Date.now()) return false;
  return true;
}

// Однострочник для Терминала с уже вшитым токеном.
export function buildSetupOneLiner(token: string): string {
  return `curl -fsSL ${SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}

// Однострочник для Терминала: ставит и настраивает рекордер встреч с уже вшитым токеном.
export function buildRecorderSetupOneLiner(token: string): string {
  return `curl -fsSL ${RECORDER_SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}
