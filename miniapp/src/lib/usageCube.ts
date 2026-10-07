// «Расход модели» (#822, владелец 07.10.2026: «чтобы можно было четко понимать когда где какой
// расход»). Сервер отдаёт расход клетками день × назначение × модель × встреча; здесь клетки
// фильтруются (назначение, модель) и сводятся во всё, что показывает экран: итоги, разрезы, ряды
// графика с разбивкой по назначениям, самые дорогие встречи, средний и пиковый день. Деньги —
// поэтому чистая логика под тестами.

import { bucketUsage, type UsageBucket, type UsageGrain } from "@/lib/usageBuckets";

export type UsageCell = {
  day: string;
  purpose: string;
  model: string;
  meeting_id: string | null;
  usd: number;
  calls: number;
  unpriced: number;
  tokens: number;
  audio_seconds: number;
};

export type UsageFilter = { purpose: string | null; model: string | null };

export type CubeSlice = { key: string; usd: number; calls: number; unpriced: number; tokens: number };

export type StackedBucket = UsageBucket & {
  /** Расход столбца по назначениям, в порядке `series`. */
  parts: number[];
};

export type UsageView = {
  total_usd: number;
  calls: number;
  unpriced_calls: number;
  audio_minutes: number;
  by_purpose: CubeSlice[];
  by_model: CubeSlice[];
  /** Назначения в легенде графика: самые дорогие, остальное — в «прочем» (`OTHER`). */
  series: string[];
  buckets: StackedBucket[];
  top_meetings: Array<{ meeting_id: string; usd: number; calls: number }>;
  /** Средний расход на день периода (включая дни без расхода). */
  avg_per_day: number;
  peak_day: { day: string; usd: number } | null;
};

/** Сколько назначений получают свой цвет на графике; остальные сводятся в «прочее». */
export const MAX_SERIES = 4;
export const OTHER = "__other__";
export const TOP_MEETINGS = 10;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function matches(c: { purpose: string; model: string }, f: UsageFilter): boolean {
  return (f.purpose === null || c.purpose === f.purpose) && (f.model === null || c.model === f.model);
}

function slices(cells: readonly UsageCell[], key: (c: UsageCell) => string): CubeSlice[] {
  const m = new Map<string, CubeSlice>();
  for (const c of cells) {
    const k = key(c);
    const s = m.get(k) ?? { key: k, usd: 0, calls: 0, unpriced: 0, tokens: 0 };
    m.set(k, { key: k, usd: s.usd + c.usd, calls: s.calls + c.calls, unpriced: s.unpriced + c.unpriced, tokens: s.tokens + c.tokens });
  }
  return [...m.values()].map((s) => ({ ...s, usd: round6(s.usd) })).sort((a, b) => b.usd - a.usd || b.calls - a.calls);
}

function daysIn(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86_400_000) + 1 : 0;
}

function stack(cells: readonly UsageCell[], from: string, to: string, grain: UsageGrain, series: string[]): StackedBucket[] {
  const idx = (p: string) => {
    const i = series.indexOf(p);
    return i >= 0 ? i : series.indexOf(OTHER);
  };
  const perSeries = series.map((s) =>
    bucketUsage(
      cells.filter((c) => idx(c.purpose) === series.indexOf(s)).map((c) => ({ day: c.day, usd: c.usd, calls: c.calls })),
      from,
      to,
      grain,
    )
  );
  const all = bucketUsage(cells.map((c) => ({ day: c.day, usd: c.usd, calls: c.calls })), from, to, grain);
  return all.map((b, i) => ({ ...b, parts: perSeries.map((s) => s[i]?.usd ?? 0) }));
}

/** Всё для экрана из клеток периода `from`–`to` под фильтром. */
export function usageView(
  allCells: readonly UsageCell[],
  from: string,
  to: string,
  grain: UsageGrain,
  filter: UsageFilter,
): UsageView {
  const cells = allCells.filter((c) => c.day >= from && c.day <= to && matches(c, filter));
  const by_purpose = slices(cells, (c) => c.purpose);
  const by_model = slices(cells, (c) => c.model);
  const priced = by_purpose.filter((s) => s.usd > 0).map((s) => s.key);
  const series = priced.length > MAX_SERIES ? [...priced.slice(0, MAX_SERIES - 1), OTHER] : priced;

  const days = new Map<string, number>();
  for (const c of cells) days.set(c.day, (days.get(c.day) ?? 0) + c.usd);
  let peak_day: UsageView["peak_day"] = null;
  for (const [day, usd] of days) if (usd > 0 && (peak_day === null || usd > peak_day.usd)) peak_day = { day, usd: round6(usd) };

  const meetings = slices(cells.filter((c) => c.meeting_id !== null), (c) => c.meeting_id as string);
  const total = cells.reduce((s, c) => s + c.usd, 0);
  const n = daysIn(from, to);
  return {
    total_usd: round6(total),
    calls: cells.reduce((s, c) => s + c.calls, 0),
    unpriced_calls: cells.reduce((s, c) => s + c.unpriced, 0),
    audio_minutes: Math.round(cells.reduce((s, c) => s + c.audio_seconds, 0) / 60),
    by_purpose,
    by_model,
    series,
    buckets: stack(cells, from, to, grain, series),
    top_meetings: meetings.slice(0, TOP_MEETINGS).map((m) => ({ meeting_id: m.key, usd: m.usd, calls: m.calls })),
    avg_per_day: n > 0 ? round6(total / n) : 0,
    peak_day,
  };
}
