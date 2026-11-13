import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canAccessDraftMeeting,
  canDeleteDraftMeeting,
  canHideDraftMeeting,
  type DraftMeetingRow,
} from "./meeting-access.ts";
import { meetingEntryIsLive } from "./meeting-entry-live.ts";

export type DraftDeleteCaller = { telegramId: number; groupId: string; isAdmin: boolean; email?: string | null };
export type DraftDeleteResult = { ok: true } | {
  ok: false;
  reason: "not_found" | "published" | "shared" | "forbidden" | "changed" | "storage" | "database";
};
type Snapshot = DraftMeetingRow & { id: string; version: string; status: string; entry_id?: string | null };
type Job = {
  meeting_id: string;
  group_id: string;
  requested_by: number | string;
  requested_group_id: string;
  completed_at: string | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "meeting-audio";
const PAGE = 100;
// Bound one invocation; a pending job can continue with the same confirmed request.
const MAX_LIST_CALLS = 100;

/** Only the exact primary prefix, including queued JSON; never backup/ or referenced external paths. */
export async function clearDraftPrimaryPrefix(sb: SupabaseClient, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  id = id.toLowerCase();
  const bucket = sb.storage.from(BUCKET);
  let calls = 0;
  async function collect(prefix: string, paths: string[]): Promise<boolean> {
    for (let offset = 0;; offset += PAGE) {
      if (++calls > MAX_LIST_CALLS) return false;
      const { data, error } = await bucket.list(prefix, {
        limit: PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error || !Array.isArray(data)) throw new Error("cleanup_list");
      for (const item of data) {
        if (!item.name || item.name === "." || item.name === ".." || /[\\/]/.test(item.name)) {
          throw new Error("cleanup_path");
        }
        const path = `${prefix}/${item.name}`;
        if (item.id == null) {
          if (!await collect(path, paths)) return false;
        } else paths.push(path);
      }
      if (data.length < PAGE) return true;
    }
  }
  try {
    const paths: string[] = [];
    const complete = await collect(id, paths);
    for (let i = 0; i < paths.length; i += PAGE) {
      const { error } = await bucket.remove(paths.slice(i, i + PAGE));
      if (error) return false;
    }
    // A bounded partial pass makes progress, but cannot report completion.
    if (!complete) return false;
    const remaining: string[] = [];
    // Storage can return partial success: independently verify all remaining objects.
    return await collect(id, remaining) && remaining.length === 0;
  } catch {
    return false;
  }
}

/** Shared web/MCP deletion. Caller identity comes exclusively from the authenticated context. */
export async function deleteDraftMeeting(
  sb: SupabaseClient,
  id: string,
  caller: DraftDeleteCaller,
): Promise<DraftDeleteResult> {
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  id = id.toLowerCase();
  try {
    const { data: raw, error } = await sb.rpc("draft_meeting_delete_snapshot", { p_id: id });
    if (error) return { ok: false, reason: "database" };
    const meeting = raw as Snapshot | null;
    if (meeting) {
      const adminDelete = caller.isAdmin && canDeleteDraftMeeting(meeting, caller.telegramId, true, caller.groupId);
      if (
        !adminDelete && !canAccessDraftMeeting(meeting, caller.telegramId, caller.isAdmin, caller.groupId, caller.email)
      ) {
        return { ok: false, reason: "not_found" };
      }
      if (!await meetingEntryIsLive(sb, meeting)) return { ok: false, reason: "not_found" };
      if (meeting.status === "in_base") return { ok: false, reason: "published" };
      if (!caller.isAdmin && canHideDraftMeeting(meeting, caller.telegramId)) return { ok: false, reason: "shared" };
      if (!canDeleteDraftMeeting(meeting, caller.telegramId, caller.isAdmin, caller.groupId)) {
        return { ok: false, reason: "forbidden" };
      }
      const started = await sb.rpc("start_draft_meeting_delete", {
        p_id: id,
        p_version: meeting.version,
        p_group_id: meeting.group_id,
        p_actor: caller.telegramId,
        p_actor_group: caller.groupId,
      });
      if (started.error) return { ok: false, reason: "database" };
      if (started.data !== true) return { ok: false, reason: "changed" };
    }
    const { data, error: jobError } = await sb.from("draft_meeting_deletions")
      .select("meeting_id,group_id,requested_by,requested_group_id,completed_at").eq("meeting_id", id).maybeSingle();
    if (jobError) return { ok: false, reason: "database" };
    const job = data as Job | null;
    if (
      !job ||
      !((Number(job.requested_by) === caller.telegramId && job.requested_group_id === caller.groupId) ||
        (caller.isAdmin && job.group_id === caller.groupId))
    ) {
      return { ok: false, reason: "not_found" };
    }
    if (!await clearDraftPrimaryPrefix(sb, id)) return { ok: false, reason: "storage" };
    if (job.completed_at) return { ok: true };
    const completed = await sb.from("draft_meeting_deletions").update({ completed_at: new Date().toISOString() })
      .eq("meeting_id", id).is("completed_at", null);
    if (completed.error) return { ok: false, reason: "database" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "database" };
  }
}
