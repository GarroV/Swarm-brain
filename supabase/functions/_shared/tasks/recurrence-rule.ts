// Правило повторяемости задачи: арифметика дат, проверка полей и подписи RU/EN.
//
// ⚠️ КАНОН. Байт-в-байт копия живёт в вебе — miniapp/src/lib/recurrenceRule.ts (превью дат
// и подписи в меню повторяемости). Правишь здесь — копируй файл туда целиком; расхождение
// валит miniapp/src/lib/recurrenceRule.test.ts. Поэтому файл без импортов и без Deno.*.
//
// Словарь — RRULE (RFC 5545), но отдельными колонками задачи, а не строкой: строку не
// проверит CHECK в базе (решение 2026-10-07, docs/decisions/2026-10-07-custom-recurrence.md):
//   recur_freq      FREQ      daily | weekly | monthly | yearly
//   recur_interval  INTERVAL  «каждые N»; 1 = каждый
//   recur_weekdays  BYDAY     только weekly: дни ISO 1=пн..7=вс; null = день недели срока
//   recur_setpos    BYSETPOS  только monthly: n-й (1..5) или последний (-1) день недели
//                             срока в месяце; null = по числу месяца
//
// Якорь графика — срок задачи (`due_date`): интервал считается от него, а не от даты
// выполнения. Следующее вхождение — первая дата графика СТРОГО ПОЗЖЕ max(срок, сегодня).

export type RecurFreq = "daily" | "weekly" | "monthly" | "yearly";

export const RECUR_FREQS: readonly RecurFreq[] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

export function isRecurFreq(v: unknown): v is RecurFreq {
  return typeof v === "string" && (RECUR_FREQS as readonly string[]).includes(v);
}

export const RECUR_INTERVAL_MAX = 99;
/** recur_setpos = -1 — последний такой день недели в месяце. */
export const RECUR_SETPOS_LAST = -1;

export interface RecurRule {
  freq: RecurFreq;
  interval?: number | null;
  weekdays?: readonly number[] | null;
  setpos?: number | null;
  /** Исходное число месяца (monthly по числу, yearly): помнит 31-е после зажатия на 28-м. */
  anchorDom?: number | null;
}

// ── даты: календарный день YYYY-MM-DD, считаем в UTC (у задачи нет времени) ──

type Ymd = { y: number; m: number; d: number };

function parseISO(iso: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(iso: string, n: number): string {
  const p = parseISO(iso)!;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function diffDays(fromISO: string, toISO: string): number {
  const a = parseISO(fromISO)!, b = parseISO(toISO)!;
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** День недели ISO: 1 = понедельник … 7 = воскресенье. */
export function isoWeekday(iso: string): number | null {
  const p = parseISO(iso);
  if (!p) return null;
  const js = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = вс
  return js === 0 ? 7 : js;
}

/** Какой по счёту этот день недели в своём месяце: 1..5. */
export function weekdayOrdinalInMonth(iso: string): number | null {
  const p = parseISO(iso);
  return p ? Math.floor((p.d - 1) / 7) + 1 : null;
}

/** Последний ли это такой день недели в месяце (через неделю будет уже другой месяц). */
export function isLastWeekdayInMonth(iso: string): boolean {
  const p = parseISO(iso);
  return !!p && p.d + 7 > daysInMonth(p.y, p.m);
}

// ── нормализация полей правила ───────────────────────────────────────────────

function cleanInterval(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 &&
      v <= RECUR_INTERVAL_MAX
    ? v
    : 1;
}

function cleanWeekdays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const days = [...new Set(v)]
    .filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  return days.length ? days : null;
}

function cleanSetpos(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) &&
      ((v >= 1 && v <= 5) || v === RECUR_SETPOS_LAST)
    ? v
    : null;
}

function cleanAnchor(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 31 ? v : fallback;
}

export type RecurFields = {
  interval: number;
  weekdays: number[] | null;
  setpos: number | null;
};

export type RecurFieldsResult =
  | ({ ok: true } & RecurFields)
  | { ok: false; error: string };

/**
 * Проверка новых полей правила из запроса (веб, MCP). null/undefined — значение по умолчанию
 * (интервал 1, дни недели и n-й день не заданы). Дни недели нормализуются: по возрастанию,
 * без повторов; пустой набор = не задан.
 */
export function validateRecurFields(
  freq: RecurFreq,
  raw: { interval?: unknown; weekdays?: unknown; setpos?: unknown },
): RecurFieldsResult {
  let interval = 1;
  if (raw.interval !== null && raw.interval !== undefined) {
    if (
      typeof raw.interval !== "number" || !Number.isInteger(raw.interval) ||
      raw.interval < 1 || raw.interval > RECUR_INTERVAL_MAX
    ) {
      return {
        ok: false,
        error: `recur_interval: ожидается целое от 1 до ${RECUR_INTERVAL_MAX}`,
      };
    }
    interval = raw.interval;
  }

  let weekdays: number[] | null = null;
  if (raw.weekdays !== null && raw.weekdays !== undefined) {
    const ok = Array.isArray(raw.weekdays) &&
      raw.weekdays.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7);
    if (!ok) {
      return {
        ok: false,
        error: "recur_weekdays: ожидается массив дней недели 1–7 (1 = пн)",
      };
    }
    weekdays = cleanWeekdays(raw.weekdays);
    if (weekdays && freq !== "weekly") {
      return {
        ok: false,
        error: "recur_weekdays: дни недели задаются только для weekly",
      };
    }
  }

  let setpos: number | null = null;
  if (raw.setpos !== null && raw.setpos !== undefined) {
    setpos = cleanSetpos(raw.setpos);
    if (setpos === null) {
      return {
        ok: false,
        error: "recur_setpos: ожидается 1–5 или -1 (последний)",
      };
    }
    if (freq !== "monthly") {
      return {
        ok: false,
        error: "recur_setpos: n-й день недели задаётся только для monthly",
      };
    }
  }

  return { ok: true, interval, weekdays, setpos };
}

