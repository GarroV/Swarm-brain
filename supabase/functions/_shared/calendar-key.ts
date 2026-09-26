// Ключ календарной встречи — одно место на весь сервер (issue #545).
//
// Ключ `<iCalUID|id>:<YYYY-MM-DD>` собирают две стороны, и они обязаны совпадать до символа:
//   • meeting-current отдаёт его рекордеру и боту как identity_key;
//   • meeting-claim (agent-scope.ts) по нему ищет встречу в календаре названного человека.
// Разъедутся — сверка перестанет находить свои же встречи. Поэтому формат живёт здесь, а
// регулярка, по которой agent-scope узнаёт календарный ключ, стоит рядом со сборкой.
//
// Дата — локальная дата начала из самого события (`start.dateTime` несёт смещение часового
// пояса календаря), без пересчёта в UTC: у повторяющейся встречи uid один на всю серию, и
// различает экземпляры именно дата.

/** Ровно те поля события Google, из которых собирается ключ. */
export interface CalendarKeySource {
  id: string;
  iCalUID?: string;
  start?: { dateTime?: string; date?: string };
}

/** Форма ключа, собранного calendarKeyOf. keyShape в meeting-claim узнаёт календарь по ней. */
export const CALENDAR_KEY = /^\S+:\d{4}-\d{2}-\d{2}$/;

/** Ключ встречи со временем начала; у событий на весь день (`start.date`) ключа нет — null. */
export function calendarKeyOf(ev: CalendarKeySource): string | null {
  const start = ev.start?.dateTime;
  if (!start) return null;
  return `${ev.iCalUID ?? ev.id}:${start.slice(0, 10)}`;
}
