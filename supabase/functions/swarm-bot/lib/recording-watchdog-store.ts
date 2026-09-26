// Реализация WatchdogStore на supabase-js (service_role). Решений здесь нет — только запросы;
// «жив/мёртв» и адресата решает recording-watchdog.ts. Держит этот файл живой смоук
// scripts/scriba-watchdog-smoke.ts против настоящего Postgres, а не юнит-тест с подделкой.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentMeetingBeat, HumanBeat, WatchdogStore } from "./recording-watchdog.ts";

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
    async recordingAgentMeetings() {
      const res = await supabase
        .from("meetings")
        .select("id, title, claim_owner, agent_last_seen_at")
        .eq("agent_last_recording", true);
      return (must("meetings", res) ?? []) as AgentMeetingBeat[];
    },
    async clearAgentRecording(meetingId, seenAt) {
      // Условный сброс: свежий удар между чтением и сбросом двигает agent_last_seen_at, и тогда
      // ни одна строка не совпадёт — бот жив, алерта не будет.
      const res = await supabase
        .from("meetings")
        .update({ agent_last_recording: false })
        .eq("id", meetingId)
        .eq("agent_last_recording", true)
        .eq("agent_last_seen_at", seenAt)
        .select("id");
      return ((must("clear meetings", res) ?? []) as unknown[]).length > 0;
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
