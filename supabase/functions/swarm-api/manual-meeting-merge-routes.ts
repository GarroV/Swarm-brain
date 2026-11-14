import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import {
  canonicalManualMeeting,
  decideManualMerge,
  getManualMergeCandidate,
  loadManualMeeting,
  type ManualMeetingRow,
  type ManualMergeActor,
  ManualMergeError,
  parseManualMergeInput,
  readManualMergeVersions,
} from "../_shared/manual-meeting-merge.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MERGE = new RegExp(`^/agent-meetings/(${UUID})/manual-merge-(candidate|decision)$`, "i");
const VERSIONS = new RegExp(`^/agent-meetings/(${UUID})/manual-merge-versions/(${UUID})$`, "i");
const ALIAS = new RegExp(
  `^(/agent-meetings/)(${UUID})(/(?:notes|ask|resummarize|market-suggestion|hide|publish))?$`,
  "i",
);

export type ManualMergeRouteContext = {
  supabase: SupabaseClient;
  origin: string;
  actor: ManualMergeActor;
  recorderNames: (row: ManualMeetingRow) => Promise<string[]>;
};

export function manualMergeErrorResponse(error: unknown, origin: string): Response {
  if (error instanceof ManualMergeError && error.status !== 500) {
    return json({ error: error.code, code: error.code }, error.status, origin);
  }
  return serverError(origin, "manual meeting operation", error);
}

/** All calls enter after the same session/maintenance/demo guards as existing meeting routes. */
export async function handleManualMeetingMergeRoutes(
  ctx: ManualMergeRouteContext,
  req: Request,
  routePath: string,
): Promise<Response | null> {
  const match = routePath.match(MERGE);
  const versions = routePath.match(VERSIONS);
  if (!match && !versions) return null;
  try {
    if (versions) {
      if (req.method !== "GET") return apiErr(405, "Method not allowed", ctx.origin);
      return json(await readManualMergeVersions(ctx.supabase, versions[1], versions[2], ctx.actor), 200, ctx.origin);
    }
    const sourceId = match![1];
    if (match![2] === "candidate") {
      if (req.method !== "GET") return apiErr(405, "Method not allowed", ctx.origin);
      const base = new URL(req.url).searchParams.get("base") ?? "workspace";
      if (base !== "workspace" && base !== "personal") throw new ManualMergeError(400, "INVALID_INPUT");
      return json(
        await getManualMergeCandidate(ctx.supabase, sourceId, base, ctx.actor, ctx.recorderNames),
        200,
        ctx.origin,
      );
    }
    if (req.method !== "POST") return apiErr(405, "Method not allowed", ctx.origin);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ManualMergeError(400, "INVALID_INPUT");
    }
    const result = await decideManualMerge(ctx.supabase, sourceId, parseManualMergeInput(body), ctx.actor);
    return json(result, 200, ctx.origin);
  } catch (error) {
    return manualMergeErrorResponse(error, ctx.origin);
  }
}

/** Confirmed aliases affect the logical meeting, never the existing raw-row DELETE policy. */
export async function manualMeetingAliasPath(
  ctx: ManualMergeRouteContext,
  req: Request,
  routePath: string,
): Promise<string> {
  if (req.method === "DELETE") return routePath;
  const match = routePath.match(ALIAS);
  if (!match) return routePath;
  const { data, error } = await ctx.supabase.from("meetings").select("id, manual_merge_target_id").eq("id", match[2])
    .maybeSingle();
  if (error) throw new ManualMergeError(500, "MANUAL_MERGE_UNAVAILABLE");
  if (!data?.manual_merge_target_id) return routePath;
  const original = await loadManualMeeting(ctx.supabase, match[2], ctx.actor);
  if (!original.manual_merge_target_id) return routePath;
  const canonical = await canonicalManualMeeting(ctx.supabase, original, ctx.actor);
  return match[1] + canonical.id + (match[3] ?? "");
}
