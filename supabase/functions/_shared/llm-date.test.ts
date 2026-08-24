import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeExtractedDueDate, normalizeExtractedEventDate, todayIso } from "./llm-date.ts";

const TODAY = "2026-08-24"; // день, когда баг поймали на проде

Deno.test("боевой случай: 2023-08-28 при сегодня 2026-08-24 → 2026-08-28", () => {
  assertEquals(normalizeExtractedDueDate("2023-08-28", TODAY), "2026-08-28");
});

Deno.test("свежая дата рядом с сегодня остаётся как есть", () => {
  assertEquals(normalizeExtractedDueDate("2026-09-01", TODAY), "2026-09-01");
  assertEquals(normalizeExtractedDueDate("2026-08-24", TODAY), "2026-08-24");
});

Deno.test("слегка просроченный срок из тезисов не трогаем", () => {
  // «до 17 августа», встречу вычитывают 24-го — задача просрочена, но год верный
  assertEquals(normalizeExtractedDueDate("2026-08-17", TODAY), "2026-08-17");
  assertEquals(normalizeExtractedDueDate("2026-07-01", TODAY), "2026-07-01");
});

Deno.test("год подставляется вперёд, если тот же день в этом году уже далеко в прошлом", () => {
  // «к 15 января», сказано в августе → январь следующего года
  assertEquals(normalizeExtractedDueDate("2023-01-15", TODAY), "2027-01-15");
});

Deno.test("прошлогодний срок чинится на ближайший будущий", () => {
  assertEquals(normalizeExtractedDueDate("2025-09-10", TODAY), "2026-09-10");
});

Deno.test("дальний, но осмысленный горизонт планирования сохраняется", () => {
  assertEquals(normalizeExtractedDueDate("2027-01-11", TODAY), "2027-01-11");
});

Deno.test("29 февраля: берётся ближайший високосный год, если он в горизонте", () => {
  // сегодня 2027-08-24 → 29 февраля 2028-го через полгода, дата реальна
  assertEquals(normalizeExtractedDueDate("2020-02-29", "2027-08-24"), "2028-02-29");
});

Deno.test("29 февраля вне горизонта → null, а не выдуманный срок", () => {
  // от 2026-08-24 ближайшее 29 февраля — только в 2028-м, это дальше вменяемого горизонта
  assertEquals(normalizeExtractedDueDate("2020-02-29", TODAY), null);
});

Deno.test("мусор и пустые значения → null", () => {
  assertEquals(normalizeExtractedDueDate(null, TODAY), null);
  assertEquals(normalizeExtractedDueDate(undefined, TODAY), null);
  assertEquals(normalizeExtractedDueDate("", TODAY), null);
  assertEquals(normalizeExtractedDueDate("null", TODAY), null);
  assertEquals(normalizeExtractedDueDate("завтра", TODAY), null);
  assertEquals(normalizeExtractedDueDate("28.08.2026", TODAY), null);
  assertEquals(normalizeExtractedDueDate("2026-8-4", TODAY), null);
});

Deno.test("несуществующая календарная дата → null, а не 2 марта", () => {
  assertEquals(normalizeExtractedDueDate("2026-02-30", TODAY), null);
  assertEquals(normalizeExtractedDueDate("2026-13-01", TODAY), null);
});

Deno.test("пробелы по краям не мешают", () => {
  assertEquals(normalizeExtractedDueDate("  2026-09-01  ", TODAY), "2026-09-01");
});

Deno.test("todayIso отдаёт YYYY-MM-DD в UTC", () => {
  assertEquals(todayIso(new Date("2026-08-24T22:15:00Z")), "2026-08-24");
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(todayIso()), true);
});

// ── entry_date: дата события записи смотрит в прошлое ─────────────────────────

Deno.test("боевой случай: запись 2026 года с датой события 2023 → чинится на 2026", () => {
  // на проде 4 таких записи, созданы в мае-июне 2026 с entry_date 2023
  assertEquals(normalizeExtractedEventDate("2023-05-14", TODAY), "2026-05-14");
});

Deno.test("дата события в прошлом году сохраняется — грузят и старые документы", () => {
  assertEquals(normalizeExtractedEventDate("2025-10-01", TODAY), "2025-10-01");
});

Deno.test("дата события в будущем — почти всегда ошибка года, тянем назад", () => {
  assertEquals(normalizeExtractedEventDate("2027-03-05", TODAY), "2026-03-05");
});

Deno.test("вчерашняя и сегодняшняя дата события проходят как есть", () => {
  assertEquals(normalizeExtractedEventDate("2026-08-23", TODAY), "2026-08-23");
  assertEquals(normalizeExtractedEventDate(TODAY, TODAY), TODAY);
});

Deno.test("мусор в дате события → null", () => {
  assertEquals(normalizeExtractedEventDate(null, TODAY), null);
  assertEquals(normalizeExtractedEventDate("на прошлой неделе", TODAY), null);
  assertEquals(normalizeExtractedEventDate("2026-02-30", TODAY), null);
});
