import { assertEquals } from "jsr:@std/assert@1";
import { LIST_PREVIEW_CHARS, toListRow } from "./meetings-payload.ts";

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
