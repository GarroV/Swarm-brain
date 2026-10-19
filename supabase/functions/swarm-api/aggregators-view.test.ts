// Ответ Децимуса GET /api/v1/aggregators/ratings → GET /quality/aggregators: шкалы агрегаторов разные,
// изменение считается внутри агрегатора и страны, кривое поле — ошибка, страны режутся и у нас.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { toAggregatorsView } from "./aggregators-view.ts";

const body = (on: string, glovo: number | null, wolt: number) => ({
  on,
  aggregators: [
    { key: "glovo", title: "Glovo", scale: 100 },
    { key: "wolt", title: "Wolt", scale: 10 },
    { key: "bolt", title: "Bolt Food", scale: 5 },
  ],
  countries: [
    {
      cc: "rs",
      as_of: "2026-10-10",
      scores: {
        glovo: { avg: glovo, scale: 100, votes: 500, pizzerias: 4 },
        wolt: { avg: wolt, scale: 10, votes: 300, pizzerias: 5 },
      },
    },
    { cc: "HR", as_of: null, scores: { wolt: { avg: 9, scale: 10, votes: 10, pizzerias: 1 } } },
  ],
  units: [],
  loaded_at: "2026-10-11T03:10:00Z",
});

Deno.test("toAggregatorsView: изменение внутри агрегатора, шкалы не смешиваются, код страны в верхнем регистре", () => {
  const v = toAggregatorsView(body("2026-10-19", 92, 8.4), body("2026-09-19", 90, 8.5), null);
  assertEquals(v.on, "2026-10-19");
  assertEquals(v.compare, "2026-09-19");
  assertEquals(v.countries.map((c) => c.cc), ["RS", "HR"]);
  assertEquals(v.countries[0].scores.glovo, { avg: 92, scale: 100, votes: 500, pizzerias: 4, delta: 2 });
  assertEquals(v.countries[0].scores.wolt.delta, -0.1);
  assertEquals(v.countries[1].scores.wolt.delta, 0);
});

Deno.test("toAggregatorsView: агрегатор без единой страны выборки выпадает из списка", () => {
  const v = toAggregatorsView(body("2026-10-19", 92, 8.4), null, ["HR"]);
  assertEquals(v.countries.map((c) => c.cc), ["HR"]);
  assertEquals(v.aggregators.map((a) => a.key), ["wolt"]);
});

Deno.test("toAggregatorsView: нет среза сравнения — оценки есть, изменений нет", () => {
  const v = toAggregatorsView(body("2026-10-19", 92, 8.4), null, null);
  assertEquals(v.compare, null);
  assertEquals(v.countries[0].scores.glovo.delta, null);
  assertEquals(v.countries[0].scores.glovo.avg, 92);
});

Deno.test("toAggregatorsView: нет оценки сейчас или раньше — изменение null", () => {
  const v = toAggregatorsView(body("2026-10-19", null, 8.4), body("2026-09-19", 90, 8.5), null);
  assertEquals(v.countries[0].scores.glovo.avg, null);
  assertEquals(v.countries[0].scores.glovo.delta, null);
});

Deno.test("toAggregatorsView: кривые поля — ошибка, а не тихий ноль", () => {
  const bump = (fn: (b: ReturnType<typeof body>) => void) => {
    const b = body("2026-10-19", 92, 8.4);
    fn(b);
    return b;
  };
  assertThrows(() => toAggregatorsView(null, null, null));
  assertThrows(() => toAggregatorsView({ on: "2026-10-19" }, null, null));
  assertThrows(
    () => toAggregatorsView(bump((b) => (b.countries[0].scores.wolt.avg = 11)), null, null),
    Error,
    "вне шкалы",
  );
  assertThrows(() => toAggregatorsView(bump((b) => (b.countries[0].scores.wolt.votes = -1)), null, null));
  assertThrows(
    () => toAggregatorsView(bump((b) => (b.countries[0].scores.wolt.scale = 5)), null, null),
    Error,
    "шкала",
  );
  assertThrows(() => toAggregatorsView(bump((b) => (b.countries[0].cc = "RSB")), null, null), Error, "страны");
  assertThrows(() => toAggregatorsView(bump((b) => (b.on = "11.10")), null, null));
  // порча в стране вне выборки тоже ошибка — фильтром не прячем
  assertThrows(() => toAggregatorsView(bump((b) => (b.countries[1].scores.wolt.avg = -1)), null, ["RS"]));
});
