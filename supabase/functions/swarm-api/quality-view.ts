// Ответ Децимуса GET /api/v1/ratings/scores → формат GET /quality. Чистый модуль под тестом
// (quality-view.test.ts): данные чужой системы читаются на экране как факт.

export type Kind = "rs" | "rko";
export type QualityUnit = { id: string; name: string; cc: string; developer: string | null; scores: (number | null)[] };
export type QualityView = { kind: Kind; periods: { start: string; end: string }[]; units: QualityUnit[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isScore = (v: unknown): v is number | null => v === null || (typeof v === "number" && v >= 0 && v <= 100);

/** Ответ Децимуса → наш формат. Чужим данным не верим: кривое поле — ошибка, а не тихий ноль. */
export function toView(kind: Kind, body: unknown, countries: string[] | null): QualityView {
  const b = body as { periods?: unknown; units?: unknown } | null;
  if (!b || !Array.isArray(b.periods) || !Array.isArray(b.units)) throw new Error("decimus: нет periods/units");
  const periods = b.periods.map((p) => {
    const { start, end } = (p ?? {}) as { start?: unknown; end?: unknown };
    if (typeof start !== "string" || !DATE.test(start) || typeof end !== "string" || !DATE.test(end)) {
      throw new Error("decimus: кривой период");
    }
    return { start, end };
  });
  const allow = countries ? new Set(countries) : null;
  const units: QualityUnit[] = [];
  for (const raw of b.units) {
    const u = (raw ?? {}) as Record<string, unknown>;
    const cc = typeof u.cc === "string" ? u.cc.trim().toUpperCase() : "";
    if (typeof u.id !== "string" || typeof u.name !== "string" || !/^[A-Z]{2}$/.test(cc)) {
      throw new Error("decimus: кривая пиццерия");
    }
    if (!Array.isArray(u.scores) || u.scores.length !== periods.length || !u.scores.every(isScore)) {
      throw new Error(`decimus: баллы пиццерии ${u.id} не выровнены по периодам`);
    }
    if (allow && !allow.has(cc)) continue;
    units.push({
      id: u.id,
      name: u.name,
      cc,
      developer: typeof u.developer === "string" ? u.developer : null,
      scores: u.scores,
    });
  }
  return { kind, periods, units };
}
