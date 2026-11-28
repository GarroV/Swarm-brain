import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accessToken } from "../_shared/google-calendar.ts";
import { refreshCalendarToken } from "../_shared/calendar-push-store.ts";
import { futureCalendarEvents, stopCalendar, watchCalendar } from "../_shared/calendar-push-google.ts";
import {
  channelRenewAt,
  mergeStoredPlans,
  planPushEvents,
  PUSH_HORIZON_MS,
  PUSH_REFRESH_MS,
} from "../_shared/calendar-push-plan.ts";
import type { StoredPlan } from "../_shared/calendar-push-plan.ts";
import type { DispatchSkip } from "../_shared/calendar-dispatch.ts";
import { loadCoveredRooms } from "../_shared/manual-rooms.ts";
import { reportCalendarSkips as reportSkips } from "../_shared/calendar-push-report.ts";

interface Control {
  telegram_id: number;
  generation: number;
  attempts: number;
}
interface Channel {
  id: string;
  telegram_id: number;
  resource_id: string | null;
  expires_at: string;
  state: string;
  stop_refresh_token: string | null;
}
function check(error: { message: string } | null): void {
  if (error) throw new Error("calendar_database_failed");
}
const empty = (): StoredPlan => ({ jobs: [], skipped: [], who: [] });

async function stopChannel(db: SupabaseClient, channel: Channel): Promise<void> {
  if (Date.parse(channel.expires_at) > Date.now()) {
    if (!channel.resource_id) throw new Error("calendar_channel_resource_pending");
    const refresh = channel.stop_refresh_token ?? await refreshCalendarToken(db, channel.telegram_id);
    if (!refresh) throw new Error("calendar_channel_stop_grant_missing");
    const result = await accessToken(refresh);
    if (!result.ok) throw new Error(result.deadGrant ? "calendar_stop_grant_revoked" : "calendar_stop_unavailable");
    await stopCalendar(result.token, channel.id, channel.resource_id);
  }
  const result = await db.from("calendar_watch_channels").delete().eq("id", channel.id);
  check(result.error);
}

async function ensureWatch(db: SupabaseClient, person: number, token: string, address: string): Promise<void> {
  const { data, error } = await db.from("calendar_watch_channels").select("*")
    .eq("telegram_id", person).eq("state", "active").order("expires_at", { ascending: false });
  check(error);
  if ((data ?? []).some((c) => channelRenewAt(Date.parse(c.created_at), Date.parse(c.expires_at)) > Date.now())) return;
  const id = crypto.randomUUID(), channelToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const inserted = await db.from("calendar_watch_channels").insert({
    id,
    telegram_id: person,
    token: channelToken,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    state: "starting",
  });
  check(inserted.error);
  const watched = await watchCalendar(token, id, channelToken, address);
  const saved = await db.from("calendar_watch_channels").update({
    state: "active",
    resource_id: watched.resourceId,
    expires_at: new Date(watched.expiration).toISOString(),
  }).eq("id", id);
  check(saved.error);
  // Replacement is active before its predecessor stops, so renewal never creates a deliberate gap.
  const old = await db.from("calendar_watch_channels").update({ state: "stopping" })
    .eq("telegram_id", person).eq("state", "active").neq("id", id);
  check(old.error);
}

async function reconcile(db: SupabaseClient, group: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.rpc("calendar_push_read_plans", { p_group: group });
    check(error);
    const snapshot = data as { revision: number; plans: StoredPlan[] };
    const merged = mergeStoredPlans(snapshot.plans, Date.now());
    const { data: applied, error: applyError } = await db.rpc("calendar_push_apply", {
      p_group: group,
      p_revision: snapshot.revision,
      p_jobs: merged.jobs,
    });
    check(applyError);
    if (applied) return;
  }
  throw new Error("calendar_snapshot_changed_retry");
}

async function reportScheduledSkips(db: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("calendar_push_skips").select("*").is("reported_at", null)
    .lte("due_at", now).gt("expires_at", now).order("due_at").limit(20);
  check(error);
  for (const skip of data ?? []) {
    const { data: owner, error: ownerError } = await db.from("allowed_users").select("scriba_autojoin,group_id")
      .eq("telegram_id", skip.telegram_id).maybeSingle();
    check(ownerError);
    if (owner?.scriba_autojoin && owner.group_id === skip.group_id) {
      const plans = await db.rpc("calendar_push_read_plans", { p_group: skip.group_id });
      check(plans.error);
      const merged = mergeStoredPlans(plans.data.plans, Date.now());
      if (!merged.jobs.some((job) => job.calendar_key === skip.calendar_key)) {
        await reportSkips(db, skip.group_id, [skip.payload as DispatchSkip]);
      }
    }
    const saved = await db.from("calendar_push_skips").update({ reported_at: now })
      .eq("telegram_id", skip.telegram_id).eq("calendar_key", skip.calendar_key).eq("reason", skip.reason);
    check(saved.error);
  }
}

