import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { futureCalendarEvents, stopCalendar, watchCalendar } from "./calendar-push-google.ts";

Deno.test("watch uses existing bearer grant and private channel token; renewal returns provider expiry", async () => {
  const original = globalThis.fetch;
  const expiry = Date.now() + 3600_000;
  globalThis.fetch = (input, init) => {
    assertEquals(String(input), "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch");
    assertEquals(new Headers(init?.headers).get("authorization"), "Bearer test-only");
    const body = JSON.parse(String(init?.body));
    assertEquals(body.params.ttl, "604800");
    assertEquals(body.token, "channel-only");
    return Promise.resolve(Response.json({ id: body.id, resourceId: "resource", expiration: String(expiry) }));
  };
  try {
    assertEquals(
      (await watchCalendar("test-only", "id", "channel-only", "https://example.invalid/calendar-push")).expiration,
      expiry,
    );
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("Google permission failure stays a failure without scope fallback", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve(new Response("", { status: 403 }));
  };
  try {
    await assertRejects(
      () => watchCalendar("test-only", "id", "channel-only", "https://example.invalid/calendar-push"),
      Error,
      "calendar_google_403",
    );
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("snapshot follows all pages and accepts an empty items field", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (input) => {
    calls++;
    if (calls === 1) return Promise.resolve(Response.json({ items: [{ id: "one" }], nextPageToken: "next" }));
    assertEquals(new URL(String(input)).searchParams.get("pageToken"), "next");
    return Promise.resolve(Response.json({ kind: "calendar#events" }));
  };
  try {
    assertEquals((await futureCalendarEvents("test-only", "from", "to")).map((e) => e.id), ["one"]);
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("partial paginated snapshot is never returned as a complete deletion plan", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () =>
    Promise.resolve(
      ++calls === 1
        ? Response.json({ items: [{ id: "one" }], nextPageToken: "next" })
        : new Response("", { status: 503 }),
    );
  try {
    await assertRejects(() => futureCalendarEvents("test-only", "from", "to"), Error, "calendar_google_503");
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("stop is idempotent when Google has already expired the channel", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("", { status: 404 }));
  try {
    await stopCalendar("test-only", "id", "resource");
  } finally {
    globalThis.fetch = original;
  }
});
