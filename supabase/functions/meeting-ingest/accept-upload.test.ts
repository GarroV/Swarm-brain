// Приём выгрузки условен по тому, что ingest видел при проверках (issue #578). Поддельный клиент
// исполняет ровно те фильтры, что шлёт модуль, на одной строке встречи.
import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptUpload, type UploadExpectation } from "./accept-upload.ts";

type Row = Record<string, unknown>;

function fake(row: Row) {
  const value = (col: string) =>
    col === "process_state->>gen" ? (row.process_state as { gen?: string } | null)?.gen ?? null : row[col];
  const client = {
    from: () => ({
      update: (patch: Row) => {
        const filters: Array<() => boolean> = [];
        const chain = {
          eq: (col: string, v: unknown) => (filters.push(() => value(col) === v), chain),
          is: (col: string, _v: null) => (filters.push(() => value(col) == null), chain),
          neq: (col: string, v: unknown) => (filters.push(() => value(col) !== v), chain),
          select: () => {
            if (!filters.every((f) => f())) return Promise.resolve({ data: [], error: null });
            Object.assign(row, patch);
            return Promise.resolve({ data: [{ id: row.id }], error: null });
          },
        };
        return chain;
      },
    }),
  };
  return client as unknown as SupabaseClient;
}

const freshRow = (): Row => ({
  id: "m1",
  claim_owner: 42,
  summary_status: null,
  process_state: null,
  notes_edited_at: null,
  status: "draft",
});
const seen: UploadExpectation = { claimOwner: 42, summaryStatus: null, gen: null };
const patchOf = (gen: string) => ({ summary_status: "processing", process_state: { gen, parts: [] } });

Deno.test("ЯДРО: параллельный ретрай той же выгрузки — принимается одна, второе поколение не затирает первое", async () => {
  const row = freshRow();
  const client = fake(row);
  // Оба запроса проверили строку ДО заливки аудио и видели одно и то же.
  const first = await acceptUpload(client, "m1", seen, patchOf("gen-a"));
  const second = await acceptUpload(client, "m1", seen, patchOf("gen-b"));
  assertEquals([first, second], [true, false]);
  assertEquals((row.process_state as { gen: string }).gen, "gen-a", "ретрай затёр поколение первой выгрузки");
});

Deno.test("ЯДРО: встречу перехватил другой рекордер за время заливки — выгрузка не затирает его", async () => {
  const row = freshRow();
  row.claim_owner = 777;
  assertEquals(await acceptUpload(fake(row), "m1", seen, patchOf("gen-a")), false);
  assertEquals(row.process_state, null);
});

Deno.test("ЯДРО: за время заливки встречу обработала другая запись — статус тот же, поколение другое: не принята", async () => {
  // Вторая запись к готовой встрече (done, поколение gen-old). Пока аудио заливалось, другая запись
  // успела пройти обработку и снова закончить встречу: статус опять done, но поколение уже gen-other.
  const row = { ...freshRow(), summary_status: "done", process_state: { gen: "gen-other" } };
  const expectDone: UploadExpectation = { claimOwner: 42, summaryStatus: "done", gen: "gen-old" };
  assertEquals(await acceptUpload(fake(row), "m1", expectDone, patchOf("gen-a")), false);
  assertEquals((row.process_state as { gen: string }).gen, "gen-other");
});

Deno.test("встречу начали править за время заливки — выгрузка не принята", async () => {
  const row = { ...freshRow(), notes_edited_at: "2026-10-01T10:00:00Z" };
  assertEquals(await acceptUpload(fake(row), "m1", seen, patchOf("gen-a")), false);
});

Deno.test("строка такая же, как при проверке (повтор после сбоя того же поколения) — выгрузка принята", async () => {
  const row = { ...freshRow(), summary_status: "failed", process_state: { gen: "gen-old" } };
  const ok = await acceptUpload(
    fake(row),
    "m1",
    { claimOwner: 42, summaryStatus: "failed", gen: "gen-old" },
    patchOf("gen-a"),
  );
  assertEquals(ok, true);
  assertEquals(row.summary_status, "processing");
});
