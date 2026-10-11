// Синтетические фикстуры: цифры придуманы, реальных показателей компаний в репозитории нет.
import { assertEquals } from "@std/assert";
import {
  agree,
  bgnToEur,
  collectFilingHtml,
  decideYears,
  isReadable,
  type Page,
  parseColumns,
  parseFilings,
  readIncomeStatement,
  type Reading,
} from "./bg-registry.ts";

const stmt = (year: number, rows: string, extra = "в хил. лв.") =>
  `ОТЧЕТ ЗА ПЕЧАЛБАТА И ЗАГУБАТА И ДРУГИЯ ВСЕОБХВАТЕН ДОХОД
на Тест ЕООД за годината, приключваща на 31 декември ${year} г.
${extra}
бележка  на 31.12.${year}  на 31.12.${year - 1}
Продължаващи дейности
${rows}
Себестойност на продажбите 15 (30 011) (39 022)
`;
const page = (text: string, ocr = false): Page => ({ text, ocr });

Deno.test("filings: years and document tokens come out of the deed html, several files per year", () => {
  const html =
    `<p>Годишен финансов отчет<br/>Година: 2021г.<br /><a href='DocumentAccess/AAA_1-x'>f</a></p><hr/>` +
    `<p>Годишен финансов отчет<br/>Година: 2022г.<br /><a href='DocumentAccess/BBB'>f</a><a href="DocumentAccess/CCC">g</a></p>`;
  assertEquals(parseFilings([html]), [
    { year: 2021, token: "AAA_1-x" },
    { year: 2022, token: "BBB" },
    { year: 2022, token: "CCC" },
  ]);
  const deed = {
    sections: [{
      subDeeds: [{
        groups: [{
          fields: [
            { htmlData: html },
            { htmlData: "<p>Друго</p>" },
          ],
        }],
      }],
    }],
  };
  assertEquals(collectFilingHtml(deed), [html]);
});

Deno.test("columns: note number is not taken for part of the amount", () => {
  assertEquals(parseColumns(["14", "41", "237", "52", "618"]), [
    { cur: 41237, prev: 52618 },
  ]);
  // «14 123 456 91 234» читается двояко; колонка «бележка» известна — берём вариант с ней.
  const t = ["14", "123", "456", "91", "234"];
  assertEquals(parseColumns(t, true), [{ cur: 123456, prev: 91234 }]);
  assertEquals(parseColumns(t).length, 2);
  assertEquals(parseColumns(["7502", "9408"]), [{ cur: 7502, prev: 9408 }]);
});

Deno.test("statement: revenue line with note column, thousands of leva, header gives the year", () => {
  const r = readIncomeStatement(
    [page(stmt(2020, "Приходи от продажби 14 41 237 52 618"))],
    2099, // год из дела не совпадает с шапкой — верим шапке
  )!;
  assertEquals(r.year, 2020);
  assertEquals(r.candidates, [{ cur: 41_237_000, prev: 52_618_000 }]);
  assertEquals(r.ocr, false);
});

Deno.test("statement: label priority, sub-lines and management-report rows are not the total", () => {
  const text = stmt(
    2021,
    `Приходи от продажби на продукция 1 000 2 000
Нетни приходи от продажби 14 60 405 41 237
Нетни приходи (НП) 9 999 8 888 1 111`,
  );
  const r = readIncomeStatement([page(text)], 2021)!;
  assertEquals(r.candidates, [{ cur: 60_405_000, prev: 41_237_000 }]);
});

Deno.test("statement: amounts in plain leva are not rescaled; unnamed units below a million are refused", () => {
  const leva = readIncomeStatement(
    [page(stmt(2021, "Приходи от продажби 14 60 405 000 41 237 000", "в лв."))],
    2021,
  )!;
  assertEquals(leva.candidates[0], { cur: 60_405_000, prev: 41_237_000 });
  // тысячи не названы, 60 405 «лв.» — выручкой сети быть не может
  assertEquals(
    readIncomeStatement(
      [page(stmt(2021, "Приходи от продажби 14 60 405 41 237", "в лв."))],
      2021,
    ),
    null,
  );
});

Deno.test("statement: no revenue row means no reading", () => {
  assertEquals(
    readIncomeStatement([page("Баланс\nАктиви 1 000 2 000")], 2021),
    null,
  );
});

