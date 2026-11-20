import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeMissStore, type MissRow } from "./calendar-miss-store.ts";
import type { ArrivalEvidence, MissRecord } from "./calendar-missed.ts";
import { recordSweepMisses } from "../meeting-calendar/missed.ts";
import { handleMissed, type MissedDeps } from "../meeting-missed/handle.ts";

const GROUP = "synthetic-group", KEY = "second-calendar-key";
const START = "2026-11-18T12:00:00Z", END = "2026-11-18T13:00:00Z";
const NOW = Date.parse("2026-11-18T12:10:00Z");
const ROOM = "https://meet.google.com/abc-defg-hij";
type Row = Record<string, unknown>;
type Slot = { join_url: string | null; starts_at: string | null };
const job = (over: Row = {}): Row => ({
  id: "second-job",
  group_id: GROUP,
  calendar_key: KEY,
  invited_by: 2,
  title: "Synthetic meeting",
  join_url: ROOM,
  platform: "meet",
  starts_at: START,
  ends_at: END,
  taken_at: START,
  arrival_checked_at: null,
  ...over,
});
const primary = (over: Row = {}) =>
  job({ id: "first-job", calendar_key: "first-calendar-key", invited_by: 1, ...over });
const heartbeat = (over: Row = {}): Row => ({
  id: "first-meeting",
  group_id: GROUP,
  identity_key: "first-calendar-key",
  agent_last_seen_at: "2026-11-18T12:01:00Z",
  ...over,
});

/** Real SDK/PostgREST requests, synthetic rows only: filters and projection apply before returning data. */
function fixture(
  opts: { jobs?: Row[]; meetings?: Row[]; notices?: Row[]; fail?: (table: string, url: URL) => boolean } = {},
) {
  const tables: Record<string, Row[]> = {
    meeting_calendar_jobs: opts.jobs ?? [job(), primary()],
    meetings: opts.meetings ?? [heartbeat()],
    meeting_notices: opts.notices ?? [],
    meeting_calendar_misses: [],
  };
  const requests: Array<{ table: string; method: string; query: string }> = [];
  const recorded: MissRecord[] = [], checked: string[] = [];
  const matches = (row: Row, url: URL) =>
    [...url.searchParams].every(([key, value]) => {
      if (["select", "limit", "order", "on_conflict"].includes(key)) return true;
      const actual = row[key];
      if (value === "is.null") return actual == null;
      if (value === "not.is.null") return actual != null;
      if (value.startsWith("eq.")) {
        return key.endsWith("_at")
          ? Date.parse(String(actual)) === Date.parse(value.slice(3))
          : String(actual) === value.slice(3);
      }
      if (value.startsWith("neq.")) return String(actual) !== value.slice(4);
      if (value.startsWith("in.(")) {
        return value.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(actual));
      }
      if (value.startsWith("gte.")) return Date.parse(String(actual)) >= Date.parse(value.slice(4));
      if (value.startsWith("gt.")) return Date.parse(String(actual)) > Date.parse(value.slice(3));
      throw new Error("unexpected synthetic filter");
    });
  const sb = createClient("https://calendar-fixture.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const req = new Request(input, init), url = new URL(req.url), table = url.pathname.split("/").pop()!;
        assertEquals(url.origin, "https://calendar-fixture.invalid");
        if (!(table in tables)) throw new Error("unknown synthetic table");
        requests.push({ table, method: req.method, query: url.search });
        const send = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        if (opts.fail?.(table, url)) return send({ message: "synthetic database failure", code: "XX000" }, 503);
        let rows = tables[table].filter((r) => matches(r, url));
        if (req.method === "POST" && table === "meeting_calendar_misses") {
          const body = await req.json();
          recorded.push(...body);
          return send([], 201);
        }
        if (req.method === "PATCH" && table === "meeting_calendar_jobs") {
          const patch = await req.json();
          for (const r of rows) {
            Object.assign(r, patch);
            checked.push(String(r.id));
          }
          return send([]);
        }
        assertEquals(req.method, "GET");
        const limit = url.searchParams.get("limit");
        if (limit) rows = rows.slice(0, Number(limit));
        const columns = url.searchParams.get("select")?.split(",");
        return send(columns ? rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))) : rows);
      },
    },
  });
  const store = makeMissStore(sb);
  // Also executes against the original three-argument method for the regression RED.
  const arrival: (g: string, k: string, r: number, slot?: Slot) => Promise<ArrivalEvidence> = store.arrivalEvidence;
  return { store, arrival, recorded, checked, requests };
}
const slot: Slot = { join_url: ROOM + "?authuser=1", starts_at: START };
const quiet = () => {};

