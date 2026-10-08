// Ремонт привязки календаря при входе через Google (issue #828).
//
// refresh_token Google отдаёт только при первом согласии. Вход идёт без prompt=consent, поэтому
// у того, чья первая привязка не сохранилась, повторные входы её никогда не чинили — молча:
// у владельца привязка появилась лишь 07.10.2026, после многих входов. Теперь такой вход один
// раз уводит человека на экран согласия на календарь (flow=calendar, prompt=consent), где токен
// приходит. Снятую галочку уважаем (решение владельца 2026-08-28): нет scope — не ведём.

export const CALENDAR_REPAIR_COOKIE = "roj_cal_repair";
/** Не чаще раза в 30 дней на браузер: если поток согласия сломан, вход не должен в нём застрять. */
export const CALENDAR_REPAIR_MAX_AGE = 30 * 86400;

export function needsCalendarRepair(p: {
  calendarGranted: boolean;
  gotRefreshToken: boolean;
  /** null — проверить не удалось: тогда не ведём, вход важнее календаря. */
  linked: boolean | null;
  askedRecently: boolean;
}): boolean {
  return p.calendarGranted && !p.gotRefreshToken && p.linked === false && !p.askedRecently;
}

export function calendarRepairCookie(): string {
  return `${CALENDAR_REPAIR_COOKIE}=1; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${CALENDAR_REPAIR_MAX_AGE}`;
}
