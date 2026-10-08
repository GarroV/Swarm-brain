// Разбор листа «Качество по пиццериям» (РС и РКО). Фикстуры синтетические: пиццерии, люди и
// баллы выдуманы — репозиторий публичный, настоящих данных здесь быть не должно.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assignYears, parseCsv, parseLabel, parseQualitySheet, QualityFormatError } from "./sheet.ts";
import { qualityCountryCode } from "./countries.ts";

const ID = (n: number) => n.toString(16).padStart(32, "a");
const link = (n: number, type: 1 | 2) => `https://dodopizza.info/rating#/${ID(n)}/${type}?selectedRemarkType=0`;

const RS_CSV = [
  "Кол-во пиццерий,,,,,,,",
  "Рейтинг/Показатель,,,,,Ноябрь 2,Декабрь 1,Декабрь 2 ,Январь-1",
  "Девелопер,Страна,Пиццерия,,Пиццерия,,,",
  `Иван Тестов,Testland Serbia,Alpha-1,${link(1, 2)},Alpha-1,88,"91,5",-,95%`,
  `Иван Тестов,Serbia,Alpha-1,${link(1, 2)},Alpha-1,88,"91,5",-,95%`,
  `,,Alpha-2,${link(2, 2)},Alpha-2,,70,72,74`,
  `Пётр Пробный,"\n\nBelarus\n\n",Beta-1,${link(3, 2)},Beta-1,60,-,,`,
].join("\n");

const RKO_CSV = [
  "Месяц,,,,,Декабрь 2025,,Январь",
  "Неделя рейтинга,,,,,22.12 — 28.12,29.12 — 04.01,05.01 — 11.01",
  `Иван Тестов,🇳🇬 Nigeria,Gamma-1,${link(4, 1)},Gamma-1,80,—,90`,
  `,,Gamma-2,${link(5, 1)},Gamma-2,77,78,79`,
].join("\n");

const TODAY = "2026-01-20";

Deno.test("parseCsv keeps quoted commas and newlines inside a cell", () => {
  assertEquals(parseCsv('a,"b,c","d\ne"\r\nf,,"g ""q"""'), [["a", "b,c", "d\ne"], ["f", "", 'g "q"']]);
});

Deno.test("parseLabel reads RS half-months with trailing space, hyphen and an explicit year", () => {
  assertEquals(parseLabel("Июнь 1 "), { kind: "rs", m1: 6, d1: 1, m2: 6, d2: 15, year: null });
  assertEquals(parseLabel("Март-1"), { kind: "rs", m1: 3, d1: 1, m2: 3, d2: 15, year: null });
  assertEquals(parseLabel("Сентябрь 2 часть 2025"), { kind: "rs", m1: 9, d1: 16, m2: 9, d2: 0, year: 2025 });
  assertEquals(parseLabel("Май 2025"), null, "строка «Месяц» над заголовком — не период");
  assertEquals(parseLabel("Пиццерия"), null);
});

Deno.test("parseLabel reads RKO weeks", () => {
  assertEquals(parseLabel("05.05 — 11.05"), { kind: "rko", m1: 5, d1: 5, m2: 5, d2: 11, year: null });
  assertEquals(parseLabel("29.12-04.01"), { kind: "rko", m1: 12, d1: 29, m2: 1, d2: 4, year: null });
  assertEquals(parseLabel("40.01 — 11.01"), null);
});

Deno.test("assignYears walks right to left and steps the year back across December→January", () => {
  const labels = ["Ноябрь 2", "Декабрь 1", "Декабрь 2", "Январь 1"].map((l) => parseLabel(l)!);
  assertEquals(assignYears(labels, TODAY).map((p) => [p.start, p.end]), [
    ["2025-11-16", "2025-11-30"],
    ["2025-12-01", "2025-12-15"],
    ["2025-12-16", "2025-12-31"],
    ["2026-01-01", "2026-01-15"],
  ]);
});

Deno.test("assignYears: the last column starting after today belongs to last year", () => {
  const [p] = assignYears([parseLabel("Февраль 1")!], TODAY);
  assertEquals(p.start, "2025-02-01");
});

Deno.test("assignYears: a week crossing New Year ends in the next year", () => {
  const labels = ["22.12 — 28.12", "29.12 — 04.01", "05.01 — 11.01"].map((l) => parseLabel(l)!);
  assertEquals(assignYears(labels, TODAY).map((p) => [p.start, p.end]), [
    ["2025-12-22", "2025-12-28"],
    ["2025-12-29", "2026-01-04"],
    ["2026-01-05", "2026-01-11"],
  ]);
});

Deno.test("assignYears rejects a date that does not exist", () => {
  assertThrows(() => assignYears([parseLabel("31.02 — 06.03")!], TODAY), QualityFormatError, "31.02");
});