async function checkArrivals(db: SupabaseClient): Promise<void> {
  const { data, error } = await db.from("meeting_calendar_jobs").select("group_id").is("arrival_checked_at", null)
    .lte("taken_at", new Date(Date.now() - 6 * 60_000).toISOString()).gt("ends_at", new Date().toISOString()).limit(20);
  check(error);
  for (const group of new Set((data ?? []).map((job) => job.group_id))) await reportSkips(db, group, []);
}

async function processControl(db: SupabaseClient, control: Control, address: string): Promise<void> {
  const person = control.telegram_id;
  const { data: owner, error } = await db.from("allowed_users").select("group_id,scriba_autojoin")
    .eq("telegram_id", person).maybeSingle();
  check(error);
  if (!owner?.group_id) return;
  const refresh = await refreshCalendarToken(db, person);
  let plan = empty();
  if (owner.scriba_autojoin && refresh) {
    const tok = await accessToken(refresh);
    if (!tok.ok) {
      plan.skipped.push({
        invited_by: person,
        calendar_key: null,
        title: null,
        reason: tok.deadGrant ? "calendar_token_dead" : "calendar_unavailable",
      });
      if (!tok.deadGrant) {
        await reportSkips(db, owner.group_id, plan.skipped);
        throw new Error("calendar_token_temporarily_unavailable");
      }
    } else {
      await ensureWatch(db, person, tok.token, address);
      const now = Date.now();
      const events = await futureCalendarEvents(
        tok.token,
        new Date(now).toISOString(),
        new Date(now + PUSH_HORIZON_MS).toISOString(),
      );
      plan = planPushEvents(events, person, now, await loadCoveredRooms(db, owner.group_id, now));
    }
  } else {
    if (owner.scriba_autojoin) {
      plan.skipped.push({ invited_by: person, calendar_key: null, title: null, reason: "calendar_not_connected" });
    }
    const result = await db.from("calendar_watch_channels").update({ state: "stopping" }).eq("telegram_id", person);
    check(result.error);
  }
  const saved = await db.rpc("calendar_push_save_snapshot", {
    p_person: person,
    p_group: owner.group_id,
    p_plan: plan,
  });
  check(saved.error);
  await reconcile(db, owner.group_id);
  // Event skips are scheduled durably at starts_at - lead, not reported 35 days early.
  await reportSkips(db, owner.group_id, plan.skipped.filter((skip) => skip.calendar_key === null));
}

/** Bounded durable maintenance; normal idle ticks do not call Google or scan all calendars. */
export async function maintainCalendarPush(
  db: SupabaseClient,
  address: string,
): Promise<{ refreshed: number; failed: number }> {
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("calendar_webhook_invalid");
  }
  const result = { refreshed: 0, failed: 0 };
  const expired = await db.from("calendar_watch_channels").delete().lte("expires_at", new Date().toISOString());
  check(expired.error);
  const { data: stopping, error: stopError } = await db.from("calendar_watch_channels").select("*")
    .eq("state", "stopping").limit(2);
  check(stopError);
  for (const channel of (stopping ?? []) as Channel[]) {
    try {
      await stopChannel(db, channel);
    } catch {
      result.failed++;
      console.error("calendar-push: channel stop pending");
    }
  }
  // One complete 8-page snapshot plus at most two channel stops fits the 120s request
  // budget and leaves headroom inside the per-person 3-minute lease.
  const { data, error } = await db.rpc("calendar_push_take_controls", { p_limit: 1 });
  check(error);
  for (const control of (data ?? []) as Control[]) {
    try {
      await processControl(db, control, address);
      const { data: channels, error: channelError } = await db.from("calendar_watch_channels").select(
        "created_at,expires_at",
      )
        .eq("telegram_id", control.telegram_id).eq("state", "active");
      check(channelError);
      const renewAt = Math.min(
        Date.now() + PUSH_REFRESH_MS,
        ...(channels ?? []).map((channel) =>
          channelRenewAt(Date.parse(channel.created_at), Date.parse(channel.expires_at))
        ),
      );
      const saved = await db.from("calendar_push_controls").update({
        processed_generation: control.generation,
        attempts: 0,
        last_error: null,
        lease_until: null,
        next_attempt_at: new Date().toISOString(),
        refresh_after: new Date(Math.max(Date.now() + 60_000, renewAt)).toISOString(),
      }).eq("telegram_id", control.telegram_id);
      check(saved.error);
      result.refreshed++;
    } catch (error) {
      const attempts = control.attempts + 1;
      const failure = error instanceof Error && /^calendar_[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "calendar_refresh_failed";
      const saved = await db.from("calendar_push_controls").update({
        attempts,
        last_error: failure,
        lease_until: null,
        next_attempt_at: new Date(Date.now() + Math.min(60 * 60_000, 15_000 * 2 ** Math.min(attempts, 8)))
          .toISOString(),
      })
        .eq("telegram_id", control.telegram_id);
      check(saved.error);
      console.error(`calendar-push: ${failure}; durable retry pending`);
      result.failed++;
    }
  }
  await reportScheduledSkips(db);
  await checkArrivals(db);
  return result;
}
