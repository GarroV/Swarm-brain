// Проход снимка календаря (T164, D023): что пишется по человеку при каждом ответе Google.
// Главное: Google моргнул — прежний снимок не затирается; сбой одного человека не роняет остальных.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { GEvent } from "../meeting-current/select.ts";
import type { MissRecord } from "../_shared/calendar-missed.ts";
import type { SnapshotEvent } from "../_shared/calendar-snapshot.ts";
import { type RunWrite, snapshotAll, type SnapshotDeps, type SnapshotPerson } from "./run.ts";

// 08:00 по Белграду.
const NOW = Date.parse("2026-09-28T06:00:00Z");
const NOW_ISO = new Date(NOW).toISOString();
const A: SnapshotPerson = { telegramId: 1, groupId: "g" };
const B: SnapshotPerson = { telegramId: 2, groupId: "g" };

const MEETING: GEvent = {
  id: "m1",
  iCalUID: "m1",
  summary: "Sync",
  status: "confirmed",
  start: { dateTime: "2026-09-28T09:00:00Z" },
  end: { dateTime: "2026-09-28T09:30:00Z" },
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  organizer: { self: true }, // своя встреча без гостей — «да» (D024)
} as GEvent;

interface Log {
  windows: string[];
  events: { person: number; at: string; rows: readonly SnapshotEvent[] }[];
  runs: { person: number; run: RunWrite }[];
  misses: MissRecord[];
  lines: string[];
}

function deps(over: Partial<SnapshotDeps> = {}): { deps: SnapshotDeps; log: Log } {
  const log: Log = { windows: [], events: [], runs: [], misses: [], lines: [] };
  const d: SnapshotDeps = {
    people: () => Promise.resolve([A]),
    refreshToken: () => Promise.resolve("refresh"),
    accessToken: () => Promise.resolve({ ok: true, token: "t" }),
    listEvents: (_t, min, max) => {
      log.windows.push(`${min}..${max}`);
      return Promise.resolve([MEETING]);
    },
    saveEvents: (p, at, rows) => {
      log.events.push({ person: p.telegramId, at, rows });
      return Promise.resolve();
    },
    saveRun: (p, run) => {
      log.runs.push({ person: p.telegramId, run });
      return Promise.resolve();
    },
    recordMisses: (_g, m) => {
      log.misses.push(...m);
      return Promise.resolve();
    },
    log: (l) => log.lines.push(l),
    ...over,
  };
  return { deps: d, log };
}

Deno.test("календарь прочитан: встречи до полуночи по Белграду, у человека — время снимка", async () => {
  const { deps: d, log } = deps();
  const report = await snapshotAll(d, NOW);
  assertEquals(log.windows, [`${NOW_ISO}..2026-09-28T22:00:00.000Z`]);
  assertEquals(log.events.map((e) => [e.person, e.at, e.rows.map((r) => r.outcome)]), [[1, NOW_ISO, ["expected"]]]);
  assertEquals(log.runs, [{ person: 1, run: { attempted_at: NOW_ISO, outcome: "ok", snapshot_at: NOW_ISO } }]);
  assertEquals(log.misses, []);
  assertEquals(report.ok, 1);
  assertEquals(report.events, 1);
});

Deno.test("Google не ответил — прежний снимок в силе: ни строк, ни snapshot_at, ни пропуска", async () => {
  for (
    const over of [
      { accessToken: () => Promise.resolve({ ok: false as const, deadGrant: false }) },
      { listEvents: () => Promise.resolve(null) },
    ]
  ) {
    const { deps: d, log } = deps(over);
    const report = await snapshotAll(d, NOW);
    assertEquals(log.events, []);
    assertEquals(log.runs, [{ person: 1, run: { attempted_at: NOW_ISO, outcome: "calendar_unavailable" } }]);
    assertEquals(log.misses, []);
    assertEquals(report.calendar_unavailable, 1);
  }
});

Deno.test("календаря нет или доступ умер — пропуск человека на сегодня пишется сразу", async () => {
  const cases = [
    { over: { refreshToken: () => Promise.resolve(null) }, reason: "calendar_not_connected" },
    {
      over: { accessToken: () => Promise.resolve({ ok: false as const, deadGrant: true }) },
      reason: "calendar_token_dead",
    },
  ] as const;
  for (const { over, reason } of cases) {
    const { deps: d, log } = deps(over);
    await snapshotAll(d, NOW);
    assertEquals(log.misses.map((m) => `${m.invited_by}:${m.miss_key}:${m.reason}`), [
      `1:autojoin:2026-09-28:${reason}`,
    ]);
    assertEquals(log.runs, [{ person: 1, run: { attempted_at: NOW_ISO, outcome: reason } }]);
    assertEquals(log.events, []);
  }
});

Deno.test("сбой базы на одном человеке не останавливает остальных и не выдаётся за успех", async () => {
  const { deps: d, log } = deps({
    people: () => Promise.resolve([A, B]),
    saveEvents: (p, at, rows) => {
      if (p.telegramId === A.telegramId) return Promise.reject(new Error("db down"));
      log.events.push({ person: p.telegramId, at, rows });
      return Promise.resolve();
    },
  });
  const report = await snapshotAll(d, NOW);
  assertEquals(report.failed, 1);
  assertEquals(report.ok, 1);
  // У A время снимка не сдвинулось: встречи не записаны.
  assertEquals(log.runs.map((r) => r.person), [2]);
  assertEquals(log.lines.length, 1);
});
