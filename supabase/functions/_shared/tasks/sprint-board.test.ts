// Тесты написаны до реализации: полоска «в каких спринтах задача» на мастер-плане — ядро доски.
// Ошибка здесь молчит: закрашенный не тот спринт выглядит как правдоподобный план работы.
import { assertEquals } from "@std/assert";
import { buildPlanSpans, countMoves, type SpanRow } from "./sprint-board.ts";

const row = (over: Partial<SpanRow> & { task_id: string; cycle_id: string }): SpanRow => ({
  start_date: "2026-10-01",
  moved_at: null,
  withdrawn_at: null,
  ...over,
});

Deno.test("спринты задачи идут по дате начала, а не по порядку строк", () => {
  const spans = buildPlanSpans([
    row({ task_id: "t1", cycle_id: "c3", start_date: "2026-11-17" }),
    row({ task_id: "t1", cycle_id: "c1", start_date: "2026-10-20" }),
    row({ task_id: "t1", cycle_id: "c2", start_date: "2026-11-03" }),
  ]);
  assertEquals(spans.get("t1"), ["c1", "c2", "c3"]);
});

Deno.test("снимок переноса спринтом задачи не считается: она оттуда ушла", () => {
  const spans = buildPlanSpans([
    row({ task_id: "t1", cycle_id: "c1", start_date: "2026-10-20", moved_at: "2026-10-25T10:00:00Z" }),
    row({ task_id: "t1", cycle_id: "c2", start_date: "2026-11-03" }),
  ]);
  assertEquals(spans.get("t1"), ["c2"]);
});

Deno.test("снятая из идущего спринта строка не закрашивает полоску", () => {
  const spans = buildPlanSpans([
    row({ task_id: "t1", cycle_id: "c1", withdrawn_at: "2026-10-25T10:00:00Z" }),
  ]);
  assertEquals(spans.has("t1"), false);
});

Deno.test("у задачи только снимок — в карте её нет, а не пустой список", () => {
  const spans = buildPlanSpans([
    row({ task_id: "t1", cycle_id: "c1", moved_at: "2026-10-25T10:00:00Z" }),
  ]);
  assertEquals(spans.has("t1"), false);
});

Deno.test("задачи не смешиваются, одна строка спринта дважды не попадает", () => {
  const spans = buildPlanSpans([
    row({ task_id: "t1", cycle_id: "c1" }),
    row({ task_id: "t2", cycle_id: "c1" }),
    row({ task_id: "t1", cycle_id: "c1" }),
  ]);
  assertEquals(spans.get("t1"), ["c1"]);
  assertEquals(spans.get("t2"), ["c1"]);
});

Deno.test("при равных датах порядок стабилен — по id спринта", () => {
  const spans = buildPlanSpans([
    row({ task_id: "t1", cycle_id: "cb", start_date: "2026-10-20" }),
    row({ task_id: "t1", cycle_id: "ca", start_date: "2026-10-20" }),
  ]);
  assertEquals(spans.get("t1"), ["ca", "cb"]);
});

Deno.test("переносы задачи считаются по снимкам, а не по живым строкам", () => {
  const moves = countMoves([
    row({ task_id: "t1", cycle_id: "c1", moved_at: "2026-10-25T10:00:00Z" }),
    row({ task_id: "t1", cycle_id: "c2", moved_at: "2026-11-05T10:00:00Z" }),
    row({ task_id: "t1", cycle_id: "c3" }),
    row({ task_id: "t2", cycle_id: "c1" }),
  ]);
  assertEquals(moves.get("t1"), 2);
  assertEquals(moves.has("t2"), false, "у задачи без переносов записи нет");
});
