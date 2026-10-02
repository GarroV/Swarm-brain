// Запуск: deno test supabase/functions/swarm-bot/lib/embedding-backfill.test.ts
//
// Дозаполнение эмбеддингов (#373): запись без индекса должна получить его на следующем проходе,
// отказ модели на одной записи не должен останавливать остальные и не должен пропадать молча.
import { assertEquals } from "@std/assert";
import { type BackfillEntry, backfillMissingEmbeddings, type BackfillStore, backfillText } from "./embedding-backfill.ts";

function fakeStore(rows: BackfillEntry[]) {
  const saved = new Map<string, number[]>();
  let askedLimit = 0;
  const store: BackfillStore = {
    missing: (limit) => {
      askedLimit = limit;
      return Promise.resolve(rows.slice(0, limit));
    },
    save: (id, emb) => {
      saved.set(id, emb);
      return Promise.resolve();
    },
  };
  return { store, saved, limit: () => askedLimit };
}

const row = (id: string, over: Partial<BackfillEntry> = {}): BackfillEntry => ({
  id,
  content: `содержимое ${id}`,
  summary: null,
  countries: null,
  ...over,
});

Deno.test("запись без эмбеддинга получает его", async () => {
  const { store, saved } = fakeStore([row("a"), row("b")]);
  const r = await backfillMissingEmbeddings(store, () => Promise.resolve([0.1, 0.2]));
  assertEquals(r, { filled: 2, failed: 0 });
  assertEquals([...saved.keys()], ["a", "b"]);
});

Deno.test("отказ модели на одной записи не останавливает остальные и считается", async () => {
  const { store, saved } = fakeStore([row("a"), row("bad"), row("c")]);
  const r = await backfillMissingEmbeddings(store, (t) => t.includes("bad") ? Promise.reject(new Error("429")) : Promise.resolve([1]));
  assertEquals(r, { filled: 2, failed: 1 });
  assertEquals([...saved.keys()], ["a", "c"]);
});

Deno.test("порция ограничена", async () => {
  const f = fakeStore(Array.from({ length: 50 }, (_, i) => row(String(i))));
  await backfillMissingEmbeddings(f.store, () => Promise.resolve([1]), 20);
  assertEquals(f.limit(), 20);
  assertEquals(f.saved.size, 20);
});

Deno.test("пустую запись не индексируем", async () => {
  const { store, saved } = fakeStore([row("e", { content: "  ", summary: null })]);
  const r = await backfillMissingEmbeddings(store, () => Promise.resolve([1]));
  assertEquals(r, { filled: 0, failed: 0 });
  assertEquals(saved.size, 0);
});

Deno.test("текст: саммари важнее содержимого, страны — только конкретные", () => {
  assertEquals(backfillText(row("x", { summary: "кратко", countries: ["RS", "General"] })), "кратко\nСтраны: RS");
  assertEquals(backfillText(row("y")), "содержимое y");
});