// ── следующее вхождение ──────────────────────────────────────────────────────

// Страховка от бесконечного цикла на битых данных: 1200 шагов по месяцам/годам.
const MAX_STEPS = 1200;

/** Число месяца n-го (или последнего) дня недели `wd` в месяце; null — такого дня нет. */
function nthWeekdayDom(
  y: number,
  m: number,
  wd: number,
  setpos: number,
): number | null {
  const dim = daysInMonth(y, m);
  if (setpos === RECUR_SETPOS_LAST) {
    const lastWd = isoWeekday(fmt(y, m, dim))!;
    return dim - ((lastWd - wd + 7) % 7);
  }
  const firstWd = isoWeekday(fmt(y, m, 1))!;
  const d = 1 + ((wd - firstWd + 7) % 7) + (setpos - 1) * 7;
  return d <= dim ? d : null; // 5-го понедельника нет — месяц пропускается, как в RRULE
}

/**
 * Следующее вхождение графика: первая дата СТРОГО ПОЗЖЕ max(срок, сегодня).
 *
 * Выполнили в срок → следующий цикл; с опозданием → ближайшая будущая дата ТОЙ ЖЕ фазы
 * (каждые 2 недели остаются чётными от срока); досрочно → цикл не сбивается.
 * null — частота неизвестна или срока нет: считать не от чего.
 */
export function nextOccurrenceOf(
  rule: RecurRule,
  dueISO: string | null | undefined,
  todayISO: string,
): string | null {
  if (!isRecurFreq(rule.freq) || !dueISO) return null;
  const due = parseISO(dueISO);
  if (!due || !parseISO(todayISO)) return null;
  const n = cleanInterval(rule.interval);
  const floor = dueISO > todayISO ? dueISO : todayISO;

  if (rule.freq === "daily") {
    return addDays(dueISO, (Math.floor(diffDays(dueISO, floor) / n) + 1) * n);
  }

  if (rule.freq === "weekly") {
    const days = cleanWeekdays(rule.weekdays);
    if (!days) {
      const step = 7 * n;
      return addDays(
        dueISO,
        (Math.floor(diffDays(dueISO, floor) / step) + 1) * step,
      );
    }
    // Недели с шагом n считаются от недели срока (неделя — с понедельника); внутри
    // недели — дни из набора. Неделя «сегодня» лежит в блоке [start, start+n), поэтому
    // следующий блок целиком позже — двух проходов хватает всегда.
    const weekStart = addDays(dueISO, 1 - isoWeekday(dueISO)!);
    const floorWeek = Math.floor(diffDays(weekStart, floor) / 7);
    const start = Math.floor(floorWeek / n) * n;
    for (let w = start; w <= start + n; w += n) {
      for (const d of days) {
        const cand = addDays(weekStart, w * 7 + d - 1);
        if (cand > floor) return cand;
      }
    }
    return null;
  }

  const fl = parseISO(floor)!;
  const anchor = cleanAnchor(rule.anchorDom, due.d);

  if (rule.freq === "monthly") {
    const setpos = cleanSetpos(rule.setpos);
    const wd = isoWeekday(dueISO)!;
    const base = due.y * 12 + (due.m - 1);
    const floorIdx = fl.y * 12 + (fl.m - 1);
    // Месяцы раньше месяца «пола» заведомо не подходят — начинаем с блока, где он лежит.
    const k0 = Math.max(0, Math.floor((floorIdx - base) / n));
    for (let k = k0; k < k0 + MAX_STEPS; k++) {
      const idx = base + k * n;
      const y = Math.floor(idx / 12), m = (idx % 12) + 1;
      const dom = setpos === null ? Math.min(anchor, daysInMonth(y, m)) : nthWeekdayDom(y, m, wd, setpos);
      if (dom === null) continue;
      const cand = fmt(y, m, dom);
      if (cand > floor) return cand;
    }
    return null;
  }

  // yearly: тот же месяц срока, число — якорь, зажатый по длине месяца (29 фев → 28 фев
  // в невисокосный год → снова 29 фев в високосный).
  const k0 = Math.max(0, Math.floor((fl.y - due.y) / n));
  for (let k = k0; k < k0 + MAX_STEPS; k++) {
    const y = due.y + k * n;
    const cand = fmt(y, due.m, Math.min(anchor, daysInMonth(y, due.m)));
    if (cand > floor) return cand;
  }
  return null;
}

