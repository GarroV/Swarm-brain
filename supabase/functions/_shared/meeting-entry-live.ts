// Исходник опубликованной встречи наследует доступность её записи в базе.
// Архив хранит данные, но не даёт открыть их через старую ссылку на исходный черновик.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onlyLiveEntries } from "./entries/live.ts";

type LinkedMeeting = { entry_id?: unknown; group_id?: unknown };

export async function meetingEntryIsLive(supabase: SupabaseClient, meeting: LinkedMeeting): Promise<boolean> {
  if (meeting.entry_id == null) return true;
  if (typeof meeting.entry_id !== "string" || typeof meeting.group_id !== "string" || !meeting.group_id) return false;
  const { data, error } = await onlyLiveEntries(supabase.from("entries").select("id"))
    .eq("id", meeting.entry_id).eq("group_id", meeting.group_id).maybeSingle();
  return !error && !!data;
}
