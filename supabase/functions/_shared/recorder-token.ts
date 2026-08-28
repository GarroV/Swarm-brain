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

// Сколько живёт ПЕРЕКРЫТИЕ прежнего токена при перевыпуске. Короткое намеренно: окно ослабляет
// обнаружение кражи токена (Ory о graceful rotation: «это workaround, а не практика»), поэтому
// оно нужно ровно на то время, пока человек доносит новый токен до рекордера. Обычно гаснет
// раньше — при первом же успешном запросе с новым токеном (см. _shared/agent-auth.ts).
export const RECORDER_TOKEN_GRACE_HOURS = 24;

// Минтит новый токен рекордера.
//
// Прежний токен НЕ умирает сразу: он переезжает в recorder_token_prev_* и работает ещё
// RECORDER_TOKEN_GRACE_HOURS. Иначе человек, нажавший «перевыпустить» и не дошедший до установки,
// оставался с рекордером, который пишет встречи и не может их залить — молча (issue #146).
// Явный отзыв (`revokeRecorderToken`) гасит оба, перекрытия там нет.
export async function mintRecorderToken(
  supabase: SupabaseClient,
  telegramId: number,
  ttlDays = 365,
): Promise<MintedRecorderToken | null> {
  // Текущий хэш нужен ДО перезаписи — он и станет перекрытием.
  const { data: before } = await supabase
    .from("allowed_users")
    .select("recorder_token_hash, recorder_token_expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  const prev = before as { recorder_token_hash: string | null; recorder_token_expires_at: string | null } | null;
  // Перекрываем только живой токен: протухший продлевать через перевыпуск нельзя.
  const prevAlive = !!prev?.recorder_token_hash &&
    (!prev.recorder_token_expires_at || Date.parse(prev.recorder_token_expires_at) >= Date.now());
  const graceUntil = prevAlive
    ? new Date(Date.now() + RECORDER_TOKEN_GRACE_HOURS * 60 * 60 * 1000).toISOString()
    : null;
  // Без дефисов: на десктоп-Telegram двойной клик по <code> выделяет «слово» до дефиса.
  const token = "smcp_" + crypto.randomUUID().replaceAll("-", "");
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const { error } = await supabase
    .from("allowed_users")
    // recorder_expiry_warned сброс: новый токен → снова можно предупредить перед ЕГО истечением.
    .update({
      recorder_token_hash: hashHex,
      recorder_token_expires_at: expiresAt.toISOString(),
      recorder_expiry_warned: false,
      recorder_token_prev_hash: prevAlive ? prev!.recorder_token_hash : null,
      recorder_token_prev_expires_at: graceUntil,
    })
    .eq("telegram_id", telegramId);
  if (error) return null;
  return { token, expiresAt };
}

// Отзыв: гасит и текущий токен, и перекрытие. Здесь мягкости быть не должно — команду зовут,
// когда токен утёк, и «ещё сутки поработает» означало бы «вор ещё сутки поработает».
export async function revokeRecorderToken(
  supabase: SupabaseClient,
  telegramId: number,
): Promise<boolean> {
  const { error } = await supabase
    .from("allowed_users")
    .update({
      recorder_token_hash: null,
      recorder_token_expires_at: null,
      recorder_token_prev_hash: null,
      recorder_token_prev_expires_at: null,
    })
    .eq("telegram_id", telegramId);
  return !error;
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
// Для ПЕРВОЙ установки — токена на машине ещё нет.
export function buildRecorderSetupOneLiner(token: string): string {
  return `curl -fsSL ${RECORDER_SETUP_URL} | SWARM_TOKEN='${token}' bash`;
}

// Однострочник ОБНОВЛЕНИЯ: без токена. Установщик подхватит уже прописанный токен из локального
// конфига, поэтому обновление не требует перевыпуска и ничего не ломает, даже если человек
// бросит его на полпути. Это и есть основной ответ на issue #146 — перекрытие лишь страхует.
export function buildRecorderUpdateOneLiner(): string {
  return `curl -fsSL ${RECORDER_SETUP_URL} | bash`;
}
