import { assertEquals } from "@std/assert";
import { inPeriod, parsePeriod, summarizeUsage, type UsageRow } from "./model-usage-summary.ts";

const row = (o: Partial<UsageRow>): UsageRow => ({
  created_at: "2026-10-01T10:00:00Z",
  kind: "chat",
  model: "gpt-4o-mini",
  purpose: "web:chat",
  meeting_id: null,
  prompt_tokens: 100,
  completion_tokens: 10,
  audio_seconds: null,
  cost_usd: 0.001,
  ...o,
});

Deno.test("итог, разрез по назначению и модели, без цены считаются отдельно", () => {
  const s = summarizeUsage([
    row({ purpose: "meeting:tezisy", model: "gpt-5.6-terra", cost_usd: null }),
    row({
      purpose: "meeting:transcription",
      kind: "transcription",
      model: "whisper-1",
      cost_usd: 0.06,
      audio_seconds: 600,
    }),
    row({ purpose: "web:chat", cost_usd: 0.004 }),
    row({ purpose: "web:chat", cost_usd: 0.006 }),
  ]);
  assertEquals(s.total_usd, 0.07);
  assertEquals(s.calls, 4);
  assertEquals(s.unpriced_calls, 1);
  assertEquals(s.audio_minutes, 10);
  assertEquals(s.by_purpose.map((p) => [p.key, p.usd, p.calls]), [
    ["meeting:transcription", 0.06, 1],
    ["web:chat", 0.01, 2],
    ["meeting:tezisy", 0, 1],
  ]);
  assertEquals(s.by_purpose.find((p) => p.key === "meeting:tezisy")?.unpriced, 1);
  assertEquals(s.by_model.map((m) => m.key), ["whisper-1", "gpt-4o-mini", "gpt-5.6-terra"]);
});

Deno.test("по дням — по Белграду, а не по UTC", () => {
  const s = summarizeUsage([
    row({ created_at: "2026-09-30T22:30:00Z", cost_usd: 0.002 }), // 1 октября 00:30 по Белграду
    row({ created_at: "2026-09-30T21:30:00Z", cost_usd: 0.001 }), // 30 сентября 23:30
  ]);
  assertEquals(s.by_day, [
    { day: "2026-09-30", usd: 0.001, calls: 1 },
    { day: "2026-10-01", usd: 0.002, calls: 1 },
  ]);
});

Deno.test("самые дорогие встречи — сумма всех вызовов встречи, по убыванию", () => {
  const s = summarizeUsage([
    row({ meeting_id: "a", cost_usd: 0.01 }),
    row({ meeting_id: "a", cost_usd: 0.02 }),
    row({ meeting_id: "b", cost_usd: 0.05 }),
    row({ meeting_id: null, cost_usd: 1 }),
  ]);
  assertEquals(s.top_meetings, [{ meeting_id: "b", usd: 0.05, calls: 1 }, { meeting_id: "a", usd: 0.03, calls: 2 }]);
});

Deno.test("пусто — нули, а не ошибка", () => {
  const s = summarizeUsage([]);
  assertEquals([s.total_usd, s.calls, s.unpriced_calls, s.by_day.length], [0, 0, 0, 0]);
});

Deno.test("период: дни по Белграду, обе границы включительно (#822)", () => {
  const p = parsePeriod("2026-10-01", "2026-10-31");
  if (typeof p === "string") throw new Error(p);
  // 30.09 23:30 UTC — уже 1 октября в Белграде; 31.10 23:30 UTC — уже 1 ноября.
  assertEquals(inPeriod("2026-09-30T23:30:00Z", p), true);
  assertEquals(inPeriod("2026-09-30T21:30:00Z", p), false);
  assertEquals(inPeriod("2026-10-31T22:30:00Z", p), true);
  assertEquals(inPeriod("2026-10-31T23:30:00Z", p), false);
  // Окно выборки шире периода — точную границу держит inPeriod.
  assertEquals(p.since <= "2026-09-30T21:30:00Z" && p.until > "2026-10-31T23:30:00Z", true);
});

Deno.test("период: мусор, перевёрнутые границы и больше года — отказ", () => {
  assertEquals(typeof parsePeriod(null, "2026-10-01"), "string");
  assertEquals(typeof parsePeriod("2026-02-31", "2026-03-05"), "string");
  assertEquals(typeof parsePeriod("2026-10-05", "2026-10-01"), "string");
  assertEquals(typeof parsePeriod("2025-01-01", "2026-01-02"), "string");
  assertEquals(typeof parsePeriod("2025-01-01", "2025-12-31"), "object");
});
