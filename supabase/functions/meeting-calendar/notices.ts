import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mergeStoredPlans, type StoredPlan } from "../_shared/calendar-push-plan.ts";
import { calendarNoticeSource } from "../_shared/calendar-push-store.ts";
import { type TakenJob, withNoticeRecipients } from "./sweep.ts";

/** Recheck recipient calendars for only the job being launched, not the 35-day planning horizon. */
export async function prepareJobNotices(
  db: SupabaseClient,
  group: string,
  agentId: string,
  job: TakenJob,
): Promise<void> {
  const { data, error } = await db.rpc("calendar_push_read_plans", { p_group: group });
  if (error) throw new Error("calendar_notice_snapshot_failed");
  const metadata = mergeStoredPlans((data?.plans ?? []) as StoredPlan[], Date.now()).jobs.find((candidate) =>
    candidate.calendar_key === job.calendar_key
  );
  const [prepared] = await withNoticeRecipients(calendarNoticeSource(db), group, [{ ...metadata, ...job }]);
  const saved = await db.from("meeting_calendar_jobs").update({ notice_recipients: prepared.notice_recipients ?? [] })
    .eq("id", job.id).eq("group_id", group).eq("taken_by", agentId);
  if (saved.error) throw new Error("calendar_notice_save_failed");
}
