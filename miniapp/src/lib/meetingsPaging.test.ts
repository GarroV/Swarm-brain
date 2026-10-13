import { assertEquals } from "jsr:@std/assert@1";
import {
  firstCursor, mergeById, MEETINGS_PAGE_SIZE, MEETINGS_RECENT_LIMIT, nextCursor, pageQuery, recentDays,
  type PagingCursor,
} from "./meetingsPaging.ts";

const NOW = new Date("2026-10-13T10:00:00Z");
const NO_FILTERS = { q: "", storage: "any" as const };

Deno.test("recentDays: вчера и позавчера по UTC, через границу месяца тоже", () => {
  assertEquals(recentDays(NOW), { yesterday: "2026-10-12", dayBefore: "2026-10-11" });
  assertEquals(recentDays(new Date("2026-11-01T00:30:00Z")), { yesterday: "2026-10-31", dayBefore: "2026-10-30" });
});

Deno.test("без своего периода первая фаза — вчера и сегодня, потом «старше» постранично", () => {
  const c = firstCursor(null);
  assertEquals(c, { phase: "recent", offset: 0 });
  assertEquals(pageQuery(c, NO_FILTERS, null, NOW), {
    confirmed: true, offset: 0, limit: MEETINGS_RECENT_LIMIT, from: "2026-10-12",
  });
  assertEquals(pageQuery({ phase: "older", offset: 50 }, NO_FILTERS, null, NOW), {
    confirmed: true, offset: 50, limit: MEETINGS_PAGE_SIZE, to: "2026-10-11",
  });
});

Deno.test("свой период человека — одна фаза со своими границами", () => {
  const b = { from: "2026-09-13", to: "2026-10-13" };
  const c = firstCursor(b);
  assertEquals(c.phase, "main");
  assertEquals(pageQuery(c, { q: "польша", storage: "personal" }, b, NOW), {
    confirmed: true, offset: 0, limit: MEETINGS_PAGE_SIZE, from: "2026-09-13", to: "2026-10-13", q: "польша", storage: "personal",
  });
});

// Эмуляция сервера: множество встреч с днём встречи, фильтр по from/to, порядок и range как в роуте.
type Row = { id: string; day: string };
function fakeServer(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => (a.day === b.day ? b.id.localeCompare(a.id) : b.day.localeCompare(a.day)));
  return (q: { from?: string; to?: string; offset?: number; limit?: number }) => {
    const hit = sorted.filter((r) => (!q.from || r.day >= q.from) && (!q.to || r.day <= q.to));
    const off = q.offset ?? 0;
    return { rows: hit.slice(off, off + (q.limit ?? 50)), total: hit.length };
  };
}

function loadAll(rows: Row[], bounds: { from: string; to: string } | null): Row[] {
  const server = fakeServer(rows);
  let got: Row[] = [];
  let cursor: PagingCursor | null = firstCursor(bounds);
  let guard = 0;
  while (cursor && guard++ < 100) {
    const page = server(pageQuery(cursor, NO_FILTERS, bounds, NOW));
    got = mergeById(got, page.rows);
    cursor = nextCursor(cursor, { rows: page.rows.length, total: page.total });
  }
  return got;
}

Deno.test("пагинация: фазы recent→older загружают каждую встречу ровно один раз", () => {
  const rows: Row[] = Array.from({ length: 173 }, (_, i) => ({
    id: `m${String(i).padStart(3, "0")}`,
    // 7 встреч вчера/сегодня, остальные раньше; много встреч в один день — проверка tie-breaker
    day: i < 7 ? (i < 3 ? "2026-10-13" : "2026-10-12") : `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`,
  }));
  const got = loadAll(rows, null);
  assertEquals(got.length, rows.length);
  assertEquals(new Set(got.map((r) => r.id)).size, rows.length);
  // первыми приехали вчерашние и сегодняшние
  assertEquals(got.slice(0, 7).every((r) => r.day >= "2026-10-12"), true);
});

Deno.test("пагинация внутри своего периода: без потерь и дублей", () => {
  const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: `x${i}`, day: "2026-10-01" }));
  const got = loadAll(rows, { from: "2026-09-01", to: "2026-10-31" });
  assertEquals(got.length, 120);
  assertEquals(new Set(got.map((r) => r.id)).size, 120);
});

Deno.test("пустая фаза recent не обрывает загрузку: дальше идёт older", () => {
  assertEquals(nextCursor({ phase: "recent", offset: 0 }, { rows: 0, total: 0 }), { phase: "older", offset: 0 });
  assertEquals(nextCursor({ phase: "older", offset: 0 }, { rows: 0, total: 0 }), null);
});

Deno.test("без X-Total-Count: неполная страница — последняя, полная — продолжение", () => {
  assertEquals(nextCursor({ phase: "older", offset: 0 }, { rows: 50, total: null }), { phase: "older", offset: 50 });
  assertEquals(nextCursor({ phase: "older", offset: 50 }, { rows: 20, total: null }), null);
});

Deno.test("mergeById не дублирует строки при сдвиге offset", () => {
  assertEquals(mergeById([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]).map((r) => r.id), ["a", "b", "c"]);
});
