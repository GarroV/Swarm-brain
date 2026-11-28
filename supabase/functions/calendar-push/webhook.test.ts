import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CalendarNotificationStore, receiveCalendarNotification } from "./webhook.ts";
const NOW = Date.now();
const channel = {
  telegram_id: 1,
  token: "channel-only",
  resource_id: "bound-resource" as string | null,
  state: "active",
  expires_at: new Date(NOW + 60_000).toISOString(),
};
function request(over: Record<string, string> = {}): Request {
  return new Request("https://example.invalid/calendar-push", {
    method: "POST",
    headers: {
      "x-goog-channel-id": "17e1554f-b311-4fdd-9ce7-8466d1c7e332",
      "x-goog-channel-token": "channel-only",
      "x-goog-resource-id": "bound-resource",
      "x-goog-resource-state": "exists",
      "x-goog-message-number": "2",
      ...over,
    },
  });
}
Deno.test("webhook rejects wrong token/resource and expired/stopping channel without dirty work", async () => {
  let dirty = 0;
  const store: CalendarNotificationStore = {
    channel: () => Promise.resolve(channel),
    dirty: () => {
      dirty++;
      return Promise.resolve();
    },
  };
  assertEquals(
    (await receiveCalendarNotification(request({ "x-goog-channel-token": "wrong" }), store, NOW)).status,
    401,
  );
  assertEquals((await receiveCalendarNotification(request({ "x-goog-resource-id": "wrong" }), store, NOW)).status, 401);
  assertEquals(
    (await receiveCalendarNotification(request(), {
      ...store,
      channel: () => Promise.resolve({ ...channel, state: "stopping" }),
    }, NOW)).status,
    401,
  );
  assertEquals((await receiveCalendarNotification(request(), store, NOW + 60_001)).status, 401);
  assertEquals(dirty, 0);
});
Deno.test("sync before watch response remains unbound; valid duplicate POSTs only mark durable work", async () => {
  let dirty = 0;
  const store: CalendarNotificationStore = {
    channel: () => Promise.resolve(channel),
    dirty: () => {
      dirty++;
      return Promise.resolve();
    },
  };
  assertEquals(
    (await receiveCalendarNotification(request(), {
      ...store,
      channel: () => Promise.resolve({ ...channel, resource_id: null }),
    }, NOW)).status,
    503,
  );
  assertEquals(dirty, 0);
  assertEquals((await receiveCalendarNotification(request(), store, NOW)).status, 204);
  assertEquals((await receiveCalendarNotification(request(), store, NOW)).status, 204);
  assertEquals(dirty, 2);
});
Deno.test("dirty persistence failure is not acknowledged", async () => {
  const store: CalendarNotificationStore = {
    channel: () => Promise.resolve(channel),
    dirty: () => Promise.reject(new Error("unavailable")),
  };
  await assertRejects(() => receiveCalendarNotification(request(), store, NOW), Error, "unavailable");
});
