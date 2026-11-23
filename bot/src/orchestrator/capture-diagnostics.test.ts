import { expect, it } from "vitest";
import { CaptureDiagnostics } from "./capture-diagnostics.ts";

it("сохраняет эпизоды, сбой замера и восстановление без повторов каждого тика", () => {
  const lines: string[] = [];
  const journal = new CaptureDiagnostics("m-1", 180_000, (line) => {
    lines.push(line);
  });
  const sample = {
    atMs: 200_000,
    silent: true,
    alone: false,
    speakerIndicatorAtMs: 199_000,
    probe: {
      measuredAtMs: 200_000,
      seconds: 5,
      maxDb: -80,
      meanDb: -90,
      samples: 240_000,
      thresholdDb: -60,
      status: "measured" as const,
    },
  };
  journal.observe(false, sample);
  journal.observe(false, { ...sample, atMs: 210_000 });
  journal.observe(false, { ...sample, silent: null, probe: null, atMs: 220_000 });
  journal.observe(false, { ...sample, silent: null, probe: null, atMs: 230_000 });
  journal.observe(true, { ...sample, silent: false, atMs: 240_000 });
  journal.observe(false, { ...sample, atMs: 500_000 });
  const events: Record<string, unknown>[] = lines.map(
    (line) => JSON.parse(line.slice("capture-diagnostic ".length)) as Record<string, unknown>,
  );
  expect(events.map((event) => event.event)).toEqual([
    "silence_detected",
    "probe_unavailable",
    "probe_resumed",
    "sound_returned",
    "silence_detected",
  ]);
  expect(events[0]).toMatchObject({
    meetingId: "m-1",
    episode: 1,
    thresholdMs: 180_000,
    speakerIndicatorAtMs: 199_000,
    probe: { maxDb: -80, meanDb: -90, samples: 240_000 },
  });
  expect(events[2]).toMatchObject({ missedProbes: 2 });
  expect(events[3]).toMatchObject({ sinceDetectionMs: 40_000 });
  expect(events[4]).toMatchObject({ episode: 2 });
});
