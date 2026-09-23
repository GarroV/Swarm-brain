import { describe, expect, it } from "vitest";

import { ALONE_TIMEOUT_MS, AloneTimer, watchAlone } from "./alone.ts";

describe("AloneTimer", () => {
  it("порог по спеке — две минуты", () => {
    expect(ALONE_TIMEOUT_MS).toBe(120_000);
  });

  it("первое одиночество уходить не велит", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    expect(timer.observe(true, 0)).toBe(false);
  });

  it("две минуты один — пора выходить", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 0);
    expect(timer.observe(true, 119_000)).toBe(false);
    expect(timer.observe(true, 120_000)).toBe(true);
  });

  it("кто-то вернулся — отсчёт начинается заново", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 0);
    timer.observe(false, 60_000);
    timer.observe(true, 60_001);
    expect(timer.observe(true, 180_000)).toBe(false);
    expect(timer.observe(true, 180_001)).toBe(true);
  });

  it("сигнал не прочитался — это не одиночество: отсчёт сбрасывается", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 0);
    expect(timer.observe(null, 60_000)).toBe(false);
    expect(timer.observe(true, 121_000)).toBe(false);
    expect(timer.observe(true, 240_999)).toBe(false);
    expect(timer.observe(true, 241_000)).toBe(true);
  });

  it("сколько секунд бот уже один — для лога и уведомления", () => {
    const timer = new AloneTimer(ALONE_TIMEOUT_MS);
    timer.observe(true, 1000);
    expect(timer.aloneForMs(61_000)).toBe(60_000);
    timer.observe(false, 61_000);
    expect(timer.aloneForMs(62_000)).toBe(0);
  });
});

interface FakeClock {
  readonly now: () => number;
  readonly sleep: () => Promise<void>;
}

function fakeClock(stepMs: number): FakeClock {
  let value = 0;
  return {
    now: (): number => value,
    sleep: (): Promise<void> => {
      value += stepMs;
      return Promise.resolve();
    },
  };
}

describe("watchAlone", () => {
  it("бот один — через две минуты сторож зовёт выход", async () => {
    const clock = fakeClock(5000);
    let left = 0;

    const isResult = await watchAlone({
      probe: (): Promise<boolean | null> => Promise.resolve(true),
      onLeave: (): Promise<void> => {
        left += 1;
        return Promise.resolve();
      },
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(isResult).toBe(true);
    expect(left).toBe(1);
    expect(clock.now()).toBe(ALONE_TIMEOUT_MS);
  });

  it("люди в звонке есть — сторож не выходит никогда", async () => {
    const clock = fakeClock(5000);
    let checks = 0;
    let left = 0;

    const isResult = await watchAlone({
      probe: (): Promise<boolean | null> => {
        checks += 1;
        return Promise.resolve(false);
      },
      onLeave: (): Promise<void> => {
        left += 1;
        return Promise.resolve();
      },
      now: clock.now,
      sleep: clock.sleep,
      stopped: (): boolean => checks >= 100,
    });

    expect(isResult).toBe(false);
    expect(left).toBe(0);
  });

  it("сигнал не читается — выхода нет, сколько бы ни ждали", async () => {
    const clock = fakeClock(5000);
    let checks = 0;
    let left = 0;

    await watchAlone({
      probe: (): Promise<boolean | null> => {
        checks += 1;
        return Promise.resolve(null);
      },
      onLeave: (): Promise<void> => {
        left += 1;
        return Promise.resolve();
      },
      now: clock.now,
      sleep: clock.sleep,
      stopped: (): boolean => checks >= 100,
    });

    expect(left).toBe(0);
    expect(clock.now()).toBeGreaterThan(ALONE_TIMEOUT_MS);
  });

  it("без подставленных часов сторож работает на настоящих: спит и выходит", async () => {
    let seen = 0;
    let left = 0;

    const hasLeft = await watchAlone({
      probe: (): Promise<boolean | null> => {
        seen += 1;
        return Promise.resolve(seen > 1);
      },
      onLeave: (): Promise<void> => {
        left += 1;
        return Promise.resolve();
      },
      thresholdMs: 0,
      pollMs: 1,
    });

    expect(hasLeft).toBe(true);
    expect(left).toBe(1);
    expect(seen).toBe(2);
  });
});
