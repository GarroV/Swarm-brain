// Модель виджета «Проверки» из GET /inspections: последние проверки подборки стран, движение к прошлой
// проверке той же пиццерии и черновик задачи из проверки. Чистые функции без React, под тестами
// (homeInspections.test.ts).

import type { Inspection, InspectionDetail, InspectionFinding, InspectionZone } from "./api";

/** Сколько проверок показываем в виджете, пока не нажали «Показать ещё». */
export const INSPECTIONS_SHOWN = 8;
/** Потолок раскрытого списка: дальше — Децимус. */
export const INSPECTIONS_SHOWN_MAX = 40;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Проверки стран подборки: новые первыми, при равной дате — по названию пиццерии. */
export function latestInspections(rows: Inspection[], codes: string[]): Inspection[] {
  const set = new Set(codes);
  return rows
    .filter((r) => set.has(r.unit.cc))
    .sort((a, b) => b.date.localeCompare(a.date) || a.unit.name.localeCompare(b.unit.name));
}

/** Изменение балла к прошлой проверке той же пиццерии (п.п.); null — прошлой нет. */
export function inspectionChange(r: Pick<Inspection, "score_pct" | "previous">): number | null {
  return r.previous ? round1(r.score_pct - r.previous.score_pct) : null;
}

export const pctText = (n: number) => `${round1(n)}%`;

/** Подпись зоны: «56.5 / 60» (осталось из доли, п.п. общей оценки); обнулённая — словом. */
export function zoneValue(z: InspectionZone, dt: (ru: string, en: string) => string): string {
  if (z.zeroed) return dt("обнулена", "zeroed");
  if (z.share == null || z.left == null) return z.loss != null ? `−${round1(z.loss)}` : "—";
  return `${round1(z.left)} / ${round1(z.share)}`;
}

/** Заполнение полоски зоны, %: остаток от доли; обнулённая — пустая. */
export function zoneFill(z: InspectionZone): number {
  if (z.zeroed || !z.share || z.left == null) return 0;
  return Math.max(0, Math.min(100, (z.left / z.share) * 100));
}

export type TaskDraft = { title: string; description: string; country: string };

const findingLine = (f: InspectionFinding, en: boolean) => {
  const title = (en ? f.title_en ?? f.title_ru : f.title_ru ?? f.title_en) ?? "";
  const text = f.text ? ` — ${f.text}` : "";
  return `${f.n}. [${f.level}] ${f.code} ${title}${f.repeat ? (en ? " (repeat)" : " (повтор)") : ""}${text}`.replace(/\s+/g, " ").trim();
};

/**
 * Черновик задачи из проверки: заголовок «Проверка <пиццерия> <дата>: <pct>% <класс>», в описании ссылка
 * на отчёт и нарушения списком. Только заполняет форму создания: задачу сохраняет человек.
 */
export function inspectionTaskDraft(
  r: Inspection, findings: InspectionFinding[] | null, en: boolean,
): TaskDraft {
  const grade = r.grade ? ` ${r.grade}` : "";
  const title = `${en ? "Inspection" : "Проверка"} ${r.unit.name} ${r.date}: ${pctText(r.score_pct)}${grade}`;
  const lines: string[] = [];
  if (r.report_url) lines.push(`${en ? "Report in Decimus" : "Отчёт в Децимусе"}: ${r.report_url}`);
  if (findings?.length) {
    lines.push("", `${en ? "Violations" : "Нарушения"}:`, ...findings.map((f) => findingLine(f, en)));
  }
  return { title, description: lines.join("\n"), country: r.unit.cc };
}

/** Деталь → строка для заголовка панели: «до проверки было …». */
export function previousText(r: Pick<Inspection, "previous">, en: boolean): string {
  if (!r.previous) return en ? "no previous inspection" : "прошлой проверки нет";
  return `${r.previous.date}: ${pctText(r.previous.score_pct)}${r.previous.grade ? ` ${r.previous.grade}` : ""}`;
}

export type { InspectionDetail };
