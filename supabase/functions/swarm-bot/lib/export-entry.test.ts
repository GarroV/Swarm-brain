// Выгрузка записи файлом (ИИ-инструмент бота export_entry): запись ищется только в своём
// воркспейсе и только среди видимых зрителю; текст собирается из частей ЭТОЙ записи
// (metadata.chunk_group_id), а не из всего воркспейса.
import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadEntryForExport } from "./export-entry.ts";

type Call = { method: string; args: unknown[] };

/** Мок цепочки supabase-js: первая выборка — maybeSingle(), вторая — await списка. */
function makeSupabase(single: unknown, list: unknown[]) {
  const calls: Call[][] = [];
  const client = {
    from: (...args: unknown[]) => {
      const chain: Call[] = [{ method: "from", args }];
      calls.push(chain);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or", "order", "limit"]) {
        b[m] = (...a: unknown[]) => {
          chain.push({ method: m, args: a });
          return b;
        };
      }
      b.maybeSingle = () => Promise.resolve({ data: single });
      b.then = (res: (v: unknown) => unknown) => res({ data: list });
      return b;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const has = (chain: Call[], method: string, ...args: unknown[]) =>
  chain.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

const VIEWER = 111;
const vis = `is_private.eq.false,and(is_private.eq.true,owner_id.eq.${VIEWER})`;

Deno.test("поиск записи: свой воркспейс и фильтр личных", async () => {
  const { client, calls } = makeSupabase(null, []);
  const r = await loadEntryForExport(client, "e1", { groupId: "cee", userId: VIEWER });
  assertEquals(r, null);
  assertEquals(has(calls[0], "eq", "id", "e1"), true);
  assertEquals(has(calls[0], "eq", "group_id", "cee"), true);
  assertEquals(has(calls[0], "or", vis), true, "нет фильтра личных");
});

Deno.test("без частей — только собственный текст записи, воркспейс не выбирается", async () => {
  const entry = {
    content: "own text",
    summary: null,
    metadata: {},
    source: "telegram",
    created_at: "2026-09-01T00:00:00Z",
  };
  const { client, calls } = makeSupabase(entry, [{ content: "ЧУЖОЕ", metadata: {} }]);
  const r = await loadEntryForExport(client, "e1", { groupId: "cee", userId: VIEWER });
  assertEquals(r?.fullContent, "own text");
  assertEquals(calls.length, 1, "лишняя выборка по воркспейсу");
});

Deno.test("части собираются только по chunk_group_id этой записи, с фильтрами и лимитом", async () => {
  const entry = {
    content: "part 1",
    summary: null,
    metadata: { chunk_group_id: "g-1", chunk: 1, total_chunks: 2 },
    source: "mcp",
    created_at: "2026-09-01T00:00:00Z",
  };
  const parts = [
    { content: "part 2", metadata: { chunk: 2 } },
    { content: "part 1", metadata: { chunk: 1 } },
  ];
  const { client, calls } = makeSupabase(entry, parts);
  const r = await loadEntryForExport(client, "e1", { groupId: "cee", userId: VIEWER });
  assertEquals(r?.fullContent, "part 1\npart 2");
  const q = calls[1];
  assertEquals(has(q, "eq", "metadata->>chunk_group_id", "g-1"), true, "части не по своей группе");
  assertEquals(has(q, "eq", "group_id", "cee"), true);
  assertEquals(has(q, "or", vis), true);
  assertEquals(q.some((c) => c.method === "limit"), true, "выборка частей без лимита");
});

Deno.test("длинные тезисы предпочитаются короткому тексту", async () => {
  const entry = {
    content: "x",
    summary: "long summary",
    metadata: {},
    source: "s",
    created_at: "2026-09-01T00:00:00Z",
  };
  const { client } = makeSupabase(entry, []);
  const r = await loadEntryForExport(client, "e1", { groupId: "cee", userId: VIEWER });
  assertEquals(r?.fullContent, "long summary");
});
