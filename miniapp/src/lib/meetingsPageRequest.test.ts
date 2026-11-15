import { assertEquals, assertRejects } from "@std/assert";
import type { Entry } from "@/types";
import { loadPendingMeetingPages } from "./meetingsPageRequest.ts";

Deno.test("pending meetings: more than 200 rows remain complete with keyset and legacy offset servers", async () => {
  const rows = Array.from(
    { length: 425 },
    (_, i) => ({
      id: String(1000 - i).padStart(6, "0"),
      created_at: "2026-11-13T12:00:00.123456Z",
    }),
  ) as Entry[];
  for (const keyset of [true, false]) {
    const calls: unknown[] = [];
    const result = await loadPendingMeetingPages(async (q) => {
      calls.push(q);
      const edge = q.cursor ? JSON.parse(q.cursor) : null;
      const available = edge ? rows.filter((r) => r.id < edge.id) : rows;
      return {
        rows: available.slice(q.offset ?? 0, (q.offset ?? 0) + q.limit!),
        total: null,
        unfilteredTotal: null,
        keyset,
      };
    });
    assertEquals(result, rows);
    assertEquals(calls.length, 3);
  }
});
Deno.test("pending meetings: a broken repeated full page is an error, never an infinite eager loop", async () => {
  const rows = Array.from(
    { length: 200 },
    (_, i) => ({ id: String(i), created_at: "2026-11-13T12:00:00Z" }),
  ) as Entry[];
  let calls = 0;
  await assertRejects(
    () =>
      loadPendingMeetingPages(async () => {
        calls++;
        return { rows, total: null, unfilteredTotal: null, keyset: true };
      }),
    Error,
    "no progress",
  );
  assertEquals(calls, 2);
});
