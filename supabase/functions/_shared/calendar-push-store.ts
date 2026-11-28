import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accessToken, listEvents } from "./google-calendar.ts";

export async function refreshCalendarToken(db: SupabaseClient, person: number): Promise<string | null> {
  const { data, error } = await db.from("user_integrations").select("api_key")
    .eq("telegram_id", person).eq("service", "google_calendar").maybeSingle();
  if (error) throw new Error("calendar_database_failed");
  return data?.api_key ?? null;
}

export function calendarNoticeSource(db: SupabaseClient) {
  return {
    refreshToken: (id: number) => refreshCalendarToken(db, id),
    accessToken,
    listEvents,
    async workspaceMembers(groupId: string) {
      const { data, error } = await db.from("allowed_users").select("telegram_id,email").eq("group_id", groupId);
      if (error) throw new Error("calendar_database_failed");
      return data ?? [];
    },
  };
}