const rd = (
  year: number,
  cur: number,
  prev: number,
  ocr: boolean,
  extra: Array<{ cur: number; prev: number }> = [],
): Reading => ({
  year,
  yearKnown: true,
  candidates: [{ cur, prev }, ...extra],
  ocr,
});

Deno.test("agreement is within one percent", () => {
  assertEquals([agree(1000, 1009), agree(1000, 1020)], [true, false]);
});

Deno.test("core: an OCR value stays unpublished until the next year's report confirms it", () => {
  const d = decideYears([rd(2021, 60_405_000, 41_237_000, true)]);
  assertEquals(d.find((x) => x.year === 2021)?.revenueBgn, null);
  assertEquals(d.find((x) => x.year === 2021)?.reason.includes("OCR"), true);
});

Deno.test("core: OCR value confirmed by the previous-year column of the next report is published", () => {
  const d = decideYears([
    rd(2021, 60_405_000, 41_237_000, true),
    rd(2022, 101_234_000, 60_405_000, true),
  ]);
  assertEquals(d.map((x) => [x.year, x.revenueBgn]), [
    [2021, 60_405_000],
    [2022, null], // 2023 нет — 2022 держится только на OCR
  ]);
});

Deno.test("core: an OCR misread that disagrees with the next report is not published", () => {
  const d = decideYears([
    rd(2021, 61_305_000, 41_237_000, true), // 9 вместо 0
    rd(2022, 101_234_000, 60_405_000, true),
  ]);
  assertEquals(d.find((x) => x.year === 2021)?.revenueBgn, null);
});

Deno.test("core: a real text layer is published without confirmation", () => {
  const d = decideYears([rd(2022, 101_234_000, 60_405_000, false)]);
  assertEquals(d, [{
    year: 2022,
    revenueBgn: 101_234_000,
    reason: "текстовый слой PDF",
  }]);
});

Deno.test("core: ambiguous column split is resolved only by the cross-check", () => {
  // верный вариант 123 456 / 101 234 и слипшийся с бележкой 14 123 456
  const a = rd(2023, 14_123_456_000, 101_234_000, true, [
    { cur: 123_456_000, prev: 101_234_000 },
  ]);
  const next = rd(2024, 131_987_000, 123_456_000, true);
  assertEquals(
    decideYears([a, next]).find((x) => x.year === 2023)?.revenueBgn,
    123_456_000,
  );
  // без отчёта следующего года ни один вариант не публикуется
  assertEquals(
    decideYears([a]).find((x) => x.year === 2023)?.revenueBgn,
    null,
  );
});

Deno.test("years before 2020 are never published", () => {
  const d = decideYears([rd(2019, 10_000_000, 9_000_000, false)]);
  assertEquals(d, []);
});

Deno.test("leva to euro uses the fixed rate", () => {
  assertEquals(bgnToEur(1_955_830), 1_000_000);
});

Deno.test("readable page: real Cyrillic text passes, garbled font and short scans do not", () => {
  const real =
    "Приходи от продажби и разходи за годината, приключваща на тридесет и първи декември"
      .repeat(2);
  assertEquals(isReadable(real), true);
  assertEquals(
    isReadable("AMPECTEOOA OT�ET 3A BCE06XBATHHff AOXOA 2022 r. ".repeat(5)),
    false,
  );
  assertEquals(isReadable("ФОРНЕТТИ БЪЛГАРИЯ ЕООД"), false);
});

Deno.test("statement: OCR noise in the label, «в т.ч.» tail and thousands with a comma", () => {
  // единицы не названы, 14 803 «лв.» — ниже миллиона: отказ, а не молчаливо неверный масштаб
  assertEquals(
    readIncomeStatement([
      page(
        stmt(
          2020,
          "1. Нетни приходи ст продажби, BT.4.: 14 803 26 417",
          "BGN'000",
        ),
        true,
      ),
    ], 2020),
    null,
  );
  const named = readIncomeStatement([
    page(
      stmt(
        2020,
        "1. Нетни приходи ст продажби, BT.4.: 14 803 26 417",
        "в хил. лв.",
      ),
      true,
    ),
  ], 2020)!;
  assertEquals(named.candidates, [{ cur: 14_803_000, prev: 26_417_000 }]);
  const bare = readIncomeStatement([
    page(stmt(2020, "Приходи 21 8,441 9,120")),
  ], 2020)!;
  assertEquals(bare.candidates, [{ cur: 8_441_000, prev: 9_120_000 }]);
  const tail = readIncomeStatement([
    page(stmt(2020, "Приходи от продажби (хил. лв.) 11,296 7,213")),
  ], 2020)!;
  assertEquals(tail.candidates, [{ cur: 11_296_000, prev: 7_213_000 }]);
});

