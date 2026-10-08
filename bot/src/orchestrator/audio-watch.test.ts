import { describe, expect, it } from "vitest";

import { QuietEndTimer, SilenceWatch } from "./audio-watch.ts";

const MINUTE = 60_000;

describe("SilenceWatch", () => {
  it("тишина при людях дольше порога — одна тревога", () => {
    const watch = new SilenceWatch(3 * MINUTE);
    const alerts = [0, 1, 2, 3, 4, 5].map((minute) =>
      watch.observe({ silent: true, alone: false }, minute * MINUTE),
    );

    expect(alerts).toEqual([null, null, null, "silent", null, null]);
  });

  it("звук посреди отсчёта сбрасывает его", () => {
    const watch = new SilenceWatch(3 * MINUTE);
    watch.observe({ silent: true, alone: false }, 0);
    watch.observe({ silent: false, alone: false }, 2 * MINUTE);

    expect(watch.observe({ silent: true, alone: false }, 4 * MINUTE)).toBeNull();
    expect(watch.observe({ silent: true, alone: false }, 7 * MINUTE)).toBe("silent");
  });

  it("бот один или сигнала об участниках нет — отсчёт сбрасывается", () => {
    const watch = new SilenceWatch(3 * MINUTE);
    watch.observe({ silent: true, alone: false }, 0);
    watch.observe({ silent: true, alone: true }, 2 * MINUTE);
    watch.observe({ silent: true, alone: null }, 3 * MINUTE);

    expect(watch.observe({ silent: true, alone: false }, 4 * MINUTE)).toBeNull();
  });

  it("после «вернулся» сторож молчит до конца встречи", () => {
    const watch = new SilenceWatch(MINUTE);
    watch.observe({ silent: true, alone: false }, 0);

    expect(watch.observe({ silent: true, alone: false }, MINUTE)).toBe("silent");
    expect(watch.observe({ silent: null, alone: false }, 2 * MINUTE)).toBeNull();
    expect(watch.observe({ silent: false, alone: false }, 3 * MINUTE)).toBe("back");
    expect(watch.observe({ silent: true, alone: false }, 10 * MINUTE)).toBeNull();
    expect(watch.observe({ silent: false, alone: false }, 11 * MINUTE)).toBeNull();
  });
});

describe("QuietEndTimer", () => {
  it("тишина и никто не говорит дольше порога — уходим", () => {
    const timer = new QuietEndTimer(15 * MINUTE);
    const verdicts = [0, 5, 10, 14, 15].map((minute) =>
      timer.observe({ silent: true, lastSpokeAt: null }, minute * MINUTE),
    );

    expect(verdicts).toEqual([false, false, false, false, true]);
  });

  it("звук посреди отсчёта сбрасывает его", () => {
    const timer = new QuietEndTimer(15 * MINUTE);
    timer.observe({ silent: true, lastSpokeAt: null }, 0);
    timer.observe({ silent: false, lastSpokeAt: null }, 10 * MINUTE);

    expect(timer.observe({ silent: true, lastSpokeAt: null }, 16 * MINUTE)).toBe(false);
    expect(timer.observe({ silent: true, lastSpokeAt: null }, 31 * MINUTE)).toBe(true);
  });

  it("неудачный замер сбрасывает отсчёт", () => {
    const timer = new QuietEndTimer(15 * MINUTE);
    timer.observe({ silent: true, lastSpokeAt: null }, 0);
    timer.observe({ silent: null, lastSpokeAt: null }, 10 * MINUTE);

    expect(timer.observe({ silent: true, lastSpokeAt: null }, 16 * MINUTE)).toBe(false);
  });

  it("говорящий при тишине в записи — сломан захват, бот остаётся", () => {
    const timer = new QuietEndTimer(15 * MINUTE);
    timer.observe({ silent: true, lastSpokeAt: 0 }, 0);

    expect(timer.observe({ silent: true, lastSpokeAt: 14 * MINUTE }, 20 * MINUTE)).toBe(false);
    expect(timer.observe({ silent: true, lastSpokeAt: 14 * MINUTE }, 29 * MINUTE)).toBe(true);
  });
});
