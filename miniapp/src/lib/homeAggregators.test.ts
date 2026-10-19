// Итог вкладки «Агрегаторы»: считается внутри одного агрегатора, шкалы не смешиваются.
import { assertEquals } from "jsr:@std/assert@1";
import type { AggregatorScore, AggregatorsData } from "./api.ts";
import { aggregatorTotals, deltaDigits, scoreDigits } from "./homeAggregators.ts";

const sc = (avg: number | null, scale: number, votes: number, pizzerias: number, delta: number | null = null): AggregatorScore =>
  ({ avg, scale, votes, pizzerias, delta });
const data: AggregatorsData = {
  on: "2026-10-19", compare: "2026-09-19", loaded_at: null,
  aggregators: [{ key: "glovo", title: "Glovo", scale: 100 }, { key: "wolt", title: "Wolt", scale: 10 }, { key: "bolt", title: "Bolt", scale: 5 }],
  countries: [
    { cc: "RS", as_of: null, scores: { glovo: sc(90, 100, 100, 2, 2), wolt: sc(9, 10, 100, 3, 0.1) } },
    { cc: "HR", as_of: null, scores: { glovo: sc(80, 100, 300, 4, null), wolt: sc(8, 10, 100, 1, -0.3) } },
    { cc: "BA", as_of: null, scores: { bolt: sc(4.5, 5, 0, 1) } },
    { cc: "ME", as_of: null, scores: {} },
  ],
};

Deno.test("aggregatorTotals: оценка и изменение взвешены голосами внутри агрегатора, пиццерии суммируются", () => {
  const t = aggregatorTotals(data, ["RS", "HR"]);
  assertEquals(t.map((x) => x.key), ["glovo", "wolt"]); // Bolt есть только у BA — в выборке его нет
  assertEquals(t[0], { key: "glovo", title: "Glovo", scale: 100, avg: 82.5, delta: 2, votes: 400, pizzerias: 6, countries: 2 });
  assertEquals(t[1].avg, 8.5);
  assertEquals(t[1].delta, -0.1);
  assertEquals(t[1].scale, 10); // шкала своя, к 100 не приводится
});

Deno.test("aggregatorTotals: нулевые голоса — простое среднее; ни одного агрегатора — пусто", () => {
  assertEquals(aggregatorTotals(data, ["BA"])[0].avg, 4.5);
  assertEquals(aggregatorTotals(data, ["ME"]), []);
  assertEquals(aggregatorTotals(data, []), []);
});

Deno.test("scoreDigits / deltaDigits: знаки по шкале", () => {
  assertEquals([scoreDigits(100), scoreDigits(10), scoreDigits(5)], [0, 1, 2]);
  assertEquals([deltaDigits(100), deltaDigits(10), deltaDigits(5)], [1, 1, 2]);
});

Deno.test("aggregatorTotals по всем странам ответа это IMF: у каждого агрегатора своё среднее, шкалы не смешиваются", () => {
  const imf = aggregatorTotals(data, data.countries.map((c) => c.cc));
  assertEquals(imf.map((x) => [x.key, x.avg, x.scale]), [["glovo", 82.5, 100], ["wolt", 8.5, 10], ["bolt", 4.5, 5]]);
  const mine = aggregatorTotals(data, ["RS"]);
  assertEquals(mine.find((x) => x.key === "glovo")?.avg, 90);
});
