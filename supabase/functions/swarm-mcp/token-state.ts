// Состояние токена коннектора: годен ли он СЕЙЧАС. Правило чистое (без БД и сети), проверяется
// token-state.test.ts; index.ts только подставляет найденную по хэшу строку.
//
// Токен живёт 30 дней (_shared/mcp-token.ts), срок сверяется на КАЖДЫЙ вызов, а триггер БД гасит
// хэш при смене воркспейса или роли — поэтому «не найден» и «протух» для человека одно и то же:
// выпусти новый. Подсказка ведёт в Настройки веба, а не в бота: бот ключи больше не выдаёт (#1061).
// Fail-closed: строка без срока или с нечитаемым сроком — не годный токен.

export const TOKEN_EXPIRED_MESSAGE =
  "Token expired — open Swarm in the browser → Settings → Claude Desktop and issue a new token";
export const TOKEN_INVALID_MESSAGE =
  "Token revoked or not recognised — open Swarm in the browser → Settings → Claude Desktop and issue a new token";

export interface TokenRow {
  telegram_id: number;
  claude_mcp_token_expires_at: string | null;
}

export type TokenCheck = { ok: true; telegramId: number } | { ok: false; error: string };

/** Годен ли токен, найденный по хэшу (`row` = null — хэша в базе нет: отозван или выдуман). */
export function checkTokenRow(row: TokenRow | null, nowMs: number): TokenCheck {
  if (row == null) return { ok: false, error: TOKEN_INVALID_MESSAGE };
  const expiresMs = Date.parse(row.claude_mcp_token_expires_at ?? "");
  if (!(expiresMs > nowMs)) return { ok: false, error: TOKEN_EXPIRED_MESSAGE };
  return { ok: true, telegramId: row.telegram_id };
}
