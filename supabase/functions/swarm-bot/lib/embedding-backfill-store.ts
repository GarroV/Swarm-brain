// Реализация BackfillStore на supabase-js (логика и тесты — embedding-backfill.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onlyLiveEntries } from "../../_shared/entries/live.ts";
import { BACKFILL_SKIP_GROUPS, type BackfillEntry, type BackfillStore } from "./embedding-backfill.ts";

export function makeBackfillStore(supabase: SupabaseClient): BackfillStore {
  return {
    async missing(limit) {
      const { data, error } = await onlyLiveEntries(
        supabase.from("entries").select("id, content, summary, countries"),
      )
        .is("embedding", null)
        // `not in` в SQL отбрасывает и строки с group_id = null — их берём явно.
        .or(`group_id.is.null,group_id.not.in.(${BACKFILL_SKIP_GROUPS.join(",")})`)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`embedding backfill: выборка записей: ${error.message}`);
      return (data ?? []) as BackfillEntry[];
    },
    async save(id, embedding) {
      const { error } = await supabase.from("entries").update({ embedding }).eq("id", id).is("embedding", null);
      if (error) throw new Error(error.message);
    },
  };
}
