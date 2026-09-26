// Реализация GhostStore на supabase-js (service_role). Решений здесь нет — только запросы;
// «призрак или бот ещё пишет» решает ghost-sweep.ts. Держит этот файл живой смоук
// scripts/scriba-watchdog-smoke.ts против настоящего Postgres, а не юнит-тест с подделкой.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentBeat } from "./recording-watchdog.ts";
import type { GhostCandidate, GhostStore } from "./ghost-sweep.ts";

function must<T>(what: string, res: { data: T | null; error: { message: string } | null }): T | null {
  // Ошибка чтения — громко: молча пустой список агентов выглядит ровно как «ботов нет».
  if (res.error) throw new Error(`ghost-sweep: ${what}: ${res.error.message}`);
  return res.data;
}

// «Пустая» встреча: обработка не начиналась и публиковать нечего. Одни и те же условия и в
// выборке, и в пометке — пометка условная, чтобы не затереть встречу, куда только что пришёл ingest.
// deno-lint-ignore no-explicit-any
function onlyEmpty(query: any): any {
  return query
    .is("summary_status", null)
    .is("transcript", null)
    .is("process_state", null)
    .is("draft_notes_md", null)
    .is("entry_id", null);
}

export function makeGhostStore(supabase: SupabaseClient): GhostStore {
  return {
    async ghostCandidates(cutoffIso) {
      const res = await onlyEmpty(supabase.from("meetings").select("id, identity_key")).lt("created_at", cutoffIso);
      return (must("meetings", res) ?? []) as GhostCandidate[];
    },
    async agentBeats() {
      const res = await supabase.from("service_agents").select("id, last_seen_at, last_meeting_key");
      return (must("service_agents", res) ?? []) as AgentBeat[];
    },
    async markGhostFailed(meetingId) {
      const res = await onlyEmpty(
        supabase.from("meetings").update({ summary_status: "failed", updated_at: new Date().toISOString() }).eq(
          "id",
          meetingId,
        ),
      ).select("id");
      return ((must("mark meetings", res) ?? []) as unknown[]).length > 0;
    },
  };
}
