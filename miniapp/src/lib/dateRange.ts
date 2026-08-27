// Период (диапазон дат) — модификатор списка задач: накладывается НА активный смарт-список,
// а не подменяет его (владелец 2026-08-25: «Готовые + эта неделя» = что сделано за неделю,
// «Все + этот месяц» = вся нагрузка месяца). Чистая логика без React — как smartLists.ts.
//
// Границы ВКЛЮЧИТЕЛЬНЫЕ, обе — локальные календарные дни в ISO «YYYY-MM-DD».

import { toISO, fmtShort, MONTHS_SHORT, parseISO } from "@/lib/calendar";

export type RangePreset = "week" | "month" | "prev_week" | "prev_month" | "custom";

export type DateRange = {
  preset: RangePreset;
  from: string; // ISO, включительно
  to: string;   // ISO, включительно
};

export const RANGE_PRESETS: Array<{ id: Exclude<RangePreset, "custom">; label: string }> = [
  { id: "week", label: "Эта неделя" },
  { id: "month", label: "Этот месяц" },
  { id: "prev_week", label: "Прошлая неделя" },
  { id: "prev_month", label: "Прошлый месяц" },
];

// Понедельник недели, в которую попадает d (неделя с понедельника — как в календарной сетке).
function weekStart(d: Date): Date {
  const shift = (d.getDay() + 6) % 7; // Пн = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - shift);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Диапазон пресета ОТ ТЕКУЩЕГО дня. Считается каждый раз заново, поэтому «эта неделя»,
// пережившая рефреш в понедельник, остаётся этой неделей, а не превращается в прошлую.
export function presetRange(preset: Exclude<RangePreset, "custom">, now: Date = new Date()): DateRange {
  switch (preset) {
    case "week": {
      const s = weekStart(now);
      return { preset, from: toISO(s), to: toISO(addDays(s, 6)) };
    }
    case "prev_week": {
      const s = addDays(weekStart(now), -7);
      return { preset, from: toISO(s), to: toISO(addDays(s, 6)) };
    }
    case "month": {
      const y = now.getFullYear(), m = now.getMonth();
      return { preset, from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) };
    }
    case "prev_month": {
      const y = now.getFullYear(), m = now.getMonth() - 1;
      return { preset, from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) };
    }
  }
}

// Произвольный диапазон из двух кликов по сетке — порядок кликов не важен.
export function customRange(a: string, b: string): DateRange {
  const [from, to] = a <= b ? [a, b] : [b, a];
  return { preset: "custom", from, to };
}

// Восстановление сохранённого периода: пресет пересчитываем от сегодня, произвольный берём как есть.
// Мусор в localStorage (чужая/старая форма) → null, фильтр просто выключен.
export function resolveRange(saved: unknown, now: Date = new Date()): DateRange | null {
  if (!saved || typeof saved !== "object") return null;
  const r = saved as Partial<DateRange>;
  if (r.preset && r.preset !== "custom" && RANGE_PRESETS.some((p) => p.id === r.preset)) {
    return presetRange(r.preset as Exclude<RangePreset, "custom">, now);
  }
  if (r.preset === "custom" && typeof r.from === "string" && typeof r.to === "string" && parseISO(r.from) && parseISO(r.to)) {
    return customRange(r.from, r.to);
  }
  return null;
}

// Календарный день значения из базы. `due_date` приходит уже как «YYYY-MM-DD» — берём как есть
// (парсить нельзя: «2026-08-25» читается как UTC-полночь и в TZ западнее UTC съезжает на сутки).
// `updated_at` — timestamptz, его переводим в локальный день устройства.
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : toISO(d);
}

// Попадает ли день (ISO) в период. Обе границы включительно; лексикографическое сравнение
// ISO-строк совпадает с хронологическим.
export function inRange(day: string | null, range: DateRange | null): boolean {
  if (!range) return true;      // период не выбран — фильтр выключен
  if (day == null) return false; // нет нужной даты — в период не попадает
  return day >= range.from && day <= range.to;
}

// Подпись для триггера в рельсе: у пресета — его имя, у произвольного — «12–25 авг» / «28 авг — 3 сен».
export function rangeLabel(range: DateRange | null): string {
  if (!range) return "Весь срок";
  const preset = RANGE_PRESETS.find((p) => p.id === range.preset);
  if (preset) return preset.label;
  const from = parseISO(range.from), to = parseISO(range.to);
  if (!from || !to) return "Период";
  if (range.from === range.to) return fmtShort(range.from) ?? "Период";
  if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS_SHORT[to.getMonth()]}`;
  }
  return `${fmtShort(range.from)} — ${fmtShort(range.to)}`;
}
