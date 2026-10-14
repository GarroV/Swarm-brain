import { supabase } from "./supabase.ts";
import {
  buildRecorderSetupOneLiner,
  buildRecorderUpdateOneLiner,
  hasActiveRecorderToken as _hasActiveRecorderToken,
  type MintedRecorderToken,
  mintRecorderToken as _mintRecorderToken,
  revokeRecorderToken as _revokeRecorderToken,
} from "../../_shared/recorder-token.ts";
import {
  buildSetupOneLiner,
  hasActiveMcpToken as _hasActiveMcpToken,
  type MintedToken,
  mintMcpToken as _mintMcpToken,
} from "../../_shared/mcp-token.ts";

// Тонкие обёртки на bot-клиенте над общими модулями _shared/{mcp,recorder}-token.ts.
// Те же модули использует swarm-api для веб «Настройки → Claude Desktop / Рекордер».
// Сигнатуры сохранены для index.ts (/setup, /mytoken, /recordertoken, re-issue callbacks).
export { buildRecorderSetupOneLiner, buildRecorderUpdateOneLiner, buildSetupOneLiner };
export type { MintedRecorderToken, MintedToken };

export function mintMcpToken(telegramId: number): Promise<MintedToken | null> {
  return _mintMcpToken(supabase, telegramId, { via: "bot" });
}
export function hasActiveMcpToken(telegramId: number): Promise<boolean> {
  return _hasActiveMcpToken(supabase, telegramId);
}
export function mintRecorderToken(telegramId: number, ttlDays = 365): Promise<MintedRecorderToken | null> {
  return _mintRecorderToken(supabase, telegramId, ttlDays, { via: "bot" });
}
export function hasActiveRecorderToken(telegramId: number): Promise<boolean> {
  return _hasActiveRecorderToken(supabase, telegramId);
}
export function revokeRecorderToken(telegramId: number): Promise<boolean> {
  return _revokeRecorderToken(supabase, telegramId, { via: "bot" });
}
