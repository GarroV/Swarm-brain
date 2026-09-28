// Проход автозапуска без живого календаря: причины уровня человека громкие (D015), ручное приглашение
// на ту же комнату не даёт второго бота, задание заводится и забирается.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GEvent } from "../meeting-current/select.ts";
import type { DispatchJob } from "../_shared/calendar-dispatch.ts";
import { sweep, type SweepSource, type TakenJob } from "./sweep.ts";

const NOW = Date.parse("2026-09-28T07:00:00Z");
const AGENT = { agentId: "scriba", groupId: "g1" };
const MEET = "https://meet.google.com/abc-defg-hij";

function meeting(): GEvent {
  return {
    id: "e",
    iCalUID: "u",
    start: { dateTime: "2026-09-28T07:01:00Z" },
    end: { dateTime: "2026-09-28T07:30:00Z" },
    hangoutLink: MEET,
  };
}

function fakeSource(over: Partial<SweepSource> & { tokens?: Record<number, string | null> } = {}) {
  const inserted: DispatchJob[] = [];
  const source: SweepSource = {
    autojoinPeople: () => Promise.resolve([1]),
    liveInviteLinks: () => Promise.resolve([]),
    refreshToken: (id) => Promise.resolve(over.tokens ? (over.tokens[id] ?? null) : "r"),
    accessToken: () => Promise.resolve({ ok: true, token: "a" }),
    listEvents: () => Promise.resolve([meeting()]),
    insertJobs: (_g, jobs) => {
      inserted.push(...jobs);
      return Promise.resolve();
    },
    takeJobs: () => Promise.resolve(inserted.map((j, i): TakenJob => ({ ...j, id: `job${i}` }))),
    ...over,
  };
  return { source, inserted };
}

Deno.test("встреча Meet в окне — задание заведено и отдано оркестратору", async () => {
  const { source, inserted } = fakeSource();
  const result = await sweep(source, AGENT, NOW);
  assertEquals(inserted.length, 1);
  assertEquals(result.jobs.map((j) => [j.invited_by, j.calendar_key]), [[1, "u:2026-09-28"]]);
  assertEquals(result.skipped, []);
});

Deno.test("ГРОМКО: календарь не подключён / токен мёртв / Google не ответил — причина у человека", async () => {
  const cases: Array<[Partial<SweepSource> & { tokens?: Record<number, string | null> }, string]> = [
    [{ tokens: { 1: null } }, "calendar_not_connected"],
    [{ accessToken: () => Promise.resolve({ ok: false, deadGrant: true }) }, "calendar_token_dead"],
    [{ accessToken: () => Promise.resolve({ ok: false, deadGrant: false }) }, "calendar_unavailable"],
    [{ listEvents: () => Promise.resolve(null) }, "calendar_unavailable"],
  ];
  for (const [over, reason] of cases) {
    const { source, inserted } = fakeSource(over);
    const result = await sweep(source, AGENT, NOW);
    assertEquals(inserted, []);
    assertEquals(result.skipped, [{ invited_by: 1, calendar_key: null, title: null, reason: reason as never }]);
  }
});

Deno.test("живое ручное приглашение на ту же комнату — задание не заводится", async () => {
  const { source, inserted } = fakeSource({ liveInviteLinks: () => Promise.resolve([`${MEET}?hl=en`]) });
  const result = await sweep(source, AGENT, NOW);
  assertEquals(inserted, []);
  assertEquals(result.skipped.map((s) => s.reason), ["manual_invite_exists"]);
});

Deno.test("никто не включил автозапуск — в календари не ходим вовсе", async () => {
  let asked = 0;
  const { source } = fakeSource({
    autojoinPeople: () => Promise.resolve([]),
    refreshToken: () => {
      asked++;
      return Promise.resolve("r");
    },
  });
  const result = await sweep(source, AGENT, NOW);
  assertEquals(asked, 0);
  assertEquals(result, { jobs: [], skipped: [] });
});
