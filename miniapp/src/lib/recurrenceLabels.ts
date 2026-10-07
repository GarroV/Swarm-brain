// Подписи и варианты меню повторяемости задачи. Арифметика дат и сами подписи — в
// `recurrenceRule.ts` (копия серверного канона `_shared/tasks/recurrence-rule.ts`), здесь —
// только то, что нужно меню и строке задачи: быстрые варианты, бейдж, варианты «n-го дня»,
// превью ближайших дат.
//
// День недели, число и месяц берутся из срока задачи. Исключение: у monthly по числу и yearly
// приоритет за `recur_anchor_dom` — у задачи, зажатой коротким месяцем (срок 28.02, якорь 31),
// срок показывает не то число, по которому она реально ходит.

import {
  isoWeekday,
  isRecurFreq,
  ordinalEn,
  RECUR_SETPOS_LAST,
  type RecurFreq,
  recurrenceText,
  setposText,
  upcomingOccurrences,
  weekdayOrdinalInMonth,
} from "@/lib/recurrenceRule";


export type RecurrenceText = { ru: string; en: string };

/** Правило повторяемости в том виде, в каком его хранит задача (кроме якоря числа). */
export type RecurValue = {
  freq: RecurFreq;
  interval: number;
  weekdays: number[] | null;
  setpos: number | null;
};

export type RecurrenceOption = RecurrenceText & { id: RecurFreq; value: RecurValue };

/** Поля задачи, из которых читается правило. */
export type RecurTaskFields = {
  recur_freq: string | null;
  recur_interval?: number | null;
  recur_weekdays?: number[] | null;
  recur_setpos?: number | null;
};

export const QUICK_FREQS: readonly RecurFreq[] = ["daily", "weekly", "monthly", "yearly"];

/** Правило из полей задачи; null — задача не регулярная. */
export function recurValueOf(t: RecurTaskFields): RecurValue | null {
  if (!isRecurFreq(t.recur_freq)) return null;
  return {
    freq: t.recur_freq,
    interval: t.recur_interval ?? 1,
    weekdays: t.recur_weekdays?.length ? [...t.recur_weekdays] : null,
    setpos: t.recur_setpos ?? null,
  };
}

/** Простое правило «каждый день/неделю/месяц/год» — то, что есть среди быстрых вариантов. */
export function isQuickValue(v: RecurValue | null): boolean {
  return !!v && v.interval === 1 && !v.weekdays && v.setpos === null;
}

export function quickValue(freq: RecurFreq): RecurValue {
  return { freq, interval: 1, weekdays: null, setpos: null };
}

/** Подпись правила словами, с заглавной: «Каждые 2 недели: ср», «Каждый 3-й понедельник месяца». */
export function recurrenceLabel(
  v: RecurValue | null,
  dueISO: string | null | undefined,
  anchorDom?: number | null,
): RecurrenceText | null {
  if (!v) return null;
  return recurrenceText({ ...v, anchorDom }, dueISO);
}

/** Быстрые варианты меню, подписи — от срока (без срока меню подставит сегодня). */
export function recurrenceOptions(
  dueISO: string | null | undefined,
  anchorDom?: number | null,
): RecurrenceOption[] | null {
  if (!dueISO || isoWeekday(dueISO) === null) return null;
  return QUICK_FREQS.map((freq) => {
    const value = quickValue(freq);
    const text = recurrenceLabel(value, dueISO, anchorDom)!;
    return { id: freq, value, ...text };
  });
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Короткая подпись для бейджа в строке задачи, где срок может быть не виден. */
export function recurrenceBadge(
  t: RecurTaskFields,
  dueISO: string | null | undefined,
  anchorDom?: number | null,
): RecurrenceText | null {
  const v = recurValueOf(t);
  if (!v) return null;
  // Срок могли снять мимо веба (правка в базе/через MCP) — честнее показать «повторяется»,
  // чем уронить строку или соврать конкретным днём. daily от срока не зависит.
  if (!dueISO && v.freq !== "daily") return { ru: "повторяется", en: "repeats" };
  const text = recurrenceLabel(v, dueISO, anchorDom);
  return text ? { ru: lowerFirst(text.ru), en: lowerFirst(text.en) } : null;
}

/**
 * Варианты «как считать месяц» для срока: по числу, n-й день недели, последний день недели.
 * Подписи — для переключателя в меню правила: «15-го числа» / «3-й понедельник» / «последний
 * понедельник».
 */
export function monthlyModes(dueISO: string): Array<RecurrenceText & { setpos: number | null }> {
  const wd = isoWeekday(dueISO);
  const nth = weekdayOrdinalInMonth(dueISO);
  if (wd === null || nth === null) return [];
  const dom = Number(dueISO.slice(8, 10));
  const modes: Array<RecurrenceText & { setpos: number | null }> = [
    { setpos: null, ru: `${dom}-го числа`, en: `on the ${ordinalEn(dom)}` },
  ];
  // 5-й день недели — всегда ещё и последний: два одинаковых варианта ни к чему.
  if (nth < 5) modes.push({ setpos: nth, ...setposText(nth, wd) });
  modes.push({ setpos: RECUR_SETPOS_LAST, ...setposText(RECUR_SETPOS_LAST, wd) });
  return modes;
}

/** Ближайшие даты по правилу после max(срок, сегодня) — строка превью в меню правила. */
export function previewDates(
  v: RecurValue,
  dueISO: string,
  todayISO: string,
  count = 3,
): string[] {
  return upcomingOccurrences(v, dueISO, todayISO, count);
}