/** Несколько ближайших вхождений после max(срок, fromISO) — превью в меню повторяемости. */
export function upcomingOccurrences(
  rule: RecurRule,
  dueISO: string | null | undefined,
  fromISO: string,
  count: number,
): string[] {
  const out: string[] = [];
  let floor = fromISO;
  for (let i = 0; i < count; i++) {
    const next = nextOccurrenceOf(rule, dueISO, floor);
    if (!next) break;
    out.push(next);
    floor = next;
  }
  return out;
}

// ── подписи RU / EN ──────────────────────────────────────────────────────────
// Русский — по родам: «каждый понедельник», «каждую среду», «каждое воскресенье»;
// «каждый среда» — та ошибка, из-за которой в 2026-08 подпись weekly взяли дательной
// («по средам»). Английский — таблицами, без ICU окружения.

export type RecurText = { ru: string; en: string };

type Gender = "m" | "f" | "n";
// Индекс = ISO-день − 1 (0 = понедельник).
const WD_SHORT_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const WD_SHORT_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WD_FULL_EN = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const WD_DATIVE_RU = [
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
  "воскресеньям",
];
const WD_NOM_RU = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];
const WD_ACC_RU = [
  "понедельник",
  "вторник",
  "среду",
  "четверг",
  "пятницу",
  "субботу",
  "воскресенье",
];
const WD_GENDER: Gender[] = ["m", "m", "f", "m", "f", "f", "n"];
const EACH_RU: Record<Gender, string> = {
  m: "Каждый",
  f: "Каждую",
  n: "Каждое",
};
const ORD_ACC_SUFFIX: Record<Gender, string> = { m: "й", f: "ю", n: "е" };
const ORD_NOM_SUFFIX: Record<Gender, string> = { m: "й", f: "я", n: "е" };
const LAST_ACC_RU: Record<Gender, string> = {
  m: "последний",
  f: "последнюю",
  n: "последнее",
};
const LAST_NOM_RU: Record<Gender, string> = {
  m: "последний",
  f: "последняя",
  n: "последнее",
};
const MONTH_SHORT_RU = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];
const MONTH_SHORT_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type Unit = {
  forms: [string, string, string]; // 1 / 2–4 / 5+ после «каждые N»
  each: string; // «Каждый»/«Каждую» — для N, оканчивающегося на 1 (21 день)
  en: string;
};
const UNITS: Record<RecurFreq, Unit> = {
  daily: { forms: ["день", "дня", "дней"], each: "Каждый", en: "day" },
  weekly: { forms: ["неделю", "недели", "недель"], each: "Каждую", en: "week" },
  monthly: {
    forms: ["месяц", "месяца", "месяцев"],
    each: "Каждый",
    en: "month",
  },
  yearly: { forms: ["год", "года", "лет"], each: "Каждый", en: "year" },
};

