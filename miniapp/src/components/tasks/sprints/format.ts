// Даты доски инициатив — в одном месте, потому что их читают трое: шапка спринта,
// строки задач и баннер ритуала. Три копии `fmtDay` разъезжаются молча: одна начинает
// писать «10 сен», другая «10.09», и человек считает, что видит разные даты.

/** «10 сен» — короткий день для строк и чипов. */
// Локаль дат берётся из языка ДОКУМЕНТА, а не зашита: в демо интерфейс английский, и
// «13 сент. — 26 сент.» посреди английского экрана читается как недоделка (issue #389).
// Через `<html lang>`, а не параметром в каждой функции: потребителей девять, и добавление
// аргумента в каждую превращает мелкую правку в переборку половины экрана — а сам `lang`
// продукту всё равно нужен верный, его читают скринридеры и браузер.
export function uiLocale(): string {
  if (typeof document === "undefined") return "ru-RU";
  return document.documentElement.lang === "en" ? "en-GB" : "ru-RU";
}

export function fmtDay(value: string): string {
  const d = new Date(value);
  return isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(uiLocale(), { day: "numeric", month: "short" });
}

/** «10 сен — 23 сен» — период спринта. */
export function fmtRange(from: string, to: string): string {
  return `${fmtDay(from)} — ${fmtDay(to)}`;
}

/**
 * Сколько дней осталось до конца дня `endDate`; отрицательное — просрочено.
 * Конец дня, а не полночь: иначе задача со сроком «сегодня» весь день числится просроченной.
 */
export function daysLeft(endDate: string): number {
  const end = new Date(`${endDate}T23:59:59`);
  return Math.ceil((end.getTime() - Date.now()) / 86_400_000);
}

/** Срок прошёл. Незакрытость задачи проверяет вызывающий: закрытая просроченной не считается. */
export function isOverdue(date: string): boolean {
  return daysLeft(date) < 0;
}
