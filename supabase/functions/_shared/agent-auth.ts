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

  // Принимаем ЛЮБОЙ из двух токенов: отдельный токен рекордера (/recordertoken) ИЛИ
  // общий MCP-токен (/mytoken). Так перевыпуск MCP-токена в Claude Desktop не ломает рекордер.
  const { data } = await supabase
    .from("allowed_users")
    .select("telegram_id, group_id, claude_mcp_token_hash, claude_mcp_token_expires_at, recorder_token_hash, recorder_token_expires_at")
    .or(`claude_mcp_token_hash.eq.${hashHex},recorder_token_hash.eq.${hashHex}`)
    .maybeSingle();

  if (!data) throw new AgentAuthError(401, "Unauthorized");

  const row = data as {
    telegram_id: number;
    group_id: string | null;
    claude_mcp_token_hash: string | null;
    claude_mcp_token_expires_at: string | null;
    recorder_token_hash: string | null;
    recorder_token_expires_at: string | null;
  };

  const isRecorder = row.recorder_token_hash === hashHex;
  const expiresAt = isRecorder ? row.recorder_token_expires_at : row.claude_mcp_token_expires_at;
  if (expiresAt && Date.parse(expiresAt) < Date.now()) {
    throw new AgentAuthError(401, "Token expired — get a fresh one in the bot (/recordertoken)");
  }

  return { telegramId: row.telegram_id, groupId: row.group_id };
}
