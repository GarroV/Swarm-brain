import { assert, assertEquals } from "jsr:@std/assert@1";
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

Deno.test("#1132: rows and fields hidden by the screen are refused before recording success", () => {
  const cases = [
    { events: [{ date: "2026", kind: "close", text: "closed" }] },
    { pizza_table: [{ name: "Example", chain: "example", entry: 2015 }] },
    { location_dates: [{ name: "Example" }] },
    { location_dates: [{ name: "Example", closed: "30.01.2025" }] },
    { delivery_platforms: [{ name: "Example", years: [{ year: "2025", revenue_eur: 100 }] }] },
    { ratings: [{ chain: "example", point: "Example", google: "4.5", glovo: 92 }] },
    { growth: { keys: ["example"], hist: { example: { "2024": "100" } } } },
  ];
  for (const raw of cases) {
    const errors: string[] = [];
    assertEquals(parseEditorial(raw, errors), {}, JSON.stringify(raw));
    assert(errors.length > 0, JSON.stringify(raw));
    assert(errors[0].startsWith(`editorial.${Object.keys(raw)[0]}`), errors.join("; "));
  }
});

Deno.test("#1132: existing text conversions, aliases and platforms without years remain valid", () => {
  const raw = {
    pizza_table: [{ name: "Example", chain: "example", entry: "2015", units: 5 }],
    ratings: [{ chain: "example", point: "Example", glovo_pct: 95, bolt_food: 4.5, yandex_eda: 4.8 }],
    delivery_platforms: [{ name: "Example" }],
    dodo_monthly: [{ m: "2025-02", eur: 2 }, { m: "2024-12", eur: 1 }],
    prices_cols: [{ title: "Example", chain: "example", channel: "site|/own" }],
  };
  const errors: string[] = [];
  assertEquals(parseEditorial(raw, errors), raw);
  assertEquals(errors, []);
});
