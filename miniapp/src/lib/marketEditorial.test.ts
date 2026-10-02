import { assertEquals } from "jsr:@std/assert@1";
import { parseEditorial } from "./marketEditorial.ts";

Deno.test("empty or broken editorial gives empty blocks, not a crash", () => {
  for (const raw of [undefined, null, 7, "x", []]) {
    const e = parseEditorial(raw);
    assertEquals(e.header, null);
    assertEquals(e.events, []);
    assertEquals(e.growth, null);
    assertEquals(e.texts, {});
  }
});

Deno.test("bad rows are skipped, good rows kept", () => {
  const e = parseEditorial({
    events: [
      { date: "2024-03-22", kind: "entry", chain: "Dodo", text: "first" },
      { date: "март 2024", kind: "entry", chain: "Dodo", text: "bad date" },
      { date: "2024", kind: "party", chain: "Dodo", text: "bad kind" },
      { date: "2025", kind: "exit", text: "no chain is fine" },
    ],
    summary: [{ title: "T", big: "1", text: "x" }, { title: "no big" }],
    dodo_monthly: [{ m: "2025-02", eur: 2 }, { m: "2024-12", eur: 1 }, { m: "2025", eur: 3 }],
    dodo_ops: [{ u: "Z1", m: 1, rev: 10, o: 2 }, { u: "Z1", m: 13, o: 2 }, { u: "Z1", m: 2, o: 0 }],
  });
  assertEquals(e.events.map((x) => x.text), ["first", "no chain is fine"]);
  assertEquals(e.summary.length, 1);
  assertEquals(e.dodoMonthly.map((x) => x.m), ["2024-12", "2025-02"]);
  assertEquals(e.dodoOps.length, 1);
  assertEquals(e.dodoOps[0].agg, 0);
});

Deno.test("price columns compile regexes and drop broken ones", () => {
  const e = parseEditorial({
    prices_cols: [
      { title: "A", chain: "dodo", channel: "^Wolt$", cm: 30 },
      { title: "B", chain: "dodo", channel: "(" },
      { title: "C" },
    ],
  });
  assertEquals(e.pricesCols.length, 2);
  assertEquals(e.pricesCols[0].channel?.test("Wolt"), true);
  assertEquals(e.pricesCols[0].channel?.test("Wolt Market"), false);
  assertEquals(e.pricesCols[1].channel, null);
});

Deno.test("ops model rows must match the chain count", () => {
  const e = parseEditorial({ ops_model: { chains: ["a", "b"], rows: [["Entry", "2024", "2020"], ["Short", "x"], ["Num", 7, null]] } });
  assertEquals(e.opsModel?.rows, [["Entry", "2024", "2020"], ["Num", "7", "—"]]);
});

Deno.test("growth keeps only year keys with numbers", () => {
  const e = parseEditorial({ growth: { keys: ["sub"], hist: { sub: { "2020": 11, "x": 2, "2021": "12" } }, notes: { sub: "n", bad: 3 } } });
  assertEquals(e.growth?.hist, { sub: { 2020: 11 } });
  assertEquals(e.growth?.notes, { sub: "n" });
});

Deno.test("map presets need four numbers", () => {
  const e = parseEditorial({ map_presets: [{ name: "Z", box: [1, 2, 3, 4] }, { name: "Bad", box: [1, 2, "3", 4] }] });
  assertEquals(e.mapPresets.map((p) => p.name), ["Z"]);
});
