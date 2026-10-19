// Вкладка «Агрегаторы» блока «Рейтинги»: итог по выбранным странам из GET /quality/aggregators.
// Чистые функции без React, под тестами (homeAggregators.test.ts). Шкалы у агрегаторов разные (5/10/100):
// оценки разных агрегаторов никогда не смешиваются — итог считается внутри одного агрегатора.

import type { AggregatorInfo, AggregatorScore, AggregatorsData } from "./api";

export type AggregatorTotal = AggregatorInfo & {
  avg: number | null;
  delta: number | null;
  votes: number;
  pizzerias: number;
  /** В скольких выбранных странах агрегатор есть. */
  countries: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Итог по каждому агрегатору среди выбранных стран: оценка и изменение взвешены числом оценок (votes), пиццерии суммируются. Агрегатор без единой страны выборки в итог не попадает. */
export function aggregatorTotals(data: AggregatorsData, codes: string[]): AggregatorTotal[] {
  const want = new Set(codes);
  const rows = data.countries.filter((c) => want.has(c.cc));
  const out: AggregatorTotal[] = [];
  for (const a of data.aggregators) {
    const scores = rows.map((c) => c.scores[a.key]).filter((s): s is AggregatorScore => !!s);
    if (!scores.length) continue;
    const mean = (pick: (s: AggregatorScore) => number | null): number | null => {
      const have = scores.filter((s) => pick(s) != null);
      const weight = (s: AggregatorScore) => s.votes;
      const total = have.reduce((n, s) => n + weight(s), 0);
      if (!have.length) return null;
      // Ни у одной страны нет оценок-голосов — простое среднее, чтобы не делить на ноль.
      return round2(total
        ? have.reduce((n, s) => n + (pick(s) as number) * weight(s), 0) / total
        : have.reduce((n, s) => n + (pick(s) as number), 0) / have.length);
    };
    out.push({
      ...a,
      avg: mean((s) => s.avg),
      delta: mean((s) => s.delta),
      votes: scores.reduce((n, s) => n + s.votes, 0),
      pizzerias: scores.reduce((n, s) => n + s.pizzerias, 0),
      countries: scores.length,
    });
  }
  return out;
}

/** Знаков после запятой для оценки на шкале: 100 — целые, 10 — десятые, 5 — сотые. */
export const scoreDigits = (scale: number): number => (scale >= 100 ? 0 : scale > 5 ? 1 : 2);
/** Для изменения — на знак точнее: 0.4 из 100 не должно округляться до нуля. */
export const deltaDigits = (scale: number): number => scoreDigits(scale) + (scale >= 100 ? 1 : 0);
