import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { Inspection, InspectionFinding } from "./api.ts";
import { inspectionChange, inspectionTaskDraft, latestInspections } from "./homeInspections.ts";

const insp = (name: string, cc: string, date: string, score: number, prev: number | null): Inspection => ({
  id: name + date, unit: { id: name, dodo_id: null, name, cc }, date, kind: null, score_pct: score, grade: "B",
  path: "/registry/x", report_url: "https://d.example/registry/x",
  previous: prev == null ? null : { id: "p", date: "2026-07-01", score_pct: prev, grade: "A" },
});

Deno.test("latestInspections: только страны подборки, новые первыми, при равной дате по названию", () => {
  const rows = [insp("B", "RS", "2026-10-01", 90, null), insp("A", "RS", "2026-10-01", 90, null),
    insp("C", "HR", "2026-10-09", 90, null), insp("D", "RS", "2026-10-05", 90, null)];
  assertEquals(latestInspections(rows, ["RS"]).map((r) => r.unit.name), ["D", "A", "B"]);
});

Deno.test("inspectionChange: падение отрицательное, без прошлой — null", () => {
  assertEquals(inspectionChange(insp("A", "RS", "2026-10-01", 81, 90.5)), -9.5);
  assertEquals(inspectionChange(insp("A", "RS", "2026-10-01", 92, 91.9)), 0.1);
  assertEquals(inspectionChange(insp("A", "RS", "2026-10-01", 92, null)), null);
});

Deno.test("inspectionTaskDraft: заголовок «Проверка <пиццерия> <дата>: <pct>% <класс>», ссылка и нарушения списком", () => {
  const f: InspectionFinding[] = [
    { n: 1, code: "D1.1", title_ru: "Пункт", title_en: "Item", level: "critical", zone: "KIT", text: "Текст", repeat: true },
    { n: 2, code: "D1.2", title_ru: null, title_en: null, level: "minor", zone: "KIT", text: null, repeat: false },
  ];
  const d = inspectionTaskDraft(insp("Belgrade-1", "RS", "2026-10-02", 97.5, 94), f, false);
  assertEquals(d.title, "Проверка Belgrade-1 2026-10-02: 97.5% B");
  assertEquals(d.country, "RS");
  assertStringIncludes(d.description, "Отчёт в Децимусе: https://d.example/registry/x");
  assertStringIncludes(d.description, "1. [critical] D1.1 Пункт (повтор) — Текст");
  assertStringIncludes(d.description, "2. [minor] D1.2");
  const en = inspectionTaskDraft(insp("Belgrade-1", "RS", "2026-10-02", 97.5, 94), f, true);
  assertEquals(en.title, "Inspection Belgrade-1 2026-10-02: 97.5% B");
  assertStringIncludes(en.description, "1. [critical] D1.1 Item (repeat) — Текст");
});

Deno.test("inspectionTaskDraft: без нарушений и без ссылки — пустое описание, не падает", () => {
  const r = { ...insp("A", "RS", "2026-10-01", 90, null), report_url: null };
  assertEquals(inspectionTaskDraft(r, null, false).description, "");
});
