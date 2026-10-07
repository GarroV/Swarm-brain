// График «Расход модели» (#822): столбцы за выбранный период с шагом день / неделя / месяц.
// Сервер отдаёт расход по дням (по Белграду) только за дни, где он был; здесь дни раскладываются
// по столбцам, а пустые столбцы заполняются нулём — иначе дыра в неделю схлопнулась бы, и ось
// врала бы о времени. Чистая логика: деньги, поэтому под тестами.

import { fmtShort, monthShort, parseISO, toISO, type Lang } from "@/lib/calendar";
import type { DateRange } from "@/lib/dateRange";

export type UsageGrain = "day" | "week" | "month";

export type UsageBucket = {
  /** Первый день столбца (ISO), он же ключ. */
  start: string;
  /** Последний день столбца в пределах периода. */
  end: string;
  usd: number;
  calls: number;
};

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7)); // неделя с понедельника
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function bucketStart(d: Date, grain: UsageGrain): Date {
  if (grain === "day") return d;
  if (grain === "week") return weekStart(d);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function nextStart(d: Date, grain: UsageGrain): Date {
  if (grain === "day") return addDays(d, 1);
  if (grain === "week") return addDays(d, 7);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** Столбцы от `from` до `to` включительно; крайние неделя и месяц обрезаны по периоду. */
export function bucketUsage(
  byDay: ReadonlyArray<{ day: string; usd: number; calls: number }>,
  from: string,
  to: string,
  grain: UsageGrain,
): UsageBucket[] {
  const a = parseISO(from), b = parseISO(to);
  if (!a || !b || from > to) return [];
  const out: UsageBucket[] = [];
  for (let s = bucketStart(a, grain); toISO(s) <= to; s = nextStart(s, grain)) {
    const start = toISO(s) < from ? from : toISO(s);
    const last = toISO(addDays(nextStart(s, grain), -1));
    out.push({ start, end: last > to ? to : last, usd: 0, calls: 0 });
  }
  let i = 0;
  for (const r of [...byDay].sort((x, y) => x.day.localeCompare(y.day))) {
    if (r.day < from || r.day > to) continue;
    while (i < out.length - 1 && r.day > out[i].end) i++;
    out[i] = { ...out[i], usd: round6(out[i].usd + r.usd), calls: out[i].calls + r.calls };
  }
  return out;
}

/** Подпись столбца: день — «7 окт», неделя — «6–12 окт», месяц — «окт 2026». */
export function bucketLabel(b: UsageBucket, grain: UsageGrain, lang: Lang): string {
  const s = parseISO(b.start), e = parseISO(b.end);
  if (!s || !e) return b.start;
  if (grain === "day") return fmtShort(b.start, lang) ?? b.start;
  if (grain === "month") return `${monthShort(s.getMonth(), lang)} ${s.getFullYear()}`;
  if (b.start === b.end) return fmtShort(b.start, lang) ?? b.start;
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${monthShort(e.getMonth(), lang)}`
    : `${fmtShort(b.start, lang)} – ${fmtShort(b.end, lang)}`;
}

const isWholeMonth = (a: Date, b: Date) =>
  a.getDate() === 1 && addDays(b, 1).getDate() === 1 && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** Стрелки ← →: целый месяц листается месяцем, иначе период сдвигается на свою длину. */
export function shiftRange(r: DateRange, dir: -1 | 1): DateRange {
  const a = parseISO(r.from), b = parseISO(r.to);
  if (!a || !b) return r;
  if (isWholeMonth(a, b)) {
    const m = new Date(a.getFullYear(), a.getMonth() + dir, 1);
    return { preset: "custom", from: toISO(m), to: toISO(new Date(m.getFullYear(), m.getMonth() + 1, 0)) };
  }
  const len = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  return { preset: "custom", from: toISO(addDays(a, dir * len)), to: toISO(addDays(b, dir * len)) };
}
