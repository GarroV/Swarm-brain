import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { EntryRow } from "./entries-guard.ts";
import { EntryAccessError } from "./entries-guard.ts";
import { handleMeetingContextRoutes, type MeetingContextDeps } from "./meeting-context-routes.ts";

const actor = { telegramId: 1001, groupId: "fictional-context", email: "self@example.invalid" };
const ctx = { supabase: {} as SupabaseClient, actor, origin: "https://example.invalid" };
const key = "synthetic-event:2026-11-14";
const event = {
  id: "synthetic-event",
  summary: "Dodo Pizza Bulgaria",
  start: { dateTime: "2026-11-14T10:00:00Z" },
  end: { dateTime: "2026-11-14T11:00:00Z" },
  attendees: [{ email: actor.email, self: true }, { email: "other@example.invalid" }],
};
const entry = {
  id: "published",
  metadata: { confirmed: true, title: "Synthetic previous", attendees: event.attendees },
  summary: "- Synthetic thesis",
  countries: ["BG"],
  entry_date: "2026-11-13",
  created_at: "2026-11-13T10:00:00Z",
} as unknown as EntryRow;
function fixture() {
  const calls: string[] = [];
  const deps: MeetingContextDeps = {
    todayCalendarEvents: (_sb, id, offset) => {
      calls.push(`calendar:${id}:${offset}`);
      return Promise.resolve({ ok: true, events: [event] });
    },
    loadContextEntry: (_sb, a, id) => {
      calls.push(`current:${a.telegramId}:${id}`);
      return Promise.resolve({ entry: { ...entry, id: "current" }, startsAt: "2026-11-14T10:00:00Z" });
    },
    loadContextCandidates: (_sb, a) => {
      calls.push(`candidates:${a.groupId}`);
      return Promise.resolve({
        candidates: [{
          id: entry.id,
          title: "Synthetic previous",
          date: "2026-11-13",
          startsAt: "2026-11-13T10:00:00Z",
          attendees: event.attendees,
        }],
        truncated: false,
      });
    },
    loadParticipantTasks: (_sb, a, attendees) => {
      calls.push(`tasks:${a.telegramId}:${attendees.length}`);
      return Promise.resolve({
        tasks: [{ id: "task", title: "Synthetic task", dueDate: null, status: "open" }],
        total: 1,
        truncated: false,
      });
    },
    getEntrySecure: (_sb, id, a) => {
      calls.push(`guard:${id}:${a.telegramId}:${a.groupId}`);
      return Promise.resolve(entry);
    },
  };
  return { deps, calls };
}
const req = (path: string, init?: RequestInit) => new Request(`https://example.invalid${path}`, init);
Deno.test("calendar context re-resolves only trusted actor calendar occurrence; returns three-block camelCase view, not roster/transcript", async () => {
  const { deps, calls } = fixture();
  const path = `/calendar/today/context?key=${key}&tz_offset=60&telegram_id=999`;
  const response = await handleMeetingContextRoutes(ctx, req(path), "/calendar/today/context", deps);
  assertEquals(response?.status, 200);
  assertEquals(await response?.json(), {
    meeting: { title: event.summary, startsAt: event.start.dateTime, countries: ["BG"] },
    previous: {
      id: entry.id,
      title: "Synthetic previous",
      date: "2026-11-13",
      summary: entry.summary,
      truncated: false,
    },
    previousTruncated: false,
    tasks: [{ id: "task", title: "Synthetic task", dueDate: null, status: "open" }],
    tasksTotal: 1,
    tasksTruncated: false,
  });
  assertEquals(calls, [
    "calendar:1001:60",
    "candidates:fictional-context",
    "tasks:1001:2",
    "guard:published:1001:fictional-context",
  ]);
});
Deno.test("unknown own-calendar key cannot fall back to client supplied participant data", async () => {
  const { deps, calls } = fixture();
  const response = await handleMeetingContextRoutes(
    ctx,
    req("/calendar/today/context?key=other&attendees=other@example.invalid"),
    "/calendar/today/context",
    deps,
  );
  assertEquals(response?.status, 404);
  assertEquals(calls, ["calendar:1001:0"]);
});
Deno.test("published current entry uses existing guard and not caller data; unpublished current returns404", async () => {
  const { deps, calls } = fixture();
  assertEquals(
    (await handleMeetingContextRoutes(ctx, req("/meetings/current/context"), "/meetings/current/context", deps))
      ?.status,
    200,
  );
  assertEquals(calls[0], "current:1001:current");
  deps.loadContextEntry = () => Promise.resolve(null);
  assertEquals(
    (await handleMeetingContextRoutes(ctx, req("/meetings/current/context"), "/meetings/current/context", deps))
      ?.status,
    404,
  );
});
Deno.test("calendar failures remain distinct503; wrong method/invalid input do not read data", async () => {
  const { deps, calls } = fixture();
  assertEquals(
    (await handleMeetingContextRoutes(
      ctx,
      req("/calendar/today/context", { method: "POST", body: "{}" }),
      "/calendar/today/context",
      deps,
    ))?.status,
    405,
  );
  assertEquals(
    (await handleMeetingContextRoutes(
      ctx,
      req("/calendar/today/context?key=x&tz_offset=9000"),
      "/calendar/today/context",
      deps,
    ))?.status,
    400,
  );
  assertEquals(calls, []);
  deps.todayCalendarEvents = () => Promise.resolve({ ok: false, reason: "calendar_error" });
  const response = await handleMeetingContextRoutes(
    ctx,
    req(`/calendar/today/context?key=${key}`),
    "/calendar/today/context",
    deps,
  );
  assertEquals(response?.status, 503);
  assertEquals(await response?.json(), { error: "calendar_error", code: "calendar_error" });
});
Deno.test("selected previous row is rechecked with the existing guard; inaccessible stays404 and truncation is explicit", async () => {
  const { deps } = fixture();
  deps.getEntrySecure = () => {
    throw new EntryAccessError(404, "Not found");
  };
  assertEquals(
    (await handleMeetingContextRoutes(ctx, req(`/calendar/today/context?key=${key}`), "/calendar/today/context", deps))
      ?.status,
    404,
  );
  deps.loadContextCandidates = () => Promise.resolve({ candidates: [], truncated: true });
  deps.loadParticipantTasks = () => Promise.resolve({ tasks: [], total: null, truncated: true });
  const response = await handleMeetingContextRoutes(
    ctx,
    req(`/calendar/today/context?key=${key}`),
    "/calendar/today/context",
    deps,
  );
  const view = await response?.json();
  assertEquals(view.previous, null);
  assertEquals(view.previousTruncated, true);
  assertEquals(view.tasksTotal, null);
  assertEquals(view.tasksTruncated, true);
});
