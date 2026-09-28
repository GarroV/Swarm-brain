// Даты спринта. Календарные, без времени и без часового пояса — как колонка `date` в базе.
//
// Почему не `Date`: `new Date('2026-09-18')` разбирается как полночь UTC, а `.getDate()` и
// форматирование берут локальный пояс. Пока сервер (Deno, UTC) и браузер (пояс пользователя,
// любой) считают одну и ту же дату по-разному, спринт у кого-то начинается «вчера». Здесь дата —
// три числа, и арифметика идёт в UTC от начала до конца.
//
// Temporal.PlainDate решал бы это красивее, но в Safari он стабильно недоступен, а версия
// рантайма edge-функций не проверена — решение D005.

/** Длина спринта в днях (решение владельца: две недели). */
const SPRINT_DAYS = 14;
/** Сверка — на шестой день от старта: середина спринта, ещё есть время что-то изменить. */
const CHECK_OFFSET_DAYS = 6;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(
  date: string,
  field: string,
): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(date);
  if (!m) {
    throw new Error(
      `${field}: негодная дата ${
        JSON.stringify(date)
      }, нужен формат ГГГГ-ММ-ДД`,
    );
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Сверяем разбор с календарём: «2026-02-31» формату соответствует, а дня такого нет.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new Error(
      `${field}: такой даты нет в календаре — ${JSON.stringify(date)}`,
    );
  }
  return { y, m: mo, d };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Календарное «плюс N дней». Работает одинаково в любом часовом поясе. */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date, "дата");
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${
    pad(t.getUTCDate())
  }`;
}

/** «дд.мм» для имени спринта — так его читают в баннере и в выгрузке. */
export function shortDate(date: string): string {
  const { m, d } = parse(date, "дата");
  return `${pad(d)}.${pad(m)}`;
}

/** Номер из имени спринта; `null` — если имя дали руками и номера в нём нет. */
export function sprintNumber(name: string): number | null {
  const m = /(\d+)/.exec(name);
  return m ? Number(m[1]) : null;
}

export interface CycleDates {
  name: string;
  start_date: string;
  end_date: string;
}

export interface NextCycleDates extends CycleDates {
  check_date: string;
}

/**
 * Параметры следующего спринта: встык к прошлому, две недели, сверка на шестой день.
 * Имя без номера (спринт назвали руками) приёмку не роняет — следующий считается вторым.
 */
export function nextCycleDates(prev: CycleDates): NextCycleDates {
  // Обе даты разбираем сразу: негодная приходит из базы или из тела запроса, и отказ должен
  // называть поле, а не падать где-то дальше на «Invalid Date».
  parse(prev.start_date, "старт прошлого спринта");
  parse(prev.end_date, "конец прошлого спринта");
  const start = addDays(prev.end_date, 1);
  const end = addDays(start, SPRINT_DAYS - 1);
  const check = addDays(start, CHECK_OFFSET_DAYS);
  const num = (sprintNumber(prev.name) ?? 1) + 1;
  return {
    name: `Спринт ${num} · ${shortDate(start)} — ${shortDate(end)}`,
    start_date: start,
    end_date: end,
    check_date: check,
  };
}
