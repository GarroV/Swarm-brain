// Раннер тот же, что у quickAddTask.test.ts и edge-функций: deno test -A --no-check src/lib/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EMPTY_FILTERS, isFilterActive, parseSavedFilters, type MeetingsFilterState } from "./meetingsFilters.ts";

const filled: MeetingsFilterState = {
  query: "дизайн", period: "week", from: "", to: "",
  countries: ["RS", "ID"], sources: ["Granola"], people: ["Indira Ravilova"],
  storage: "personal", status: "confirmed",
};

Deno.test("сохранённый выбор восстанавливается целиком", () => {
  assertEquals(parseSavedFilters(JSON.stringify(filled)), filled);
});

Deno.test("хранится пресет периода, а не его границы — «Неделя» не протухает", () => {
  // Ловушка, из-за которой период в задачах пришлось пересчитывать от сегодня: сохрани мы
  // посчитанные from/to, «эта неделя» через месяц молча стала бы прошлой. Здесь у пресета
  // границ нет вовсе — их считает periodBounds() в момент фильтрации.
  const restored = parseSavedFilters(JSON.stringify(filled));
  assertEquals(restored.period, "week");
  assertEquals(restored.from, "");
  assertEquals(restored.to, "");
});

Deno.test("произвольный период сохраняет свои даты — их пересчитывать нельзя", () => {
  const custom = { ...EMPTY_FILTERS, period: "custom" as const, from: "2026-08-01", to: "2026-08-15" };
  assertEquals(parseSavedFilters(JSON.stringify(custom)), custom);
});

Deno.test("мусор в хранилище не роняет экран, а даёт пустой фильтр", () => {
  for (const junk of [null, "", "не json", "[1,2,3]", '"строка"', "42"]) {
    assertEquals(parseSavedFilters(junk), EMPTY_FILTERS, `мусор: ${junk}`);
  }
});

Deno.test("чужие значения полей отбрасываются по одному, остальное остаётся", () => {
  const raw = JSON.stringify({
    ...filled, period: "century", storage: "секретное", status: 7, countries: ["RS", 5, null],
  });
  const r = parseSavedFilters(raw);
  assertEquals(r.period, "all");
  assertEquals(r.storage, "any");
  assertEquals(r.status, "any");
  assertEquals(r.countries, ["RS"]); // не-строки выброшены, строка уцелела
  assertEquals(r.query, "дизайн");   // валидное поле не пострадало
});

Deno.test("отсутствующие поля берутся из дефолтов, а не превращаются в undefined", () => {
  assertEquals(parseSavedFilters(JSON.stringify({ period: "month" })), { ...EMPTY_FILTERS, period: "month" });
});

Deno.test("isFilterActive: пустой фильтр не активен, любой выставленный — активен", () => {
  assertEquals(isFilterActive(EMPTY_FILTERS), false);
  assertEquals(isFilterActive(filled), true);
  assertEquals(isFilterActive({ ...EMPTY_FILTERS, countries: ["RS"] }), true);
  assertEquals(isFilterActive({ ...EMPTY_FILTERS, query: "   " }), false); // пробелы — не запрос
});
