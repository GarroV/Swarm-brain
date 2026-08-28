import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Аутентификация desktop-агента по персональному токену.
// Зеркалит механизм swarm-mcp: токен → sha256-hex → allowed_users.claude_mcp_token_hash
// → telegram_id, с проверкой срока (claude_mcp_token_expires_at). Личность и воркспейс
// берутся ИЗ ТОКЕНА, не из payload — это закрывает спуфинг owner_telegram_id.
//
// MVP переиспользует тот же smcp_-токен (TTL 90 дней). Долгоживущий agent-токен —
// отдельной задачей (см. transcribator/10-REVISED-DESIGN.md §6, §9).

export class AgentAuthError extends Error {
  constructor(public readonly status: 401, message: string) {
    super(message);
    this.name = "AgentAuthError";
  }
}

export interface AgentIdentity {
  telegramId: number;
  groupId: string | null;
}

// Какой именно токен предъявили и не истёк ли он. Вынесено чистой функцией: ветки «предыдущий
// токен ещё в перекрытии» и «перекрытие истекло» иначе не проверить без живой базы.
export interface TokenRow {
  claude_mcp_token_hash: string | null;
  claude_mcp_token_expires_at: string | null;
  recorder_token_hash: string | null;
  recorder_token_expires_at: string | null;
  recorder_token_prev_hash: string | null;
  recorder_token_prev_expires_at: string | null;
}

export type TokenKind = "recorder" | "recorder_prev" | "mcp" | "none";

export function classifyToken(
  hashHex: string,
  row: TokenRow,
  now: number = Date.now(),
): { kind: TokenKind; expired: boolean } {
  const kind: TokenKind = row.recorder_token_hash === hashHex
    ? "recorder"
    : row.recorder_token_prev_hash === hashHex
    ? "recorder_prev"
    : row.claude_mcp_token_hash === hashHex
    ? "mcp"
    : "none";
  if (kind === "none") return { kind, expired: false };
  const expiresAt = kind === "recorder"
    ? row.recorder_token_expires_at
    : kind === "recorder_prev"
    ? row.recorder_token_prev_expires_at
    : row.claude_mcp_token_expires_at;
  return { kind, expired: !!expiresAt && Date.parse(expiresAt) < now };
}

export async function verifyAgentToken(
  supabase: SupabaseClient,
  req: Request,
): Promise<AgentIdentity> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new AgentAuthError(401, "Missing bearer token");
  }
  const token = authHeader.slice(7).trim();

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Принимаем ЛЮБОЙ из трёх: отдельный токен рекордера (/recordertoken), его ПРЕДЫДУЩИЙ на время
  // перевыпуска (перекрытие, см. _shared/recorder-token.ts) ИЛИ общий MCP-токен (/mytoken).
  // Перекрытие нужно, чтобы перевыпуск не убивал рабочую установку в тот же миг: рекордер писал
  // встречи и молча не мог их залить, если человек не дошёл до конца установки (issue #146).
  const { data } = await supabase
    .from("allowed_users")
    .select("telegram_id, group_id, claude_mcp_token_hash, claude_mcp_token_expires_at, recorder_token_hash, recorder_token_expires_at, recorder_token_prev_hash, recorder_token_prev_expires_at")
    .or(`claude_mcp_token_hash.eq.${hashHex},recorder_token_hash.eq.${hashHex},recorder_token_prev_hash.eq.${hashHex}`)
    .maybeSingle();

  if (!data) throw new AgentAuthError(401, "Unauthorized");

  const row = data as {
    telegram_id: number;
    group_id: string | null;
    claude_mcp_token_hash: string | null;
    claude_mcp_token_expires_at: string | null;
    recorder_token_hash: string | null;
    recorder_token_expires_at: string | null;
    recorder_token_prev_hash: string | null;
    recorder_token_prev_expires_at: string | null;
  };

  const { kind, expired } = classifyToken(hashHex, row);
  if (kind === "none") throw new AgentAuthError(401, "Unauthorized");
  if (expired) {
    throw new AgentAuthError(401, "Token expired — get a fresh one in the bot (/recordertoken)");
  }

  // Новый токен заработал → перекрытие больше не нужно, гасим его немедленно. Так окно живёт
  // минуты (пока человек несёт токен до рекордера), а не заявленные сутки: чем короче окно, тем
  // меньше оно мешает заметить украденный токен.
  if (kind === "recorder" && row.recorder_token_prev_hash) {
    await supabase
      .from("allowed_users")
      .update({ recorder_token_prev_hash: null, recorder_token_prev_expires_at: null })
      .eq("telegram_id", row.telegram_id);
  }

  return { telegramId: row.telegram_id, groupId: row.group_id };
}
