// Календарные примитивы «Роя»: RU-локаль, неделя с понедельника, ISO-строки "YYYY-MM-DD".
// Жили внутри DatePicker.tsx — вынесены сюда, чтобы RangePicker (выбор периода в рельсе задач)
// рисовал ТУ ЖЕ сетку месяца и те же подписи, а не их разошедшуюся копию.

export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function parseISO(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// «12 августа 2026» — подпись даты в триггере.
export function fmtFull(s: string): string | null {
  const d = parseISO(s);
  return d ? `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}` : null;
}

// «12 авг» — компактная подпись (границы диапазона в узком рельсе).
export function fmtShort(s: string): string | null {
  const d = parseISO(s);
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : null;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// Локальная полночь даты (день без времени), в часовом поясе устройства.
export function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Сетка месяца, неделя с понедельника: ведущие пустые ячейки + дни месяца, добитые до кратности 7.
export function buildGrid(view: Date): (Date | null)[] {
  const year = view.getFullYear(), month = view.getMonth();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Пн = 0
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