Deno.test("secondary calendar key sees a real heartbeat in the same group/room/UTC slot", async () => {
  const f = fixture();
  assertEquals(await f.arrival(GROUP, KEY, 2, slot), { botSeen: true, noticeSent: false });
});
Deno.test("equivalent UTC starts and canonical room variants share arrival evidence", async () => {
  const f = fixture({
    jobs: [job(), primary({ starts_at: "2026-11-18T13:00:00+01:00", join_url: ROOM + "?authuser=0" })],
  });
  assertEquals(await f.arrival(GROUP, KEY, 2, { ...slot, starts_at: "2026-11-18T15:00:00+03:00" }), {
    botSeen: true,
    noticeSent: false,
  });
  const query = f.requests.find((r) => r.table === "meeting_calendar_jobs")!.query;
  assertEquals(new URLSearchParams(query).get("starts_at"), "eq.2026-11-18T12:00:00.000Z");
});
Deno.test("a taken job alone is not arrival, and a missing heartbeat remains not_arrived", async () => {
  for (const meetings of [[], [heartbeat({ agent_last_seen_at: null })]]) {
    const f = fixture({ meetings });
    assertEquals(await f.arrival(GROUP, KEY, 2, slot), { botSeen: false, noticeSent: false });
    const result = await recordSweepMisses(f.store, GROUP, [], NOW, quiet);
    assertEquals(result, { recorded: 2, failed: 0 });
    assertEquals(f.recorded.map((r) => r.reason), ["not_arrived", "not_arrived"]);
  }
});
Deno.test("other room/time/group, untaken jobs and old or foreign heartbeats never cover the slot", async () => {
  for (
    const over of [
      { jobs: [job(), primary({ join_url: "https://meet.google.com/zzz-zzzz-zzz" })] },
      { jobs: [job(), primary({ starts_at: "2026-11-18T12:00:01Z" })] },
      { jobs: [job(), primary({ group_id: "different-group" })] },
      { jobs: [job(), primary({ taken_at: null })] },
      { meetings: [heartbeat({ agent_last_seen_at: "2026-11-18T11:59:59Z" })] },
      { meetings: [heartbeat({ group_id: "different-group" })] },
    ]
  ) assertEquals(await fixture(over).arrival(GROUP, KEY, 2, slot), { botSeen: false, noticeSent: false });
});
Deno.test("missing/invalid slot context cannot claim another key's heartbeat", async () => {
  const f = fixture();
  for (
    const context of [undefined, { join_url: null, starts_at: START }, { join_url: ROOM, starts_at: null }, {
      join_url: ROOM,
      starts_at: "bad-date",
    }]
  ) {
    assertEquals(await f.arrival(GROUP, KEY, 2, context), { botSeen: false, noticeSent: false });
  }
});
Deno.test("direct key arrival short-circuits unchanged; sibling notices do not change recipient notice semantics", async () => {
  const direct = fixture({ meetings: [heartbeat({ identity_key: KEY, agent_last_seen_at: "2026-11-18T11:00:00Z" })] });
  assertEquals(await direct.arrival(GROUP, KEY, 2, slot), { botSeen: true, noticeSent: false });
  assertEquals(direct.requests.length, 1);
  const ownNotice = fixture({
    meetings: [],
    notices: [{ id: "n", recipient_id: 2, status: "sent", meeting_key: KEY }],
  });
  assertEquals(await ownNotice.arrival(GROUP, KEY, 2, slot), { botSeen: false, noticeSent: true });
  const otherNotice = fixture({
    meetings: [],
    notices: [{ id: "n", recipient_id: 1, status: "sent", meeting_key: "first-calendar-key" }],
  });
  assertEquals(await otherNotice.arrival(GROUP, KEY, 2, slot), { botSeen: false, noticeSent: false });
});
Deno.test("calendar sweep passes the actual job slot and records no false not_arrived", async () => {
  const f = fixture();
  assertEquals(await recordSweepMisses(f.store, GROUP, [], NOW, quiet), { recorded: 0, failed: 0 });
  assertEquals(f.recorded, []);
  assertEquals(f.checked, ["second-job", "first-job"]);
});
Deno.test("fallback database failures propagate and never mark the sweep checked", async () => {
  for (
    const fail of [
      (t: string) => t === "meeting_calendar_jobs",
      (t: string, u: URL) => t === "meetings" && u.searchParams.get("identity_key")?.startsWith("in.") === true,
    ]
  ) {
    const f = fixture({ fail });
    await assertRejects(() => f.arrival(GROUP, KEY, 2, slot));
    const swept = await recordSweepMisses(f.store, GROUP, [], NOW, quiet);
    assertEquals(swept.failed > 0, true);
    assertEquals(f.checked.includes("second-job"), false);
    assertEquals(f.recorded, []);
  }
});
function deps(f: ReturnType<typeof fixture>, existing: MissRow[] = []): MissedDeps {
  return {
    identify: () => Promise.resolve({ telegramId: 2, groupId: GROUP }),
    autojoin: () => Promise.resolve(true),
    snapshotRun: () => Promise.resolve({ snapshot_at: START, attempted_at: START, outcome: "ok" }),
    snapshotEvents: () =>
      Promise.resolve([{
        calendar_key: KEY,
        outcome: "expected",
        title: "Synthetic meeting",
        join_url: ROOM,
        platform: "meet",
        starts_at: START,
        ends_at: END,
      }]),
    manualRooms: () => Promise.resolve(new Set()),
    store: f.store,
    openMisses: () => Promise.resolve(existing),
    missById: () => Promise.resolve(null),
    attachInvite: () => Promise.reject(new Error("unexpected mutation")),
    createInvite: () => Promise.reject(new Error("unexpected invite")),
    readInvite: () => Promise.reject(new Error("unexpected invite")),
    log: quiet,
    now: () => NOW,
  };
}
const missed = (): MissRow => ({
  id: "synthetic-miss",
  group_id: GROUP,
  invited_by: 2,
  miss_key: KEY,
  calendar_key: KEY,
  reason: "not_arrived",
  title: "Synthetic meeting",
  join_url: ROOM,
  platform: "meet",
  starts_at: START,
  ends_at: END,
  detected_at: START,
  invite_id: null,
});
Deno.test("meeting-missed passes the actual snapshot job and existing miss slot, without exposing sibling data", async () => {
  const f = fixture(), response = await handleMissed(new Request("https://fixture.invalid/"), deps(f, [missed()]));
  assertEquals(response.status, 200);
  assertEquals(f.recorded, []);
  const body = await response.json();
  assertEquals(body.misses, []);
  assertEquals(Object.keys(body).sort(), ["autojoin", "checked", "misses", "snapshot_at"]);
});
Deno.test("meeting-missed reports checked false on slot evidence DB error, instead of a false ready check", async () => {
  const f = fixture({ fail: (t, u) => t === "meeting_calendar_jobs" && u.searchParams.has("starts_at") }),
    response = await handleMissed(new Request("https://fixture.invalid/"), deps(f));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).checked, false);
  assertEquals(f.recorded, []);
});
