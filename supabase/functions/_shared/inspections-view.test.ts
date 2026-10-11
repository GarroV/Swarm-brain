// Ответы Децимуса GET /api/v1/inspections[/<id>] → GET /inspections[/:id]: проверки читаются на экране
// и в ответах Claude как факт, поэтому кривое поле — ошибка, а не тихий ноль; страны режутся и у нас.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { toInspectionDetail, toInspectionsView } from "./inspections-view.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";

const row = (over: Record<string, unknown> = {}) => ({
  id: A,
  unit: { id: B, dodo_id: "a".repeat(32), name: "Belgrade-1", cc: "rs" },
  date: "2026-10-02",
  kind: "planned",
  score_pct: 97.5,
  grade: "A",
  path: `/registry/${A}`,
  previous: { id: P, date: "2026-07-01", score_pct: 94, grade: "B" },
  ...over,
});
const list = (rows: unknown[] = [row()]) => ({ inspections: rows, truncated: false });
const detail = () => ({
  inspection: {
    ...row(),
    deductions: 12.5,
    counts: { critical: 1, major: 3 },
    zones: [{ zone: "KIT", title_ru: "Кухня", title_en: "Kitchen", pct: 95 }],
  },
  findings: [
    { n: 2, code: "D1.2", title_ru: null, title_en: null, level: "major", zone: "KIT", text: null, repeat: false },
    {
      n: 1,
      code: "D1.1",
      title_ru: "Пункт",
      title_en: "Item",
      level: "critical",
      zone: "KIT",
      text: "Текст",
      repeat: true,
    },
  ],
});

Deno.test("toInspectionsView: поля как есть, cc в верхнем регистре, previous сохраняется", () => {
  const v = toInspectionsView(list(), null);
  assertEquals(v.truncated, false);
  assertEquals(v.inspections[0].unit.cc, "RS");
  assertEquals(v.inspections[0].score_pct, 97.5);
  assertEquals(v.inspections[0].previous, { id: P, date: "2026-07-01", score_pct: 94, grade: "B" });
  assertEquals(v.inspections[0].path, `/registry/${A}`);
});

Deno.test("toInspectionsView: нет previous (поле отсутствует или null) — null", () => {
  const noField = row();
  delete (noField as { previous?: unknown }).previous;
  const v = toInspectionsView(list([noField, row({ previous: null })]), null);
  assertEquals(v.inspections.map((r) => r.previous), [null, null]);
});

Deno.test("toInspectionsView: страны вне рынков воркспейса отбрасываются", () => {
  const other = row({ id: B, unit: { id: A, dodo_id: null, name: "Zagreb-1", cc: "HR" } });
  const v = toInspectionsView(list([row(), other]), ["HR"]);
  assertEquals(v.inspections.map((r) => r.unit.name), ["Zagreb-1"]);
});

Deno.test("toInspectionsView: порядок — по дате, новые первыми", () => {
  const older = row({ id: B, date: "2026-09-01" });
  const v = toInspectionsView(list([older, row()]), null);
  assertEquals(v.inspections.map((r) => r.date), ["2026-10-02", "2026-09-01"]);
});

Deno.test("toInspectionsView: процент вне 0..100 или не числом — ошибка", () => {
  for (const pct of [100.1, -1, "97", NaN, null]) {
    assertThrows(() => toInspectionsView(list([row({ score_pct: pct })]), null), Error, "decimus");
  }
  const prev = row({ previous: { id: P, date: "2026-07-01", score_pct: 101, grade: "B" } });
  assertThrows(() => toInspectionsView(list([prev]), null), Error, "decimus");
});

Deno.test("toInspectionsView: кривой uuid, cc, дата, нет массива — ошибка", () => {
  assertThrows(() => toInspectionsView(list([row({ id: "x" })]), null), Error, "decimus");
  assertThrows(() => toInspectionsView(list([row({ unit: { id: B, name: "N", cc: "RSB" } })]), null), Error, "decimus");
  assertThrows(() => toInspectionsView(list([row({ date: "02.10.2026" })]), null), Error, "decimus");
  assertThrows(() => toInspectionsView({ truncated: false }, null), Error, "decimus");
  assertThrows(() => toInspectionsView(null, null), Error, "decimus");
});

Deno.test("toInspectionsView: кривая строка вне разрешённых стран тоже ошибка (порчу фильтром не прячем)", () => {
  const bad = row({ unit: { id: A, name: "Z", cc: "HR" }, score_pct: 500 });
  assertThrows(() => toInspectionsView(list([row(), bad]), ["RS"]), Error, "decimus");
});

Deno.test("toInspectionDetail: итог, зоны, нарушения по номеру", () => {
  const d = toInspectionDetail(detail(), null)!;
  assertEquals(d.inspection.deductions, 12.5);
  assertEquals(d.inspection.counts, { critical: 1, major: 3 });
  assertEquals(d.inspection.zones[0], { zone: "KIT", title_ru: "Кухня", title_en: "Kitchen", pct: 95 });
  assertEquals(d.findings.map((f) => f.n), [1, 2]);
  assertEquals(d.findings[0].repeat, true);
  assertEquals(d.findings[1].text, null);
});

Deno.test("toInspectionDetail: чужая страна — null (вызывающий отвечает 404)", () => {
  assertEquals(toInspectionDetail(detail(), ["HR"]), null);
});

Deno.test("toInspectionDetail: кривые зоны, счётчики, нарушения — ошибка", () => {
  const z = detail();
  z.inspection.zones[0].pct = 120;
  assertThrows(() => toInspectionDetail(z, null), Error, "decimus");
  const c = detail();
  (c.inspection.counts as Record<string, number>).major = -2;
  assertThrows(() => toInspectionDetail(c, null), Error, "decimus");
  const f = detail();
  (f.findings[0] as { n: unknown }).n = 0;
  assertThrows(() => toInspectionDetail(f, null), Error, "decimus");
  const l = detail();
  (l.findings[0] as { level: unknown }).level = 5;
  assertThrows(() => toInspectionDetail(l, null), Error, "decimus");
  assertThrows(() => toInspectionDetail({ inspection: row() }, null), Error, "decimus");
});
