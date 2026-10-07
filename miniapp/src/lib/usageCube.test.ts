import { assertEquals } from "jsr:@std/assert";
import { OTHER, usageView, type UsageCell } from "./usageCube.ts";

const cell = (day: string, purpose: string, model: string, usd: number, meeting_id: string | null = null): UsageCell => ({
  day, purpose, model, meeting_id, usd, calls: 1, unpriced: 0, tokens: 10, audio_seconds: 60,
});

const cells = [
  cell("2026-10-01", "meeting:transcription", "whisper-1", 2, "m1"),
  cell("2026-10-01", "meeting:tezisy", "gpt", 1, "m1"),
  cell("2026-10-03", "meeting:transcription", "whisper-1", 4, "m2"),
  cell("2026-10-05", "meeting:ask", "gpt", 0.5),
  cell("2026-09-30", "meeting:tezisy", "gpt", 100), // вне периода
];
const none = { purpose: null, model: null };

Deno.test("итоги и разрезы — только за период", () => {
  const v = usageView(cells, "2026-10-01", "2026-10-07", "day", none);
  assertEquals(v.total_usd, 7.5);
  assertEquals(v.calls, 4);
  assertEquals(v.audio_minutes, 4);
  assertEquals(v.by_purpose.map((s) => [s.key, s.usd]), [["meeting:transcription", 6], ["meeting:tezisy", 1], ["meeting:ask", 0.5]]);
  assertEquals(v.by_model.map((s) => [s.key, s.usd]), [["whisper-1", 6], ["gpt", 1.5]]);
});

Deno.test("фильтр по назначению и модели сужает всё: итог, график, встречи", () => {
  const v = usageView(cells, "2026-10-01", "2026-10-07", "day", { purpose: null, model: "gpt" });
  assertEquals(v.total_usd, 1.5);
  assertEquals(v.top_meetings, [{ meeting_id: "m1", usd: 1, calls: 1 }]);
  assertEquals(v.buckets.reduce((s, b) => s + b.usd, 0), 1.5);
  const t = usageView(cells, "2026-10-01", "2026-10-07", "day", { purpose: "meeting:transcription", model: null });
  assertEquals(t.total_usd, 6);
});

Deno.test("столбец раскладывается по назначениям, сумма частей = столбец", () => {
  const v = usageView(cells, "2026-10-01", "2026-10-07", "day", none);
  assertEquals(v.series, ["meeting:transcription", "meeting:tezisy", "meeting:ask"]);
  assertEquals(v.buckets.length, 7);
  assertEquals(v.buckets[0].parts, [2, 1, 0]);
  for (const b of v.buckets) assertEquals(Math.round(b.parts.reduce((s, p) => s + p, 0) * 1e6) / 1e6, b.usd);
});

Deno.test("больше MAX_SERIES назначений — хвост сводится в «прочее», деньги не теряются", () => {
  const many = ["a", "b", "c", "d", "e"].map((p, i) => cell("2026-10-01", p, "gpt", 5 - i));
  const v = usageView(many, "2026-10-01", "2026-10-01", "day", none);
  assertEquals(v.series, ["a", "b", "c", OTHER]);
  assertEquals(v.buckets[0].parts, [5, 4, 3, 3]);
});

Deno.test("средний день считает и пустые дни; пиковый — самый дорогой день", () => {
  const v = usageView(cells, "2026-10-01", "2026-10-10", "week", none);
  assertEquals(v.avg_per_day, 0.75);
  assertEquals(v.peak_day, { day: "2026-10-03", usd: 4 });
  assertEquals(usageView([], "2026-10-01", "2026-10-02", "day", none).peak_day, null);
});
