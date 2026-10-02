// Привязка Telegram в боте (issue #92): кто пишет боту и какой код привязки он принёс.
// Логика кода — _shared/telegram-link.ts; здесь только база.
import { supabase } from "./supabase.ts";
import { hashLinkCode } from "../../_shared/telegram-link.ts";

/**
 * Номер человека в Swarm по его Telegram. Привязанный из веба (telegram_chat_id) работает под
 * номером своей строки; у остальных номер и есть Telegram — возвращаем как есть.
 */
export async function resolveIdentity(fromId: number): Promise<number> {
  if (!fromId) return fromId;
  const { data, error } = await supabase.from("allowed_users")
    .select("telegram_id").eq("telegram_chat_id", fromId).maybeSingle();
  if (error) console.error("[telegram-link] resolveIdentity failed", error.message);
  const id = (data as { telegram_id: number | null } | null)?.telegram_id;
  return typeof id === "number" ? id : fromId;
}

export type LinkOutcome = "linked" | "expired" | "taken" | "error";

/** Привязать Telegram `fromId` по коду. Код одноразовый: при успехе гасится. */
export async function claimTelegramLink(code: string, fromId: number, now = new Date()): Promise<LinkOutcome> {
  const hash = await hashLinkCode(code);
  const { data: row, error } = await supabase.from("allowed_users")
    .select("id, telegram_id")
    .eq("telegram_link_code_hash", hash)
    .gt("telegram_link_expires_at", now.toISOString())
    .maybeSingle();
  if (error) {
    console.error("[telegram-link] lookup failed", error.message);
    return "error";
  }
  if (!row) return "expired";

  // Этот Telegram уже чей-то: как номер строки или как привязка из веба.
  const { data: busy, error: busyErr } = await supabase.from("allowed_users")
    .select("id").or(`telegram_id.eq.${fromId},telegram_chat_id.eq.${fromId}`).neq("id", row.id).limit(1);
  if (busyErr) {
    console.error("[telegram-link] busy check failed", busyErr.message);
    return "error";
  }
  if ((busy ?? []).length > 0) return "taken";

  const { data: done, error: upErr } = await supabase.from("allowed_users")
    .update({ telegram_chat_id: fromId, telegram_link_code_hash: null, telegram_link_expires_at: null })
    .eq("id", row.id).eq("telegram_link_code_hash", hash)
    .select("id");
  if (upErr) {
    console.error("[telegram-link] update failed", upErr.message);
    return upErr.code === "23505" ? "taken" : "error";
  }
  return (done ?? []).length === 1 ? "linked" : "expired";
}
