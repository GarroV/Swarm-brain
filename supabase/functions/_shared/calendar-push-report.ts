import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { DispatchSkip } from "./calendar-dispatch.ts";
import { recordSweepMisses } from "../meeting-calendar/missed.ts";
import { makeMissStore } from "./calendar-miss-store.ts";
import { makeOutcomeStore } from "./join-outcomes.ts";
import { outcomesFromSkips } from "../meeting-calendar/outcomes.ts";

export async function reportCalendarSkips(db: SupabaseClient, group: string, skipped: DispatchSkip[]): Promise<void> {
  for (const skip of skipped) console.warn(`calendar-push: БОТ НЕ ПОЙДЁТ: ${skip.reason}`);
  await makeOutcomeStore(db).record(outcomesFromSkips(group, skipped, Date.now()));
  const result = await recordSweepMisses(makeMissStore(db), group, skipped, Date.now(), console.error);
  if (result.failed > 0) throw new Error("calendar_miss_persistence_failed");
}
