// Реализация WatchdogStore на supabase-js (service_role). Решений здесь нет — только запросы;
// «жив/мёртв» и адресата решает recording-watchdog.ts. Держит этот файл живой смоук
// scripts/scriba-watchdog-smoke.ts против настоящего Postgres, а не юнит-тест с подделкой.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentBeat, HumanBeat, WatchdogMeeting, WatchdogStore } from "./recording-watchdog.ts";

function must<T>(what: string, res: { data: T | null; error: { message: string } | null }): T | null {
  // Ошибка чтения — громко: молча пустой список выглядит ровно как «все живы».
  if (res.error) throw new Error(`recording-watchdog: ${what}: ${res.error.message}`);
  return res.data;
}

export function makeWatchdogStore(supabase: SupabaseClient): WatchdogStore {
  return {
    async recordingHumans() {
      const res = await supabase
        .from("allowed_users")
        .select("telegram_id, recorder_last_seen")
        .eq("recorder_last_recording", true);
      return (must("allowed_users", res) ?? []) as HumanBeat[];
    },
    async clearHumanRecording(telegramId) {
      const res = await supabase.from("allowed_users").update({ recorder_last_recording: false }).eq(
        "telegram_id",
        telegramId,
      );
      must("clear allowed_users", res);
    },
    async recordingAgents() {
      const res = await supabase
        .from("service_agents")
        .select("id, last_seen_at, last_meeting_key")
        .eq("last_recording", true);
      return (must("service_agents", res) ?? []) as AgentBeat[];
    },
    async clearAgentRecording(agentId, seenAt) {
      const res = await supabase
        .from("service_agents")
        .update({ last_recording: false })
        .eq("id", agentId)
        .eq("last_recording", true)
        .eq("last_seen_at", seenAt)
        .select("id");
      return ((must("clear service_agents", res) ?? []) as unknown[]).length > 0;
    },
    async latestMeetingByKey(key) {
      // Календарные и комнатные ключи уникальны; ручные — нет, поэтому самая свежая встреча.
      const res = await supabase
        .from("meetings")
        .select("id, title, claim_owner")
        .eq("identity_key", key)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return must("meetings", res) as WatchdogMeeting | null;
    },
    async containerDiedNoticeSent(meetingId, recipient) {
      const res = await supabase
        .from("meeting_notices")
        .select("id")
        .eq("meeting_id", meetingId)
        .eq("recipient_id", recipient)
        .eq("kind", "container_died")
        .eq("status", "sent")
        .limit(1);
      return ((must("meeting_notices", res) ?? []) as unknown[]).length > 0;
    },
  };
}
