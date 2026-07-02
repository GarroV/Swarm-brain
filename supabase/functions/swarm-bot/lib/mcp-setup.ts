import { supabase } from "./supabase.ts";
import {
  mintRecorderToken as _mintRecorderToken,
  hasActiveRecorderToken as _hasActiveRecorderToken,
  buildRecorderSetupOneLiner,
  type MintedRecorderToken,
} from "../../_shared/recorder-token.ts";
import {
  mintMcpToken as _mintMcpToken,
  hasActiveMcpToken as _hasActiveMcpToken,
  buildSetupOneLiner,
  type MintedToken,
} from "../../_shared/mcp-token.ts";

// Тонкие обёртки на bot-клиенте над общими модулями _shared/{mcp,recorder}-token.ts.
// Те же модули использует swarm-api для веб «Настройки → Claude Desktop / Рекордер».
// Сигнатуры сохранены для index.ts (/setup, /mytoken, /recordertoken, re-issue callbacks).
export { buildRecorderSetupOneLiner, buildSetupOneLiner };
export type { MintedRecorderToken, MintedToken };

export function mintMcpToken(telegramId: number): Promise<MintedToken | null> {
  return _mintMcpToken(supabase, telegramId);
}
export function hasActiveMcpToken(telegramId: number): Promise<boolean> {
  return _hasActiveMcpToken(supabase, telegramId);
}
export function mintRecorderToken(telegramId: number, ttlDays = 365): Promise<MintedRecorderToken | null> {
  return _mintRecorderToken(supabase, telegramId, ttlDays);
}
export function hasActiveRecorderToken(telegramId: number): Promise<boolean> {
  return _hasActiveRecorderToken(supabase, telegramId);
}
