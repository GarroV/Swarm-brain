import { describe, expect, it } from "vitest";

import { SilenceWatch } from "./audio-watch.ts";

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
