// Запись пропусков на опросе оркестратора (T102): незаписанное не считается проверенным.
//
// Проверяется то, что ломается молча: сбой записи, после которого проверка «дошёл ли бот» закрыта
// навсегда (человек так и не узнает), и тихие причины, попавшие в пропуски (рекордер зовёт на обед).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { DispatchSkip } from "../_shared/calendar-dispatch.ts";
import { ARRIVAL_GRACE_MS, type ArrivalEvidence, type MissRecord } from "../_shared/calendar-missed.ts";
import type { JobRow, MissStore } from "../_shared/calendar-miss-store.ts";
import { recordSweepMisses } from "./missed.ts";

const NOW = Date.parse("2026-09-28T10:00:00+02:00");
const GROUP = "g1";

function job(id: string): JobRow {
  return {
    id,
    calendar_key: `key-${id}`,
    invited_by: 111,
    title: "Sync",
    join_url: "https://meet.google.com/abc-defg-hij",
    platform: "meet",
    starts_at: new Date(NOW - ARRIVAL_GRACE_MS).toISOString(),
    ends_at: new Date(NOW + 3_600_000).toISOString(),
    taken_at: new Date(NOW - ARRIVAL_GRACE_MS).toISOString(),
    arrival_checked_at: null,
  };
}

interface Fake {
  store: MissStore;
  recorded: MissRecord[];
  checked: string[];
}

function fake(opts: { candidates?: JobRow[]; evidence?: ArrivalEvidence; failRecord?: boolean } = {}): Fake {
  const f: Fake = { recorded: [], checked: [], store: null as unknown as MissStore };
  f.store = {
    recordMisses: (_g, misses) => {
      if (opts.failRecord) return Promise.reject(new Error("db down"));
      f.recorded.push(...misses);
      return Promise.resolve();
    },
    arrivalCandidates: () => Promise.resolve(opts.candidates ?? []),
    markArrivalChecked: (id) => {
      f.checked.push(id);
      return Promise.resolve();
    },
    jobsFor: () => Promise.resolve([]),
    arrivalEvidence: () => Promise.resolve(opts.evidence ?? { botSeen: false, noticeSent: false }),
  };
  return f;
}

const log = () => {};
const loud: DispatchSkip = {
  invited_by: 111,
  calendar_key: "k1",
  title: "Sync",
  reason: "unrecognized_link",
  starts_at: "2026-09-28T10:00:00+02:00",
  ends_at: "2026-09-28T11:00:00+02:00",
};
const quiet: DispatchSkip = { ...loud, calendar_key: "k2", title: "Lunch", reason: "no_conference_link" };

Deno.test("пропуск записывается, тихая причина — нет", async () => {
  const f = fake();
  const r = await recordSweepMisses(f.store, GROUP, [loud, quiet], NOW, log);
  assertEquals(r, { recorded: 1, failed: 0 });
  assertEquals(f.recorded.map((m) => `${m.miss_key}:${m.reason}`), ["k1:unrecognized_link"]);
});

Deno.test("бот дошёл — проверка закрыта без пропуска; не дошёл — пропуск записан и закрыто", async () => {
  const alive = fake({ candidates: [job("j1")], evidence: { botSeen: true, noticeSent: false } });
  await recordSweepMisses(alive.store, GROUP, [], NOW, log);
  assertEquals(alive.recorded, []);
  assertEquals(alive.checked, ["j1"]);

  const lost = fake({ candidates: [job("j2")] });
  await recordSweepMisses(lost.store, GROUP, [], NOW, log);
  assertEquals(lost.recorded.map((m) => `${m.miss_key}:${m.reason}`), ["key-j2:not_arrived"]);
  assertEquals(lost.checked, ["j2"]);
});

Deno.test("база не приняла пропуск — проверка остаётся открытой для следующего опроса", async () => {
  const f = fake({ candidates: [job("j1")], failRecord: true });
  const r = await recordSweepMisses(f.store, GROUP, [], NOW, log);
  assertEquals(r.failed, 1);
  assertEquals(f.checked, []);
});

Deno.test("запас после забора не прошёл — задание не трогаем вовсе", async () => {
  const early = { ...job("j1"), taken_at: new Date(NOW - 60_000).toISOString() };
  const f = fake({ candidates: [early] });
  await recordSweepMisses(f.store, GROUP, [], NOW, log);
  assertEquals(f.checked, []);
  assertEquals(f.recorded, []);
});
