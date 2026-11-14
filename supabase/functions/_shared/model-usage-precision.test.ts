import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { costUsd, preciseCostUsd, recordModelUsage } from "./model-usage.ts";
import { recordedUsageCost, recordedUsageUnits, usageUnitsUsd } from "./model-usage-cost.ts";
import { summarizeUsage, type UsageRow } from "./model-usage-summary.ts";
import { usageView } from "../../../miniapp/src/lib/usageCube.ts";

type RecordedCost = {
  cost_usd: number | null;
  cost_usd_precise?: number | null;
};

async function recorded(tokens: number, model = "text-embedding-3-small"): Promise<RecordedCost> {
  let actual: Record<string, unknown> | undefined;
  await recordModelUsage(
    "https://api.openai.com/v1/embeddings",
    { body: JSON.stringify({ model }) },
    new Response(JSON.stringify({ model, usage: { prompt_tokens: tokens } })),
    { purpose: "precision:fixture" },
    (row) => {
      actual = row;
      return Promise.resolve({ error: null });
    },
  );
  assertEquals(actual?.prompt_tokens, tokens);
  return actual as RecordedCost;
}

Deno.test("the actual usage producer retains a six-token embedding cost before any aggregation", async () => {
  const row = await recorded(6);
  assertEquals(row.cost_usd_precise ?? row.cost_usd, 0.00000012);
  assertEquals(row.cost_usd, 0, "the legacy six-decimal field stays compatible");
});

Deno.test("ten actual short embedding calls sum their costs instead of ten rounded zeroes", async () => {
  const rows = await Promise.all(Array.from({ length: 10 }, () => recorded(6)));
  const sum = rows.reduce((total, row) => total + (row.cost_usd_precise ?? row.cost_usd ?? 0), 0);
  assertAlmostEquals(sum, 0.0000012, 1e-18);
});

Deno.test("usage producer preserves existing priced, zero and unknown controls", async () => {
  assertEquals((await recorded(500_000)).cost_usd, 0.01);
  const zero = await recorded(0);
  assertEquals(zero.cost_usd_precise ?? zero.cost_usd, 0);
  const unknown = await recorded(6, "synthetic-unpriced-model");
  assertEquals(unknown.cost_usd_precise ?? unknown.cost_usd, null);
});

Deno.test("precise pricing retains dated/cached rates and never double-rounds the legacy amount", () => {
  assertEquals(preciseCostUsd({ model: "text-embedding-3-small", kind: "embedding", promptTokens: 1 }), 0.00000002);
  assertEquals(
    preciseCostUsd({ model: "gpt-4o-mini-2024-07-18", kind: "chat", promptTokens: 6, cachedTokens: 6 }),
    0.00000045,
  );
  const nearHalf = { model: "whisper-1", kind: "transcription" as const, audioSeconds: 0.00499999999999 };
  assertEquals(preciseCostUsd(nearHalf), 0.0000005);
  assertEquals(costUsd(nearHalf), 0, "legacy rounding must use the original unrounded formula");
  assertEquals(preciseCostUsd({ model: "synthetic-unpriced", kind: "chat", promptTokens: 1 }), null);
  assertEquals(preciseCostUsd({ model: "whisper-1", kind: "transcription" }), null);
});

Deno.test("recorded cost prefers precise zero/string amounts while old and unknown rows retain their meaning", () => {
  assertEquals(recordedUsageCost({ cost_usd: 99, cost_usd_precise: 0 }), 0);
  assertEquals(recordedUsageCost({ cost_usd: 0, cost_usd_precise: "0.000000120000" }), 0.00000012);
  assertEquals(recordedUsageCost({ cost_usd: 1.234567, cost_usd_precise: null }), 1.234567);
  assertEquals(recordedUsageCost({ cost_usd: 1.234567 }), 1.234567);
  assertEquals(recordedUsageCost({ cost_usd: null, cost_usd_precise: null }), null);
});

Deno.test("recorded integer units retain decimal/scientific/sign precision and bound malformed exponents", () => {
  const units = (value: number | string) => recordedUsageUnits({ cost_usd: null, cost_usd_precise: value });
  assertEquals(units("99999999.999999999999"), 99_999_999_999_999_999_999n);
  assertEquals(units("-99999999.999999999999"), -99_999_999_999_999_999_999n);
  assertEquals(units("+1.2e-7"), 120_000n);
  assertEquals(units(-0.00000012), -120_000n);
  assertEquals(units("1e+7"), 10_000_000_000_000_000_000n);
  assertEquals(units("1e-1000000"), 0n);
  assertEquals(units("0e1000000"), 0n);
  assertEquals(usageUnitsUsd(units("0.1")! + units("0.2")!), 0.3);
  assertEquals(usageUnitsUsd(-120_000n), -0.00000012);
  for (const bad of [100_000_000, -100_000_000, "1e1000000", "1e999999999999999999999", "9".repeat(65)]) {
    assertThrows(() => units(bad), RangeError);
  }
  for (const bad of [NaN, Infinity, -Infinity, "not-a-cost"]) assertThrows(() => units(bad));
});

