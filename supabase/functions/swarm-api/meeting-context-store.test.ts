import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type ContextEntry, entryStartsAt, loadContextCandidates } from "./meeting-context-store.ts";

const row: ContextEntry = {
  id: "synthetic",
  metadata: {},
  countries: [],
  summary: "- Synthetic",
  entry_date: "2026-11-14",
  created_at: "2026-11-14T11:00:00Z",
};
Deno.test("actual store keeps date-only metadata unknown instead of inventing a same-day midnight", () => {
  const entry = { ...row, metadata: { calendar_event: { scheduled_start_time: "2026-11-14" } } };
  assertEquals(entryStartsAt(entry, new Map()), null);
});
Deno.test("actual store accepts explicit instants/offsets but not an unspecified local time", () => {
  const result = (value: string) =>
    entryStartsAt({ ...row, metadata: { calendar_event: { scheduled_start_time: value } } }, new Map());
  assertEquals(result("2026-11-14T10:00:00Z"), "2026-11-14T10:00:00.000Z");
  assertEquals(result("2026-11-14T12:00:00+02:00"), "2026-11-14T10:00:00.000Z");
  assertEquals(result("2026-11-14T10:00:00"), null);
});
Deno.test("actual store batches linked start lookups below PostgREST max_rows and URI limits", async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  const entries = ids.map((id, i) => ({
    ...row,
    id: `entry-${i}`,
    metadata: { meeting_id: id, attendees: [{ email: "fictional@example.invalid" }] },
  }));
  const sizes: number[] = [];
  function query(table: string) {
    let from = 0, to = 0, selected: string[] = [];
    const q = {
      select: () => q,
      contains: () => q,
      is: () => q,
      eq: () => q,
      or: () => q,
      order: () => q,
      range: (a: number, b: number) => {
        from = a;
        to = b;
        return q;
      },
      in: (_column: string, values: string[]) => {
        selected = values;
        sizes.push(values.length);
        return q;
      },
      then: (resolve: (value: unknown) => void) =>
        Promise.resolve({
          error: null,
          data: table === "entries"
            ? entries.slice(from, to + 1)
            : selected.slice(0, 1000).map((id) => ({ id, started_at: "2026-11-14T09:00:00Z" })),
        }).then(resolve),
    };
    return q;
  }
  const sb = { from: query } as unknown as SupabaseClient;
  const result = await loadContextCandidates(
    sb,
    { telegramId: 1001, groupId: "fictional", email: null },
    "2026-11-14T10:00:00Z",
  );
  assertEquals(result.candidates.length, 1001);
  assertEquals(result.truncated, false);
  assert(
    result.candidates.every((candidate) => candidate.startsAt === "2026-11-14T09:00:00.000Z"),
    "every visible linked entry retains its actual start",
  );
  assert(sizes.every((size) => size <= 100), "bounded linked-ID batch must stay below API row/URI limits");
});
