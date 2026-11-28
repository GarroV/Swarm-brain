import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SignalKind } from "./scriba-signals.ts";

export const WORK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseWorkRequest(body: unknown): { id: string; started: boolean } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("id is required");
  const value = body as Record<string, unknown>;
  if (
    typeof value.id !== "string" || !WORK_UUID.test(value.id) ||
    (value.started !== undefined && typeof value.started !== "boolean")
  ) throw new Error("invalid work request");
  return { id: value.id, started: value.started === true };
}

export async function takeSignalWork(
  db: SupabaseClient,
  kind: SignalKind,
  id: string,
  agent: { agentId: string; groupId: string },
): Promise<{ state: "taken" | "started" | "busy" | "missing" | "not_due"; job?: Record<string, unknown> }> {
  const { data, error } = await db.rpc("scriba_take_work", {
    p_kind: kind,
    p_id: id,
    p_group: agent.groupId,
    p_agent: agent.agentId,
  });
  if (error || !data || !["taken", "started", "busy", "missing", "not_due"].includes(data.state)) {
    throw new Error("work take failed");
  }
  return data;
}

export async function acknowledgeSignalWork(
  db: SupabaseClient,
  kind: SignalKind,
  id: string,
  agent: { agentId: string; groupId: string },
): Promise<boolean> {
  const { data, error } = await db.rpc("scriba_started_work", {
    p_kind: kind,
    p_id: id,
    p_group: agent.groupId,
    p_agent: agent.agentId,
  });
  if (error) throw new Error("work acknowledgement failed");
  return data === true;
}
