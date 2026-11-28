// Push refresh uses the existing dispatch policy, including consent, platform and room dedup.
import { DISPATCH_LEAD_MS, type DispatchPlan, mergeDispatch, planPersonDispatch } from "./calendar-dispatch.ts";
import type { GEvent } from "../meeting-current/select.ts";

export const PUSH_HORIZON_MS = 35 * 24 * 60 * 60_000;
export const PUSH_REFRESH_MS = 6 * 60 * 60_000;
export const WATCH_RENEW_MARGIN_MS = 24 * 60 * 60_000;

export function channelRenewAt(createdAt: number, expiresAt: number): number {
  return expiresAt - Math.min(WATCH_RENEW_MARGIN_MS, Math.max(1_000, (expiresAt - createdAt) / 5));
}

export interface StoredPlan {
  jobs: DispatchPlan["jobs"];
  skipped: DispatchPlan["skipped"];
  who: Array<[string, NonNullable<DispatchPlan["who"]> extends Map<string, infer T> ? T : never]>;
}

/** Future events are evaluated at their dispatch time; no second copy of the admission policy. */
export function planPushEvents(
  events: GEvent[],
  person: number,
  nowMs: number,
  manualRooms: ReadonlySet<string>,
): StoredPlan {
  const plans = events.filter((event) => {
    const starts = Date.parse(event.start?.dateTime ?? "");
    return starts <= nowMs + PUSH_HORIZON_MS;
  }).map((event) => {
    const dispatchAt = Date.parse(event.start?.dateTime ?? "") - DISPATCH_LEAD_MS;
    return planPersonDispatch(
      [event],
      person,
      Math.max(nowMs, dispatchAt),
      dispatchAt <= nowMs ? manualRooms : new Set(),
    );
  });
  return storePlan(mergePlans(plans));
}

// mergeDispatch intentionally drops the organizer map from its public output. Retain it for
// subsequent cross-person snapshots; the same room/organizer rule must still hold after restart.
function mergePlans(plans: DispatchPlan[]): DispatchPlan {
  const merged = mergeDispatch(plans);
  const who: NonNullable<DispatchPlan["who"]> = new Map();
  for (const job of merged.jobs) {
    const original = plans.find((plan) =>
      plan.jobs.some((j) => j.calendar_key === job.calendar_key && j.invited_by === job.invited_by)
    );
    const people = original?.who?.get(job.calendar_key);
    if (people) who.set(job.calendar_key, people);
  }
  return { ...merged, who };
}

export function storePlan(plan: DispatchPlan): StoredPlan {
  return { jobs: plan.jobs, skipped: plan.skipped, who: [...(plan.who ?? new Map()).entries()] };
}

export function mergeStoredPlans(plans: StoredPlan[], nowMs: number): DispatchPlan {
  return mergePlans(plans.map((plan) => ({
    jobs: plan.jobs.filter((job) => Date.parse(job.ends_at) > nowMs),
    skipped: plan.skipped.filter((skip) => !skip.ends_at || Date.parse(skip.ends_at) > nowMs),
    who: new Map(plan.who),
  })));
}

export function validPushHeaders(headers: Headers): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    headers.get("x-goog-channel-id") ?? "",
  ) &&
    /^\d{1,30}$/.test(headers.get("x-goog-message-number") ?? "") &&
    ["sync", "exists", "not_exists"].includes(headers.get("x-goog-resource-state") ?? "") &&
    !!headers.get("x-goog-resource-id") && !!headers.get("x-goog-channel-token");
}

export async function sameSecret(left: string, right: string): Promise<boolean> {
  const bytes = new TextEncoder();
  const [a, b] = await Promise.all([left, right].map((s) => crypto.subtle.digest("SHA-256", bytes.encode(s))));
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
