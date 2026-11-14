import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { RecorderEntry } from "./meeting-processing-state.ts";
import type { Segment } from "./speakers.ts";

// telegram_id владельца микрофонной дорожки («я» в стенограмме). Авторитетный источник —
// meetings.claim_owner: mic-дорожку заливает ТОЛЬКО claim_owner (meeting-ingest отбивает 403 на
// чужой аплоад), поэтому claim_owner === владелец «я» по построению, даже после перехвата протухшей
// брони (recorders[0] в этом случае — уже НЕ тот, кто записал). recorders[0] оставляем лишь как
// фолбэк для легаси-строк без claim_owner.
export function micOwnerId(claimOwner: number | null, recorders: RecorderEntry[] | null): number | null {
  if (typeof claimOwner === "number") return claimOwner;
  return (recorders ?? []).map((r) => r?.telegram_id).find((n): n is number => typeof n === "number") ?? null;
}

// Имя владельца записи для легенды спикеров тезисов: telegram_id → user_profiles(first/last) →
// фолбэк @username из allowed_users. null, если не резолвится (легенда останется обезличенной).
export async function resolveOwnerName(supabase: SupabaseClient, telegramId: number | null): Promise<string | null> {
  if (telegramId == null) return null;
  const [{ data: prof }, { data: au }] = await Promise.all([
    supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", telegramId).maybeSingle(),
    supabase.from("allowed_users").select("username").eq("telegram_id", telegramId).maybeSingle(),
  ]);
  const p = prof as { first_name?: string | null; last_name?: string | null } | null;
  const full = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  const uname = (au as { username?: string | null } | null)?.username;
  return uname ? `@${uname}` : null;
}

// Легенда спикеров для промпта тезисов живёт в _shared/speakers.ts: она обязана описывать ровно те
// метки, которые в стенограмме есть (запись бота — только имена, реплик «я» там нет вовсе).
// Метки берём из самих сегментов.
export function labelsOf(segments: readonly Segment[]): string[] {
  return segments.map((s) => s.speaker ?? "");
}
