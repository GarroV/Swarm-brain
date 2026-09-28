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

interface FakeJob extends DispatchJob {
  taken: boolean;
}

/** Таблица заданий как в базе: одно на встречу воркспейса, забор — только незабранных. */
function fakeSource(
  over: Partial<SweepSource> & { tokens?: Record<number, string | null>; seed?: FakeJob[] } = {},
) {
  const table: FakeJob[] = [...(over.seed ?? [])];
  const inserted: DispatchJob[] = [];
  const source: SweepSource = {
    autojoinPeople: () => Promise.resolve([1]),
    liveInviteLinks: () => Promise.resolve([]),
    refreshToken: (id) => Promise.resolve(over.tokens ? (over.tokens[id] ?? null) : "r"),
    accessToken: () => Promise.resolve({ ok: true, token: "a" }),
    listEvents: () => Promise.resolve([meeting()]),
    insertJobs: (_g, jobs) => {
      inserted.push(...jobs);
      for (const j of jobs) {
        if (!table.some((t) => t.calendar_key === j.calendar_key)) table.push({ ...j, taken: false });
      }
      return Promise.resolve();
    },
    dropPendingJobsExcept: (_g, people) => {
      for (let i = table.length - 1; i >= 0; i--) {
        if (!table[i].taken && !people.includes(table[i].invited_by)) table.splice(i, 1);
      }
      return Promise.resolve();
    },
    takeJobs: (_g, _a, _now, people) => {
      const out: TakenJob[] = [];
      table.forEach((t, i) => {
        if (t.taken || !people.includes(t.invited_by)) return;
        t.taken = true;
        const { taken: _, ...job } = t;
        out.push({ ...job, id: `job${i}` });
      });
      return Promise.resolve(out);
    },
    ...over,
  };
  return { source, inserted, table };
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

// ── Выключение автозапуска гасит и заведённые, но не забранные задания (D021, разбор прав T100) ──

const PENDING_OF_1: FakeJob = {
  calendar_key: "u:2026-09-28",
  invited_by: 1,
  join_url: MEET,
  platform: "meet",
  title: null,
  starts_at: "2026-09-28T07:01:00Z",
  ends_at: "2026-09-28T07:30:00Z",
  taken: false,
};

Deno.test("ПРАВА: выключил автозапуск после того, как задание завели, — задание гасится, бот не идёт", async () => {
  const { source, table } = fakeSource({ autojoinPeople: () => Promise.resolve([]), seed: [{ ...PENDING_OF_1 }] });
  const result = await sweep(source, AGENT, NOW);
  assertEquals(result.jobs, []);
  assertEquals(table, []);
});

Deno.test("ПРАВА: выключил между чтением списка и забором — согласие перечитывается перед забором", async () => {
  let calls = 0;
  const { source, table } = fakeSource({
    autojoinPeople: () => Promise.resolve(calls++ === 0 ? [1] : []),
  });
  const result = await sweep(source, AGENT, NOW);
  assertEquals(result.jobs, []);
  assertEquals(table, []);
});

Deno.test("у коллеги та же встреча, первый выключил — задание переходит к коллеге, бот идёт за него", async () => {
  const { source } = fakeSource({ autojoinPeople: () => Promise.resolve([2]), seed: [{ ...PENDING_OF_1 }] });
  const result = await sweep(source, AGENT, NOW);
  assertEquals(result.jobs.map((j) => [j.invited_by, j.calendar_key]), [[2, "u:2026-09-28"]]);
});

Deno.test("забранное задание выключение не трогает: бот уже поднимается, его уход решает встреча", async () => {
  const { source, table } = fakeSource({
    autojoinPeople: () => Promise.resolve([]),
    seed: [{ ...PENDING_OF_1, taken: true }],
  });
  const result = await sweep(source, AGENT, NOW);
  assertEquals(result.jobs, []);
  assertEquals(table.length, 1);
});
