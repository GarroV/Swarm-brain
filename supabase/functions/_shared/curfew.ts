// Комендантский час уведомлений: с 23:00 до 9:00 по Москве бот людям в Telegram ничего не шлёт
// по своей инициативе (решение владельца 13.10.2026,
// docs/decisions/2026-10-13-notification-curfew.md). Веб (колокольчик, плашки) работает как
// обычно; технические тревоги владельцу и ответы на действие самого человека — вне часа.
// Чистая функция без БД/Telegram: «пора ли молчать» живёт в одном месте, а отправку и очередь
// на утро делает _shared/notify-person.ts.

export const CURFEW_TZ = "Europe/Moscow";
/** Час начала тишины (включительно): 23:00. */
export const CURFEW_FROM_HOUR = 23;
/** Час конца тишины (не включая): с 9:00 уже можно. */
export const CURFEW_TO_HOUR = 9;

const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: CURFEW_TZ, hour: "2-digit", hourCycle: "h23" });

/** Идёт ли сейчас комендантский час: [23:00, 24:00) ∪ [00:00, 9:00) по Москве. */
export function inCurfew(now: Date): boolean {
  const hour = Number(hourFormat.format(now));
  return hour >= CURFEW_FROM_HOUR || hour < CURFEW_TO_HOUR;
}