const summaryRow = (cost: RecordedCost, meeting: string | null = null): UsageRow => ({
  ...cost,
  created_at: "2026-11-14T10:00:00Z",
  kind: "embedding",
  model: "text-embedding-3-small",
  purpose: "precision:fixture",
  meeting_id: meeting,
  prompt_tokens: 6,
  completion_tokens: null,
  audio_seconds: null,
});

Deno.test("actual producer rows retain precision in every server slice and reach the unchanged UI before its final sum", async () => {
  const rows = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => summaryRow(await recorded(6), `fixture-${i}`)),
  );
  const s = summarizeUsage(rows);
  assertEquals([s.total_usd, s.by_purpose[0].usd, s.by_model[0].usd, s.by_day[0].usd], Array(4).fill(0.0000012));
  assertEquals(s.cells.length, 10);
  assertEquals(s.cells.map((c) => c.usd), Array(10).fill(0.00000012));
  assertEquals(s.top_meetings.map((m) => m.usd), Array(10).fill(0.00000012));
  assertEquals(s.recent.map((r) => r.usd), Array(10).fill(0.00000012));
  const view = usageView(s.cells, "2026-11-14", "2026-11-14", "day", { purpose: null, model: null });
  assertEquals(view.total_usd, 0.000001, "existing UI presentation still rounds only after summing the precise cells");
  assertEquals(view.calls, 10);
});

Deno.test("mixed legacy, precise-zero and unpriced history is neither repriced nor double-counted", () => {
  const old = summaryRow({ cost_usd: 1.234567 });
  const rows = [
    old,
    summaryRow({ cost_usd: 0, cost_usd_precise: 0.00000012 }),
    summaryRow({ cost_usd: 99, cost_usd_precise: 0 }),
    summaryRow({ cost_usd: null, cost_usd_precise: null }),
    summaryRow({ cost_usd: null }),
  ];
  const s = summarizeUsage(rows);
  assertEquals(s.total_usd, 1.23456712);
  assertEquals([s.calls, s.unpriced_calls, s.cells[0].unpriced], [5, 2, 2]);
  assertEquals(s.recent.map((r) => r.usd), [1.234567, 0.00000012, 0, null, null]);
  assertEquals(old.cost_usd, 1.234567);
  assertEquals(old.cost_usd_precise, undefined);
});

Deno.test("historical six-decimal costs remain unchanged at the existing fifty-thousand-row API bound", () => {
  const rows = Array.from({ length: 50_000 }, () => summaryRow({ cost_usd: 1.234567 }));
  const summary = summarizeUsage(rows);
  assertEquals(summary.total_usd, 61728.35);
  assertEquals(summary.by_purpose[0].usd, 61728.35);
  assertEquals(summary.cells[0].usd, 61728.35);
});

Deno.test("precise slice, meeting and cell ordering precedes lossy public numeric conversion", () => {
  const lower = {
    ...summaryRow({ cost_usd: 99999999.999999 }, "lower"),
    purpose: "lower",
    model: "lower",
    cost_usd_precise: "99999999.999999000001",
  };
  const higher = {
    ...summaryRow({ cost_usd: 99999999.999999 }, "higher"),
    purpose: "higher",
    model: "higher",
    cost_usd_precise: "99999999.999999000002",
  };
  const s = summarizeUsage([lower, higher]);
  assertEquals(s.by_purpose.map((row) => row.key), ["higher", "lower"]);
  assertEquals(s.by_model.map((row) => row.key), ["higher", "lower"]);
  assertEquals(s.top_meetings.map((row) => row.meeting_id), ["higher", "lower"]);
  assertEquals(s.cells.map((row) => row.meeting_id), ["higher", "lower"]);
});

Deno.test("exact-cost ties retain the existing calls fallback for slices and stable order for meetings/cells", () => {
  const first = {
    ...summaryRow({ cost_usd: 0, cost_usd_precise: 0.00000012 }, "first"),
    purpose: "first",
    model: "first",
  };
  const second = {
    ...summaryRow({ cost_usd: 0, cost_usd_precise: 0.00000006 }, "second"),
    purpose: "second",
    model: "second",
  };
  const s = summarizeUsage([first, second, second]);
  assertEquals(s.by_purpose.map((row) => row.key), ["second", "first"]);
  assertEquals(s.by_model.map((row) => row.key), ["second", "first"]);
  assertEquals(s.top_meetings.map((row) => row.meeting_id), ["first", "second"]);
  assertEquals(s.cells.map((row) => row.meeting_id), ["first", "second"]);
});
