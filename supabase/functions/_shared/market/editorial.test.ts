import { assertEquals } from "jsr:@std/assert@1";
import { parseEditorial } from "./editorial.ts";

Deno.test("editorial keeps known blocks of the right shape", () => {
  const errors: string[] = [];
  const e = parseEditorial({ summary: [{ title: "a", big: "b", text: "c" }], texts: { map: "x" } }, errors);
  assertEquals([Object.keys(e), errors], [["summary", "texts"], []]);
});

Deno.test("editorial rejects unknown blocks, wrong shapes and profit fields", () => {
  const errors: string[] = [];
  const e = parseEditorial(
    { nope: [], summary: {}, pizza_table: [{ name: "x", net_profit_eur: -1 }], texts: "x" },
    errors,
  );
  assertEquals(Object.keys(e), []);
  assertEquals(errors, [
    "editorial.nope: неизвестный блок",
    "editorial.summary: ожидается массив",
    "editorial.pizza_table[0].net_profit_eur: прибыль и убыток в разделе не показываются",
    "editorial.texts: ожидается объект",
  ]);
});

Deno.test("editorial is optional", () => {
  const errors: string[] = [];
  assertEquals([parseEditorial(undefined, errors), errors], [{}, []]);
});
