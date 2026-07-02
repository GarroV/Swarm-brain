// Общий модуль токена рекордера встреч (macOS). Единый источник для бота (/recordertoken)
// и swarm-api (веб «Настройки → Рекордер»). Функции принимают supabase-клиент, чтобы
// работать в любой edge-функции (бот использует свой клиент, swarm-api — свой).
//
// Токен рекордера ОТДЕЛЬНЫЙ от Claude-Desktop MCP-токена (/mytoken): перевыпуск одного
// не трогает другой. Хранится только sha256-хэшем в allowed_users.recorder_token_hash,
// plaintext отдаётся пользователю один раз. TTL по умолчанию 365 дней.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const RECORDER_SETUP_URL =
  "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-recorder-setup";

export interface MintedRecorderToken {
  token: string;
  expiresAt: Date;
}

// Минтит новый токен рекордера, перезаписывая старый (старый сразу мёртв). Возвращает null при ошибке.
export async function mintRecorderToken(
  supabase: SupabaseClient,
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

// Есть ли у пользователя активный (непротухший) токен рекордера + когда истекает.
// Нужно, чтобы не перевыпускать молча рабочую авторизацию рекордера — сначала предупредить.
export async function getRecorderTokenStatus(
  supabase: SupabaseClient,
  telegramId: number,
): Promise<{ active: boolean; expiresAt: string | null }> {
  const { data } = await supabase
    .from("allowed_users")
    .select("recorder_token_hash, recorder_token_expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return { active: false, expiresAt: null };
  const row = data as { recorder_token_hash: string | null; recorder_token_expires_at: string | null };
  const active =
    !!row.recorder_token_hash &&
    (!row.recorder_token_expires_at || Date.parse(row.recorder_token_expires_at) >= Date.now());
  return { active, expiresAt: row.recorder_token_expires_at };
}

// Есть ли активный токен (булев ярлык поверх getRecorderTokenStatus).
export async function hasActiveRecorderToken(
  supabase: SupabaseClient,
  telegramId: number,
): Promise<boolean> {
  return (await getRecorderTokenStatus(supabase, telegramId)).active;
}

// Однострочник для Терминала: ставит и настраивает рекордер с уже вшитым токеном.
export function buildRecorderSetupOneLiner(token: string): string {
  return `curl -fsSL ${RECORDER_SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}
