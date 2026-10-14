// Ответ Децимуса GET /api/v1/maps/ratings → GET /quality/maps: рейтинги карт читаются на экране
// как факт, поэтому кривое поле — ошибка, а не тихий ноль; страны режутся и у нас.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { toMapsView } from "./maps-view.ts";

const stat = { avg: 4.62, reviews: 1234, branches: 12, delta: 0.03 };
const body = () => ({
  on: "2026-10-11",
  compare: "2026-09-11",
  providers: ["google", "yandex"],
  countries: [
    {
      cc: "rs",
      as_of: "2026-10-10",
      maps: { google: { ...stat }, yandex: { avg: null, reviews: 0, branches: 12, delta: null } },
    },
    { cc: "HR", as_of: null, maps: { google: { ...stat }, yandex: { ...stat } } },
  ],
  units: [
    {
      id: "a".repeat(32),
      name: "Alpha-1",
      cc: "RS",
      city: "Belgrade",
      maps: { google: { avg: 4.5, reviews: 321, prev_avg: 4.4 }, yandex: null },
    },
    {
      id: "b".repeat(32),
      name: "Beta-1",
      cc: "hr",
      city: null,
      maps: { google: { avg: 3.1, reviews: 10, prev_avg: null }, yandex: { avg: 4, reviews: 5, prev_avg: 4 } },
    },
  ],
  loaded_at: "2026-10-11T03:10:00Z",
});

Deno.test("toMapsView: поля как есть, код страны в верхнем регистре", () => {
  const v = toMapsView(body(), null);
  assertEquals(v.countries.map((c) => c.cc), ["RS", "HR"]);
  assertEquals(v.countries[0].maps.google, stat);
  assertEquals(v.countries[0].maps.yandex.avg, null);
  assertEquals(v.units[0].maps, { google: { avg: 4.5, reviews: 321, prev_avg: 4.4 }, yandex: null });
  assertEquals(v.units[1].city, null);
  assertEquals(v.loaded_at, "2026-10-11T03:10:00Z");
});

Deno.test("toMapsView: страны вне рынков воркспейса отбрасываются и в сводке, и в пиццериях", () => {
  const v = toMapsView(body(), ["HR"]);
  assertEquals(v.countries.map((c) => c.cc), ["HR"]);
  assertEquals(v.units.map((u) => u.name), ["Beta-1"]);
});

Deno.test("toMapsView: оценка вне 0–5 или строкой — ошибка", () => {
  for (const avg of [5.01, -0.1, "4.5", NaN]) {
    const b = body();
    b.countries[0].maps.google.avg = avg as number;
    assertThrows(() => toMapsView(b, null), Error, "decimus");
  }
  const u = body();
  u.units[0].maps.google!.avg = 6;
  assertThrows(() => toMapsView(u, null), Error, "decimus");
});

Deno.test("toMapsView: отзывы дробные или отрицательные — ошибка", () => {
  for (const reviews of [-1, 1.5, "3"]) {
    const b = body();
    b.units[0].maps.google!.reviews = reviews as number;
    assertThrows(() => toMapsView(b, null), Error, "decimus");
  }
});

Deno.test("toMapsView: кривой cc, id не строкой, нет массивов — ошибка", () => {
  const cc = body();
  cc.units[0].cc = "RSB";
  assertThrows(() => toMapsView(cc, null), Error, "decimus");
  const id = body();
  (id.units[0] as { id: unknown }).id = 7;
  assertThrows(() => toMapsView(id, null), Error, "decimus");
  assertThrows(() => toMapsView({ units: [] }, null), Error, "decimus");
  assertThrows(() => toMapsView(null, null), Error, "decimus");
});

Deno.test("toMapsView: кривая пиццерия вне разрешённых стран тоже ошибка (не прячем порчу фильтром)", () => {
  const b = body();
  b.units[1].maps.google!.avg = 9;
  assertThrows(() => toMapsView(b, ["RS"]), Error, "decimus");
});
