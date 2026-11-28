import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  channelRenewAt,
  mergeStoredPlans,
  planPushEvents,
  PUSH_HORIZON_MS,
  validPushHeaders,
} from "./calendar-push-plan.ts";
import type { GEvent } from "../meeting-current/select.ts";

const NOW = Date.parse("2026-11-28T10:00:00Z");
function event(over: Partial<GEvent> = {}): GEvent {
  return {
    id: "e",
    iCalUID: "uid",
    start: { dateTime: new Date(NOW + 24 * 60 * 60_000).toISOString() },
    end: { dateTime: new Date(NOW + 25 * 60 * 60_000).toISOString() },
    organizer: { self: true, email: "organizer@example.invalid" },
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    ...over,
  };
}
Deno.test("push plans tomorrow with unchanged meeting policy and preserves times", () => {
  const e = event();
  const plan = planPushEvents([e], 1, NOW, new Set());
  assertEquals(plan.jobs.length, 1);
  assertEquals(plan.jobs[0].starts_at, e.start!.dateTime);
  assertEquals(plan.who.length, 1);
});
Deno.test("a manual invitation now does not suppress the same room tomorrow", () => {
  assertEquals(planPushEvents([event()], 1, NOW, new Set(["meet:abc-defg-hij"])).jobs.length, 1);
});
Deno.test("provider-shortened channel lifetime still renews before expiry", () => {
  const expiry = NOW + 60 * 60_000;
  assertEquals(channelRenewAt(NOW, expiry), NOW + 48 * 60_000);
});
Deno.test("push excludes cancelled/all-day/outside horizon and reports declined", () => {
  const plan = planPushEvents(
    [
      event({ status: "cancelled" }),
      event({ start: { date: "2026-11-29" } }),
      event({ start: { dateTime: new Date(NOW + PUSH_HORIZON_MS + 1).toISOString() } }),
      event({ attendees: [{ self: true, responseStatus: "declined" }] }),
    ],
    1,
    NOW,
    new Set(),
  );
  assertEquals(plan.jobs.length, 0);
  assertEquals(plan.skipped.map((s) => s.reason), ["declined"]);
});
Deno.test("snapshot merge keeps cross-person same-room/organizer dedup after JSON persistence", () => {
  const first = planPushEvents([event()], 1, NOW, new Set());
  const second = planPushEvents([event({ id: "other", iCalUID: "other" })], 2, NOW, new Set());
  const plans = JSON.parse(JSON.stringify([first, second]));
  assertEquals(mergeStoredPlans(plans, NOW).jobs.length, 1);
  const third = planPushEvents(
    [event({ iCalUID: "third", organizer: { self: true, email: "other@example.invalid" } })],
    3,
    NOW,
    new Set(),
  );
  assertEquals(mergeStoredPlans([first, third], NOW).jobs.length, 2);
});
Deno.test("empty replacement removes cancelled source rather than retaining the prior job", () => {
  const first = planPushEvents([event()], 1, NOW, new Set());
  assertEquals(mergeStoredPlans([first], NOW).jobs.length, 1);
  const cancelled = planPushEvents([event({ status: "cancelled" })], 1, NOW, new Set());
  assertEquals(mergeStoredPlans([cancelled], NOW).jobs.length, 0);
});
Deno.test("push header shape fails closed and permits Google sync/exists", () => {
  const headers = new Headers({
    "x-goog-channel-id": "17e1554f-b311-4fdd-9ce7-8466d1c7e332",
    "x-goog-channel-token": "opaque",
    "x-goog-resource-id": "resource",
    "x-goog-resource-state": "sync",
    "x-goog-message-number": "1",
  });
  assertEquals(validPushHeaders(headers), true);
  headers.set("x-goog-resource-state", "anything");
  assertEquals(validPushHeaders(headers), false);
  headers.set("x-goog-resource-state", "exists");
  headers.delete("x-goog-channel-token");
  assertEquals(validPushHeaders(headers), false);
});