Deno.test("statement: a bare «Приходи» row is taken only on a page with the statement title", () => {
  assertEquals(
    readIncomeStatement(
      [page("Таблица\nхил. лв.\nПриходи 21 8 441 9 120")],
      2020,
    ),
    null,
  );
});

Deno.test("statement: a consolidated report is not the company's revenue", () => {
  const text = "КОНСОЛИДИРАНИ ФИНАНСОВИ ОТЧЕТИ КЪМ 31 ДЕКЕМВРИ 2022\n" +
    stmt(2022, "Нетни приходи от продажби 28 649 25 118");
  assertEquals(readIncomeStatement([page(text)], 2022), null);
});

Deno.test("statement: year comes from the nearest header row with two years, not from stray years above", () => {
  const text = `Програма за развитие 2014 - 2019 г., проект 2017
ОТЧЕТ ЗА ПРИХОДИТЕ И РАЗХОДИТЕ в хил. лв.
Приходи от продажби 31.12.2022 31.12.2021
Нетни приходи от продажби 28 649 25 118`;
  assertEquals(readIncomeStatement([page(text)], 2021)!.year, 2022);
});

Deno.test("statement: a split that implies a several-fold yearly jump is dropped", () => {
  const r = readIncomeStatement([
    page(stmt(2024, "Приходи от продажби 131 987 123 456")),
  ], 2024)!;
  assertEquals(r.candidates, [{ cur: 131_987_000, prev: 123_456_000 }]);
});

Deno.test("core: when two readings agree within tolerance the more frequent exact value wins", () => {
  const d = decideYears([
    rd(2022, 31_451_000, 22_906_000, true),
    rd(2023, 36_018_000, 31_457_000, true),
    rd(2023, 36_018_000, 31_457_000, true),
  ]);
  assertEquals(d.find((x) => x.year === 2022)?.revenueBgn, 31_457_000);
});

Deno.test("statement: amounts that tesseract put on separate lines below the label are paired", () => {
  const text = `ОТЧЕТ ЗА ПРИХОДИТЕ И РАЗХОДИТЕ
Сума (в хил. лв.)
Б. Приходи

1, Нетни приходи от продажби, втч:

19 532

13 705

а) продукция

17 342`;
  const r = readIncomeStatement([page(text, true)], 2022)!;
  assertEquals(r.candidates, [{ cur: 19_532_000, prev: 13_705_000 }]);
});

Deno.test("statement: a table row that holds expenses and income side by side is read from the income half", () => {
  const text = stmt(
    2021,
    "Разходи за персонала 4411 3917|1. Нетни приходи от продажби, в т.ч: 6 13 705 8 102",
  );
  assertEquals(
    readIncomeStatement([page(text, true)], 2021)!.candidates,
    [{ cur: 13_705_000, prev: 8_102_000 }],
  );
});

Deno.test("core: a report with no year on its page takes the year from the chain, and an unchained one is not published from the text layer", () => {
  const known = rd(2022, 13_705_000, 8_102_000, true);
  const unnamed: Reading = {
    year: 2022, // подан под 2022, на деле — следующий
    yearKnown: false,
    candidates: [{ cur: 19_532_000, prev: 13_705_000 }],
    ocr: true,
  };
  const d = decideYears([known, unnamed]);
  assertEquals(d.map((x) => [x.year, x.revenueBgn]), [
    [2022, 13_705_000], // подтверждён «прошлым годом» отчёта, которому год назначила цепочка
    [2023, null],
  ]);
  const lonely: Reading = { ...unnamed, ocr: false };
  assertEquals(
    decideYears([lonely]).find((x) => x.year === 2022)?.revenueBgn,
    null,
  );
});