Deno.test("RS sheet: header under service rows, carry-down, decimal comma, percent, dash", () => {
  const csv = RS_CSV.split("\n").filter((l) => !l.includes("Testland")).join("\n");
  const r = parseQualitySheet(csv, { today: TODAY });
  assertEquals(r.kind, "rs");
  assertEquals(r.periods.map((p) => p.start), ["2025-11-16", "2025-12-01", "2025-12-16", "2026-01-01"]);
  const alpha2 = r.scores.filter((s) => s.unit_id === ID(2));
  assertEquals(alpha2.map((s) => [s.period_start, s.score]), [["2025-12-01", 70], ["2025-12-16", 72], [
    "2026-01-01",
    74,
  ]]);
  assertEquals(alpha2[0].developer, "Иван Тестов", "девелопер тянется вниз из первой строки блока");
  assertEquals(alpha2[0].country_code, "RS", "страна тянется вниз");
  assertEquals(r.scores.filter((s) => s.unit_id === ID(1)).map((s) => s.score), [88, 91.5, 95]);
  const beta = r.scores.filter((s) => s.unit_id === ID(3));
  assertEquals(
    beta.map((s) => [s.country_code, s.score]),
    [["BY", 60]],
    "страна в объединённой ячейке с переводами строк",
  );
  assertEquals(r.units, 3);
  assertEquals(r.countries, ["BY", "RS"]);
  assertEquals(r.issues, []);
});

Deno.test("RKO sheet: flag in the country, detected kind, em dash as no score", () => {
  const r = parseQualitySheet(RKO_CSV, { today: TODAY });
  assertEquals(r.kind, "rko");
  assertEquals(r.periods.length, 3);
  assertEquals(r.scores.filter((s) => s.unit_id === ID(4)).map((s) => s.period_start), ["2025-12-22", "2026-01-05"]);
  assert(r.scores.every((s) => s.country_code === "NG"));
});

Deno.test("an explicit kind that does not match the sheet is refused", () => {
  assertThrows(() => parseQualitySheet(RKO_CSV, { today: TODAY, kind: "rs" }), QualityFormatError, "РКО");
});

Deno.test("a file without period labels is not a quality sheet", () => {
  assertThrows(() => parseQualitySheet("a,b,c\n1,2,3", { today: TODAY }), QualityFormatError, "Качество по пиццериям");
});

Deno.test("unknown country is reported and its rows skipped", () => {
  const r = parseQualitySheet(RS_CSV, { today: TODAY });
  assert(r.issues.some((i) => i.includes("Testland Serbia")), r.issues.join("\n"));
  assertEquals(
    r.scores.filter((s) => s.unit_id === ID(1)).length,
    3,
    "следующая строка той же пиццерии уже с известной страной",
  );
});

Deno.test("an out-of-range score is rejected with a clear reason and kept out of deletion", () => {
  const csv = RKO_CSV.replace("Gamma-2,77,78", "Gamma-2,177,78");
  const r = parseQualitySheet(csv, { today: TODAY });
  assert(r.issues.some((i) => i.includes("Gamma-2") && i.includes("177") && i.includes("0–100")), r.issues.join("\n"));
  assertEquals(r.scores.filter((s) => s.unit_id === ID(5)).map((s) => s.score), [78, 79]);
  assertEquals(r.badCells, [{ unit_id: ID(5), period_start: "2025-12-22" }]);
});

Deno.test("a row without a rating link is reported, not stored", () => {
  const csv = RKO_CSV.replace(link(5, 1), "");
  const r = parseQualitySheet(csv, { today: TODAY });
  assert(
    r.issues.some((i) => i.includes("Gamma-2") && i.includes("ссылк") && i.includes("баллов: 3")),
    r.issues.join("\n"),
  );
  assertEquals(r.units, 1);
});

Deno.test("a second column with the same period start is skipped with an issue", () => {
  const csv = RKO_CSV.replace("05.01 — 11.01", "29.12 — 11.01");
  const r = parseQualitySheet(csv, { today: TODAY });
  assertEquals(r.periods.length, 2);
  assert(r.issues.some((i) => i.includes("29.12 — 11.01")), r.issues.join("\n"));
});

Deno.test("numbers under an unlabeled column are reported, not silently dropped", () => {
  const csv = RKO_CSV.replace("05.01 — 11.01", "Неделя ?");
  const r = parseQualitySheet(csv, { today: TODAY });
  assert(r.issues.some((i) => i.includes("Неделя ?")), r.issues.join("\n"));
});

Deno.test("the same pizzeria twice in one sheet is stored once", () => {
  const csv = RKO_CSV + `\n,,Gamma-2 copy,${link(5, 1)},x,1,2,3`;
  const r = parseQualitySheet(csv, { today: TODAY });
  assertEquals(r.scores.filter((s) => s.unit_id === ID(5)).map((s) => s.score), [77, 78, 79]);
  assert(r.issues.some((i) => i.includes("Gamma-2 copy")), r.issues.join("\n"));
});

Deno.test("qualityCountryCode strips flags and knows sheet spellings", () => {
  assertEquals(qualityCountryCode("🇳🇬 Nigeria"), "NG");
  assertEquals(qualityCountryCode("  Kyrgyz Republic "), "KG");
  assertEquals(qualityCountryCode("Türkiye"), "TR");
  assertEquals(qualityCountryCode("Беларусь"), "BY");
  assertEquals(qualityCountryCode("Atlantis"), null);
  assertEquals(qualityCountryCode(""), null);
});
