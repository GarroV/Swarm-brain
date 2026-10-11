// Проверки Децимуса текстом для Claude (MCP get_inspections / get_inspection): компактная таблица и деталь.
// Чистые функции — проверяются без сети. Данные приходят уже проверенными (inspections-view.ts).
import type { Inspection, InspectionDetail } from "./inspections-view.ts";

/** Сколько строк списка отдаём Claude за раз: больше — таблица не читается, фильтры сужают. */
export const INSPECTIONS_TABLE_MAX = 50;

const grade = (g: string | null) => g ?? "—";
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/** Движение к прошлой проверке той же пиццерии: «+2.5» / «−1.0» / «=» / «—» (прошлой нет). */
export function moveText(r: Pick<Inspection, "score_pct" | "previous">): string {
  if (!r.previous) return "—";
  const d = Math.round((r.score_pct - r.previous.score_pct) * 10) / 10;
  if (d === 0) return "=";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
}

export function formatInspectionsTable(rows: Inspection[], truncated: boolean): string {
  if (!rows.length) return "Проверок по этим условиям нет.";
  const shown = rows.slice(0, INSPECTIONS_TABLE_MAX);
  const lines = shown.map((r) =>
    `${r.date} | ${r.unit.name} (${r.unit.cc}) | ${pct(r.score_pct)} ${grade(r.grade)} | ${moveText(r)} | ${r.id}`
  );
  const head = "Дата | Пиццерия | Балл, класс | К прошлой | id\n" + lines.join("\n");
  const notes: string[] = [];
  if (rows.length > shown.length) {
    notes.push(`Показаны ${shown.length} из ${rows.length}, самые свежие — сузь фильтрами.`);
  }
  if (truncated) notes.push("Децимус отдал не все проверки окна — сузь период или страну.");
  return notes.length ? `${head}\n\n⚠️ ${notes.join(" ")}` : head;
}

export function formatInspectionDetail(d: InspectionDetail, reportUrl: string | null): string {
  const i = d.inspection;
  const prev = i.previous
    ? `${i.previous.date}: ${pct(i.previous.score_pct)} ${grade(i.previous.grade)} (${moveText(i)})`
    : "прошлой проверки нет";
  const counts = Object.entries(i.counts).map(([k, v]) => `${k}: ${v}`).join(", ") || "—";
  const out = [
    `${i.unit.name} (${i.unit.cc}), проверка ${i.date}${i.kind ? ` · ${i.kind}` : ""}`,
    `Итог: ${pct(i.score_pct)}, класс ${grade(i.grade)}; вычеты ${i.deductions}`,
    `Прошлая: ${prev}`,
    `Нарушений по классам — ${counts}`,
    `Отчёт: ${reportUrl ?? "ссылка недоступна"}`,
    "",
    "Зоны:",
    ...(i.zones.length
      ? i.zones.map((z) => `• ${z.title_ru ?? z.title_en ?? z.zone} (${z.zone}) — ${pct(z.pct)}`)
      : ["—"]),
    "",
    `Нарушения (${d.findings.length}):`,
    ...(d.findings.length
      ? d.findings.map((f) =>
        `${f.n}. [${f.level}] ${f.code} ${f.title_ru ?? f.title_en ?? ""}${f.repeat ? " (повтор)" : ""}` +
        ` — зона ${f.zone}${f.text ? `: ${f.text}` : ""}`
      )
      : ["—"]),
  ];
  return out.join("\n");
}
