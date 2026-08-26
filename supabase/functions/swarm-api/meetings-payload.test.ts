import { assert, assertEquals } from "jsr:@std/assert@1";
import { LIST_PREVIEW_CHARS, MEETING_COLUMNS, toListRow } from "./meetings-payload.ts";

const cols = () => MEETING_COLUMNS.split(",").map((c) => c.trim());

Deno.test("не запрашиваем колонки, которых нет в типе Entry — фронт их прочитать не может", () => {
  for (const dead of ["embedding", "fts", "last_review_reminded_at", "*"]) {
    assertEquals(cols().includes(dead), false, `${dead} не должна уезжать в браузер`);
  }
});

Deno.test("запрашиваем всё, что фронт реально читает", () => {
  const need = [
    "id", "content", "summary", "added_by", "source", "metadata", "countries",
    "entry_type", "entry_date", "group_id", "is_private", "owner_id", "created_at", "updated_at",
  ];
  for (const f of need) assert(cols().includes(f), `${f} нужна фронту, но не запрашивается`);
});

Deno.test("toListRow режет content и summary и честно помечает truncated", () => {
  const row = { id: "a", content: "x".repeat(50_000), summary: "y".repeat(9_000), metadata: {} };
  const out = toListRow(row);
  assertEquals(out.content.length, LIST_PREVIEW_CHARS);
  assertEquals(out.summary!.length, LIST_PREVIEW_CHARS);
  assertEquals(out.truncated, true);
});

Deno.test("первая строка content выживает — из неё строится заголовок встреч без metadata.title", () => {
  const row = { id: "a", content: "Знакомство с новым БД УК\n" + "тело ".repeat(20_000), summary: null, metadata: {} };
  const out = toListRow(row);
  assertEquals(out.content.split("\n")[0], "Знакомство с новым БД УК");
});

Deno.test("короткие значения не трогаем и truncated не ставим", () => {
  const row = { id: "a", content: "Планёрка", summary: "Кратко", metadata: {} };
  const out = toListRow(row);
  assertEquals(out.content, "Планёрка");
  assertEquals(out.summary, "Кратко");
  assertEquals(out.truncated, undefined);
});

Deno.test("summary = null остаётся null, а не превращается в строку", () => {
  const out = toListRow({ id: "a", content: "x".repeat(50_000), summary: null, metadata: {} });
  assertEquals(out.summary, null);
});

Deno.test("остальные поля проходят насквозь без изменений", () => {
  const row = { id: "a", content: "c", summary: "s", metadata: { title: "T" }, countries: ["RS"], is_private: false };
  const out = toListRow(row) as Record<string, unknown>;
  assertEquals(out.metadata, { title: "T" });
  assertEquals(out.countries, ["RS"]);
  assertEquals(out.is_private, false);
});
