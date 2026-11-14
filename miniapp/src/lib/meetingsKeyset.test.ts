import { assertEquals } from "@std/assert";
import { nextCursor, pageQuery, type PagingCursor } from "./meetingsPaging.ts";

const rows = Array.from({ length: 120 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${(999 - i).toString(16).padStart(12, "0")}`,
  created_at: "2026-11-12T12:00:00.123456+00:00",
}));
const start: PagingCursor = { phase: "older", offset: 0 };
const filters = { q: "", storage: "any" as const };

function afterFirstPage() {
  return nextCursor(
    start,
    Object.assign({ rows: 50, total: 120 }, { lastRow: rows[49] }),
  )!;
}
function simulatedPage(data: typeof rows, cursor: PagingCursor) {
  const query = pageQuery(cursor, filters, null);
  const token = (query as unknown as { cursor?: string }).cursor;
  if (!token) {
    return data.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit!);
  }
  const edge = JSON.parse(token) as typeof rows[number];
  return data.filter((r) =>
    r.created_at < edge.created_at ||
    (r.created_at === edge.created_at && r.id < edge.id)
  ).slice(0, query.limit);
}

Deno.test("meetings keyset: deletion before the next page cannot skip an unseen meeting", () => {
  assertEquals(
    simulatedPage(rows.slice(1), afterFirstPage())[0].id,
    rows[50].id,
  );
});
Deno.test("meetings keyset: an insertion before the cursor cannot repeat the previous page tail", () => {
  const inserted = { ...rows[0], id: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
  assertEquals(
    simulatedPage([inserted, ...rows], afterFirstPage())[0].id,
    rows[50].id,
  );
});
Deno.test("meetings keyset: cursor keeps PostgreSQL microseconds and the id tie breaker", () => {
  const query = pageQuery(afterFirstPage(), filters, null);
  const raw = (query as unknown as { cursor?: string }).cursor;
  assertEquals(raw ? JSON.parse(raw) : null, rows[49]);
  assertEquals(query.offset ?? 0, 0);
});
