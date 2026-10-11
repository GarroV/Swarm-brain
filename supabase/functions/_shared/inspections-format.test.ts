import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  formatInspectionDetail,
  formatInspectionsTable,
  INSPECTIONS_TABLE_MAX,
  moveText,
} from "./inspections-format.ts";
import type { Inspection, InspectionDetail } from "./inspections-view.ts";

const row = (over: Partial<Inspection> = {}): Inspection => ({
  id: "11111111-1111-4111-8111-111111111111",
  unit: { id: "u", dodo_id: null, name: "Belgrade-1", cc: "RS" },
  date: "2026-10-02",
  kind: null,
  score_pct: 97.5,
  grade: "A",
  path: "/registry/x",
  previous: { id: "p", date: "2026-07-01", score_pct: 94, grade: "B" },
  ...over,
});

Deno.test("moveText: рост, падение, ровно, нет прошлой", () => {
  assertEquals(moveText(row()), "+3.5");
  assertEquals(moveText(row({ score_pct: 90 })), "−4.0");
  assertEquals(moveText(row({ score_pct: 94 })), "=");
  assertEquals(moveText(row({ previous: null })), "—");
});

Deno.test("formatInspectionsTable: строка с пиццерией, баллом, движением и id; пусто — прямо", () => {
  const t = formatInspectionsTable([row()], false);
  assertStringIncludes(t, "2026-10-02 | Belgrade-1 (RS) | 97.5% A | +3.5 | 11111111");
  assertEquals(formatInspectionsTable([], false), "Проверок по этим условиям нет.");
});

Deno.test("formatInspectionsTable: усечение говорит прямо (иначе Claude решит, что разобрал всё)", () => {
  const many = Array.from({ length: INSPECTIONS_TABLE_MAX + 3 }, () => row());
  assertStringIncludes(formatInspectionsTable(many, false), `Показаны ${INSPECTIONS_TABLE_MAX} из ${many.length}`);
  assertStringIncludes(formatInspectionsTable([row()], true), "не все проверки");
});

Deno.test("formatInspectionDetail: итог, зоны, нарушения с повтором, ссылка", () => {
  const d: InspectionDetail = {
    inspection: {
      ...row(),
      deductions: 2.5,
      counts: { major: 1 },
      zones: [{ zone: "KIT", title_ru: "Кухня", title_en: null, pct: 90 }],
    },
    findings: [{
      n: 1,
      code: "D1.1",
      title_ru: "Пункт",
      title_en: null,
      level: "major",
      zone: "KIT",
      text: "Текст",
      repeat: true,
    }],
  };
  const t = formatInspectionDetail(d, "https://d.example/registry/x");
  for (
    const s of [
      "97.5%",
      "Кухня (KIT) — 90%",
      "1. [major] D1.1 Пункт (повтор) — зона KIT: Текст",
      "https://d.example/registry/x",
    ]
  ) {
    assertStringIncludes(t, s);
  }
});
