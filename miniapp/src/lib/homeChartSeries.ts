// Ряды графиков главной (РС, РКО): период «с — по» в месяцах, разбивка и подписи.
// Чистые функции без React — под тестами (homeChartSeries.test.ts).
//
// Период задаётся целыми месяцами: у РС шаг — полумесячная волна, у РКО — неделя, и месяц —
// наименьшая единица, в которую ложатся оба. Стрелки ← → листают период на его длину.

/** Месяц как число: год × 12 + номер месяца с нуля. Сравнивается и складывается как число. */
export type MonthKey = number;
export type MonthRange = { from: MonthKey; to: MonthKey };
export type Grain = "wave" | "week" | "month" | "quarter";
export type Point = { date: Date; value: number };
export type Bucket = { key: string; label: string; value: number };

export const monthKey = (d: Date): MonthKey => d.getFullYear() * 12 + d.getMonth();
export const monthYear = (k: MonthKey) => Math.floor(k / 12);
export const monthIndex = (k: MonthKey) => ((k % 12) + 12) % 12;

const MONTHS_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTERS_RU = ["I", "II", "III", "IV"];

export const monthShort = (k: MonthKey, en: boolean) => (en ? MONTHS_EN : MONTHS_RU)[monthIndex(k)];

/** Нормализует порядок и прижимает период к доступным данным, сохраняя длину, где можно. */
export function clampRange(r: MonthRange, bounds: MonthRange): MonthRange {
  let from = Math.min(r.from, r.to), to = Math.max(r.from, r.to);
  const len = to - from;
  if (to > bounds.to) { to = bounds.to; from = to - len; }
  if (from < bounds.from) { from = bounds.from; to = Math.min(bounds.to, from + len); }
  return { from, to };
}

/** Сдвиг на длину периода (← −1, → +1) в пределах данных. */
export function shiftRange(r: MonthRange, dir: -1 | 1, bounds: MonthRange): MonthRange {
  const len = r.to - r.from + 1;
  return clampRange({ from: r.from + dir * len, to: r.to + dir * len }, bounds);
}

export const canShift = (r: MonthRange, dir: -1 | 1, bounds: MonthRange) =>
  dir < 0 ? r.from > bounds.from : r.to < bounds.to;

/** «Фев — Сен 2026», «Ноя 2025 — Фев 2026», «Сен 2026». */
export function rangeLabel(r: MonthRange, en: boolean): string {
  const a = `${monthShort(r.from, en)}`, b = `${monthShort(r.to, en)} ${monthYear(r.to)}`;
  if (r.from === r.to) return b;
  return monthYear(r.from) === monthYear(r.to) ? `${a} — ${b}` : `${a} ${monthYear(r.from)} — ${b}`;
}

function bucketOf(p: Date, grain: Grain, en: boolean): { key: string; label: string } {
  const k = monthKey(p);
  const yy = String(monthYear(k)).slice(2);
  switch (grain) {
    case "wave": {
      const half = p.getDate() < 16 ? 1 : 2;
      return { key: `${k}-${half}`, label: `${monthShort(k, en)} ${half}` };
    }
    case "week": {
      const dd = String(p.getDate()).padStart(2, "0"), mm = String(p.getMonth() + 1).padStart(2, "0");
      // Ключ из местной даты: toISOString сдвинул бы полночь в соседний день по UTC.
      return { key: `${p.getFullYear()}-${mm}-${dd}`, label: `${dd}.${mm}` };
    }
    case "month":
      return { key: String(k), label: `${monthShort(k, en)} ${yy}` };
    case "quarter": {
      const q = Math.floor(monthIndex(k) / 3);
      return { key: `${monthYear(k)}-${q}`, label: en ? `Q${q + 1} ${yy}` : `${QUARTERS_RU[q]} кв ${yy}` };
    }
  }
}

/**
 * Точки ряда внутри периода, сведённые к разбивке средним. Точки должны идти по времени;
 * порядок корзин — порядок первого появления. Пустой период → пустой ряд.
 */
export function bucketize(points: Point[], range: MonthRange, grain: Grain, en: boolean): Bucket[] {
  const acc = new Map<string, { label: string; sum: number; n: number }>();
  for (const p of points) {
    const k = monthKey(p.date);
    if (k < range.from || k > range.to) continue;
    const b = bucketOf(p.date, grain, en);
    const cur = acc.get(b.key);
    if (cur) { cur.sum += p.value; cur.n += 1; } else acc.set(b.key, { label: b.label, sum: p.value, n: 1 });
  }
  return [...acc.entries()].map(([key, v]) => ({ key, label: v.label, value: Math.round((v.sum / v.n) * 10) / 10 }));
}

/**
 * Значения корзин, выровненные по ключам общей оси (обычно — корзины IMF). Где у ряда точки нет,
 * стоит null: линия рвётся, а не дорисовывается выдуманным значением.
 */
export function alignTo(keys: string[], buckets: Bucket[]): Array<number | null> {
  const byKey = new Map(buckets.map((b) => [b.key, b.value]));
  return keys.map((k) => byKey.get(k) ?? null);
}

/** Шкала оси: границы и 3–6 «круглых» делений, норма всегда в пределах. */
export function niceScale(values: number[], norm: number, cap = 100): { min: number; max: number; ticks: number[] } {
  const all = [...values.filter(Number.isFinite), norm];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  const step = [0.5, 1, 2, 2.5, 5, 10, 20].find((s) => span / s <= 5) ?? 20;
  const min = Math.floor((lo - span * 0.08) / step) * step;
  const max = Math.min(cap, Math.ceil((hi + span * 0.08) / step) * step);
  const ticks: number[] = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 10) / 10);
  return { min, max: Math.max(max, min + step), ticks };
}
