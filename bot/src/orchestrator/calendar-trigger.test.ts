/**
 * Автозапуск по календарю (T100): раз в минуту оркестратор забирает задания и поднимает бота
 * за владельца календаря. Правило то же, что у приглашений (D017), — про тишину: не пойдёт —
 * громкий отказ или строка в журнал, а не молчание.
 */
import { describe, expect, it } from "vitest";

import type { CalendarJob, CalendarSkip, CalendarSweep } from "./calendar-client.ts";
import { CalendarTrigger } from "./calendar-trigger.ts";

const HOUR_MS = 60 * 60_000;

function job(overrides: Partial<CalendarJob> = {}): CalendarJob {
  return {
    id: "job-1",
    calendar_key: "evt-1:2026-09-28",
    invited_by: 744_230_399,
    join_url: "https://meet.google.com/abc-defg-hij",
    platform: "meet",
    title: "Синк",
    starts_at: "2026-09-28T10:00:00.000Z",
    ends_at: "2026-09-28T10:30:00.000Z",
    ...overrides,
  };
}

function skip(overrides: Partial<CalendarSkip> = {}): CalendarSkip {
  return {
    invited_by: 744_230_399,
    calendar_key: "evt-2:2026-09-28",
    title: null,
    reason: "no_conference_link",
    ...overrides,
  };
}

function sweep(overrides: Partial<CalendarSweep> = {}): CalendarSweep {
  return { jobs: [], skipped: [], malformed: [], ...overrides };
}

interface Harness {
  readonly trigger: CalendarTrigger;
  readonly started: CalendarJob[];
  readonly refused: { job: CalendarJob; detail: string }[];
  readonly lines: string[];
  readonly batches: CalendarSweep[];
  nowMs: number;
  failStart: Error | null;
  failRefuse: Error | null;
  failSweep: Error | null;
}

function harness(): Harness {
  const state: Omit<Harness, "trigger"> = {
    started: [],
    refused: [],
    lines: [],
    batches: [],
    nowMs: Date.parse("2026-09-28T09:55:00.000Z"),
    failStart: null,
    failRefuse: null,
    failSweep: null,
  };
  const trigger = new CalendarTrigger({
    sweep: () => {
      if (state.failSweep !== null) return Promise.reject(state.failSweep);
      return Promise.resolve(state.batches.shift() ?? sweep());
    },
    start: (taken) => {
      if (state.failStart !== null) return Promise.reject(state.failStart);
      state.started.push(taken);
      return Promise.resolve(`c-${taken.id}`);
    },
    refuse: (taken, detail) => {
      if (state.failRefuse !== null) return Promise.reject(state.failRefuse);
      state.refused.push({ job: taken, detail });
      return Promise.resolve();
    },
    log: (line) => {
      state.lines.push(line);
    },
    now: () => state.nowMs,
  });
  return Object.assign(state, { trigger });
}

describe("CalendarTrigger.pollOnce", () => {
  it("задание на Meet — бот поднят от имени владельца календаря", async () => {
    const h = harness();
    h.batches.push(sweep({ jobs: [job()] }));

    await h.trigger.pollOnce();

    expect(h.started.map((taken) => [taken.id, taken.invited_by])).toEqual([
      ["job-1", 744_230_399],
    ]);
    expect(h.refused).toEqual([]);
    expect(h.lines.join("\n")).toMatch(/evt-1:2026-09-28.*c-job-1/u);
  });

  it("повтор того же задания в следующем проходе — второго бота нет", async () => {
    const h = harness();
    h.batches.push(sweep({ jobs: [job()] }), sweep({ jobs: [job()] }));

    await h.trigger.pollOnce();
    await h.trigger.pollOnce();

    expect(h.started).toHaveLength(1);
    expect(h.lines.join("\n")).toMatch(/job-1.*повторно/u);
  });

  it("не Meet — refuse с текстом площадки, контейнер не поднят", async () => {
    const h = harness();
    h.batches.push(sweep({ jobs: [job({ platform: "kontur" })] }));

    await h.trigger.pollOnce();

    expect(h.started).toEqual([]);
    expect(h.refused).toHaveLength(1);
    expect(h.refused[0]?.detail).toMatch(/Kontur\.Talk/u);
    expect(h.refused[0]?.detail).toMatch(/Google Meet/u);
  });

  it("start бросил — refuse со start_failed", async () => {
    const h = harness();
    h.failStart = new Error("no such image");
    h.batches.push(sweep({ jobs: [job()] }));

    await h.trigger.pollOnce();

    expect(h.refused).toHaveLength(1);
    expect(h.refused[0]?.detail).toContain("no such image");
  });

  it("refuse бросил — строка «ОТКАЗ НЕ ДОСТАВЛЕН», следующее задание всё равно обработано", async () => {
    const h = harness();
    h.failRefuse = new Error("meeting-notice 500");
    h.batches.push(
      sweep({
        jobs: [job({ id: "k", calendar_key: "evt-k", platform: "kontur" }), job({ id: "m" })],
      }),
    );

    await h.trigger.pollOnce();

    const lost = h.lines.find((line) => line.includes("ОТКАЗ НЕ ДОСТАВЛЕН"));
    expect(lost).toContain("meeting-notice 500");
    expect(h.started.map((taken) => taken.id)).toEqual(["m"]);
  });

  it("пропуск пишется в журнал один раз", async () => {
    const h = harness();
    h.batches.push(sweep({ skipped: [skip()] }));

    await h.trigger.pollOnce();

    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatch(/БОТ НЕ ПОЙДЁТ/u);
    expect(h.lines[0]).toContain("no_conference_link");
  });

  it("тот же пропуск в следующем проходе в пределах часа — молчание", async () => {
    const h = harness();
    h.batches.push(sweep({ skipped: [skip()] }), sweep({ skipped: [skip()] }));

    await h.trigger.pollOnce();
    h.nowMs += HOUR_MS - 1;
    await h.trigger.pollOnce();

    expect(h.lines).toHaveLength(1);
  });

  it("тот же пропуск через час — сказан снова", async () => {
    const h = harness();
    h.batches.push(sweep({ skipped: [skip()] }), sweep({ skipped: [skip()] }));

    await h.trigger.pollOnce();
    h.nowMs += HOUR_MS;
    await h.trigger.pollOnce();

    expect(h.lines).toHaveLength(2);
  });

  it("сбой sweep — строка в журнал, а не исключение наружу", async () => {
    const h = harness();
    h.failSweep = new Error("meeting-calendar 503");

    await expect(h.trigger.pollOnce()).resolves.toBeUndefined();

    expect(h.lines.join("\n")).toMatch(/опрос календарей не удался.*meeting-calendar 503/u);
  });

  it("забранное, но не разобранное задание — громко в журнал", async () => {
    const h = harness();
    h.batches.push(sweep({ jobs: [job()], malformed: ["jobs[1] (job-9): нет platform"] }));

    await h.trigger.pollOnce();

    expect(h.lines.join("\n")).toMatch(/ЗАДАНИЕ ПОТЕРЯНО.*job-9/u);
    expect(h.started).toHaveLength(1);
  });

  it("startedCount растёт с каждым новым заданием", async () => {
    const h = harness();
    h.batches.push(
      sweep({
        jobs: [job({ id: "a", calendar_key: "evt-a" }), job({ id: "b", calendar_key: "evt-b" })],
      }),
    );

    await h.trigger.pollOnce();

    expect(h.trigger.startedCount).toBe(2);
  });
});
