// Импорты по URL, а не голыми спецификаторами: так во ВСЕХ функциях, см. _shared/agent-auth.ts.
//
// Приглашения бота в базе (таблица meeting_invites, решение D017): чтение для сверки и гашение.
// Сверка — agent-scope.ts (checkInviteForClaim), здесь только хождение в базу.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InviteRow } from "../_shared/meeting-invite.ts";
import type { InviteSource } from "./agent-scope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, group_id, invited_by, join_url, platform, created_at, expires_at, taken_at, used_at, meeting_id";

export function inviteSource(supabase: SupabaseClient): InviteSource {
  return {
    find: async (id) => {
      // Не uuid — такого приглашения нет; в базу с мусором не ходим (иначе 22P02 вместо отказа).
      if (!UUID.test(id)) return null;
      const { data, error } = await supabase.from("meeting_invites").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`meeting_invites: ${error.message}`);
      return (data as InviteRow | null) ?? null;
    },
  };
}

/**
 * Гасит приглашение ОДНИМ условным UPDATE: строка меняется, только если она ещё не использована,
 * не истекла и принадлежит этому человеку и воркспейсу. Две одновременные заявки по одному
 * приглашению упираются в блокировку строки, и вторая после неё уже видит `used_at` —
 * проходит ровно одна. `false` — гонку проиграли или приглашение успело истечь.
 */
export async function consumeInvite(
  supabase: SupabaseClient,
  inviteId: string,
  who: { telegramId: number; groupId: string },
  nowIso: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("meeting_invites")
    .update({ used_at: nowIso })
    .eq("id", inviteId)
    .eq("invited_by", who.telegramId)
    .eq("group_id", who.groupId)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`meeting_invites: ${error.message}`);
  return data !== null;
}

/** Встреча создана — приглашение запоминает её (веб показывает человеку, что бот уже на звонке). */
export async function attachInvite(supabase: SupabaseClient, inviteId: string, meetingId: string): Promise<void> {
  const { error } = await supabase.from("meeting_invites").update({ meeting_id: meetingId }).eq("id", inviteId);
  if (error) {
    console.error(`meeting-claim: приглашение ${inviteId} не связано со встречей ${meetingId}: ${error.message}`);
  }
}

/**
 * Встреча не создалась — возвращаем приглашение, иначе человек потерял бы его на нашей ошибке.
 * Снимаем только своё гашение (meeting_id ещё пуст).
 */
export async function releaseInvite(supabase: SupabaseClient, inviteId: string): Promise<void> {
  const { error } = await supabase.from("meeting_invites").update({ used_at: null }).eq("id", inviteId).is(
    "meeting_id",
    null,
  );
  if (error) console.error(`meeting-claim: приглашение ${inviteId} не возвращено после сбоя: ${error.message}`);
}
