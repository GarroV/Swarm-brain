export const REPORT_TZ = "Europe/Belgrade";

export interface DayWindow {
  sinceISO: string;
  untilISO: string;
  dateLabel: string;
}

// UTC-инстант локальной полуночи даты `localDate` (YYYY-MM-DD) в таймзоне `tz`.
// Смещение tz читается из Intl на этот момент → устойчиво к переходу на летнее время.
function tzMidnightUTC(localDate: string, tz: string): Date {
  const guess = new Date(`${localDate}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = asUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

export function yesterdayWindow(tz: string = REPORT_TZ, now: Date = new Date()): DayWindow {
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const todayLocal = dateFmt.format(now);
  const todayMidnightUTC = tzMidnightUTC(todayLocal, tz);
  // Шаг на 12ч назад гарантированно попадает во «вчера» даже в 23/25-часовые DST-сутки.
  const yProbe = new Date(todayMidnightUTC.getTime() - 12 * 3_600_000);
  const yLocal = dateFmt.format(yProbe);
  const sinceUTC = tzMidnightUTC(yLocal, tz);
  const [, mm, dd] = yLocal.split("-");
  return {
    sinceISO: sinceUTC.toISOString(),
    untilISO: todayMidnightUTC.toISOString(),
    dateLabel: `${dd}.${mm}`,
  };
}
