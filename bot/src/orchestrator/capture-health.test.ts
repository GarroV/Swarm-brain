import { expect, it } from "vitest";
import { CaptureHealth } from "./audio-watch.ts";

it("capture health needs sustained observed silence with people, and recovers on real sound", () => {
  const health = new CaptureHealth(3000);
  expect(health.observe({ silent: true, alone: false }, 0)).toBe(true);
  expect(health.observe({ silent: true, alone: false }, 2999)).toBe(true);
  expect(health.observe({ silent: true, alone: false }, 3000)).toBe(false);
  expect(health.observe({ silent: null, alone: false }, 4000)).toBe(false);
  expect(health.observe({ silent: false, alone: false }, 5000)).toBe(true);
  expect(health.observe({ silent: true, alone: false }, 6000)).toBe(true);
  expect(health.observe({ silent: true, alone: false }, 9000)).toBe(false);
});

it("being alone or a failed observation never proves failed capture", () => {
  const health = new CaptureHealth(3000);
  expect(health.observe({ silent: true, alone: true }, 0)).toBe(true);
  expect(health.observe({ silent: true, alone: true }, 9000)).toBe(true);
  expect(health.observe({ silent: true, alone: false }, 10_000)).toBe(true);
  expect(health.observe({ silent: null, alone: false }, 11_000)).toBe(true);
  expect(health.observe({ silent: true, alone: false }, 12_000)).toBe(true);
  expect(health.observe({ silent: true, alone: null }, 15_000)).toBe(true);
});