/** 1st / 2nd / 3rd / 4th, с исключением для 11–13. */
export function ordinalEn(n: number): string {
  const inTeens = n % 100 >= 11 && n % 100 <= 13;
  const suffix = inTeens ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Короткое имя дня недели ISO (1 = пн): «пн» / «Mon». */
export function weekdayShortText(wd: number): RecurText {
  return { ru: WD_SHORT_RU[wd - 1] ?? "", en: WD_SHORT_EN[wd - 1] ?? "" };
}

/** Вариант n-го дня недели в именительном: «3-й понедельник», «последняя пятница». */
export function setposText(setpos: number, wd: number): RecurText {
  const g = WD_GENDER[wd - 1] ?? "m";
  const last = setpos === RECUR_SETPOS_LAST;
  return {
    ru: `${last ? LAST_NOM_RU[g] : `${setpos}-${ORD_NOM_SUFFIX[g]}`} ${WD_NOM_RU[wd - 1]}`,
    en: `${last ? "last" : ordinalEn(setpos)} ${WD_FULL_EN[wd - 1]}`,
  };
}

/** «Каждые 3 месяца» / «Every 3 months» (n ≥ 2). */
function everyN(freq: RecurFreq, n: number): RecurText {
  const u = UNITS[freq];
  const m10 = n % 10, m100 = n % 100;
  const ru = m10 === 1 && m100 !== 11
    ? `${u.each} ${n} ${u.forms[0]}`
    : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
    ? `Каждые ${n} ${u.forms[1]}`
    : `Каждые ${n} ${u.forms[2]}`;
  return { ru, en: `Every ${n} ${u.en}s` };
}

const EVERY_ONE: Record<RecurFreq, RecurText> = {
  daily: { ru: "Каждый день", en: "Every day" },
  weekly: { ru: "Каждую неделю", en: "Every week" },
  monthly: { ru: "Каждый месяц", en: "Every month" },
  yearly: { ru: "Каждый год", en: "Every year" },
};

/**
 * Подпись правила словами. День недели, число и месяц берутся из срока (и якоря числа).
 * null — задача не регулярная. Без срока — честная подпись частоты без дня.
 */
export function recurrenceText(
  rule: RecurRule | null | undefined,
  dueISO: string | null | undefined,
): RecurText | null {
  if (!rule || !isRecurFreq(rule.freq)) return null;
  const freq = rule.freq;
  const n = cleanInterval(rule.interval);
  const head = n === 1 ? EVERY_ONE[freq] : everyN(freq, n);
  const due = dueISO ? parseISO(dueISO) : null;
  const wd = dueISO ? isoWeekday(dueISO) : null;

  if (freq === "daily") return head;

  if (freq === "weekly") {
    const set = cleanWeekdays(rule.weekdays);
    if (n === 1 && !set) {
      return wd
        ? {
          ru: `По ${WD_DATIVE_RU[wd - 1]}`,
          en: `Every ${WD_FULL_EN[wd - 1]}`,
        }
        : head;
    }
    const days = set ?? (wd ? [wd] : null);
    if (!days) return head;
    return {
      ru: `${head.ru}: ${days.map((d) => WD_SHORT_RU[d - 1]).join(", ")}`,
      en: `${head.en} on ${days.map((d) => WD_SHORT_EN[d - 1]).join(", ")}`,
    };
  }

  if (!due || !wd) return head;

  if (freq === "monthly") {
    const setpos = cleanSetpos(rule.setpos);
    if (setpos !== null) {
      const g = WD_GENDER[wd - 1];
      const last = setpos === RECUR_SETPOS_LAST;
      const enPos = last ? "last" : ordinalEn(setpos);
      if (n === 1) {
        const pos = last ? LAST_ACC_RU[g] : `${setpos}-${ORD_ACC_SUFFIX[g]}`;
        return {
          ru: `${EACH_RU[g]} ${pos} ${WD_ACC_RU[wd - 1]} месяца`,
          en: `Every ${enPos} ${WD_FULL_EN[wd - 1]} of the month`,
        };
      }
      const pos = setposText(setpos, wd);
      return { ru: `${head.ru}: ${pos.ru}`, en: `${head.en} on the ${pos.en}` };
    }
    const dom = cleanAnchor(rule.anchorDom, due.d);
    return n === 1
      ? { ru: `Каждый месяц, ${dom}-го`, en: `Monthly on the ${ordinalEn(dom)}` }
      : { ru: `${head.ru}, ${dom}-го`, en: `${head.en} on the ${ordinalEn(dom)}` };
  }

  // yearly
  const dom = cleanAnchor(rule.anchorDom, due.d);
  return {
    ru: `${head.ru}, ${dom} ${MONTH_SHORT_RU[due.m - 1]}`,
    en: `${head.en} on ${MONTH_SHORT_EN[due.m - 1]} ${dom}`,
  };
}
