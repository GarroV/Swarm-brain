// Цикличность задач (регулярные задачи). Чистая арифметика дат, без БД и сети —
// применение при закрытии задачи живёт в `db.ts` → `updateTask`.
//
// Модель (решения владельца 2026-08-27, канон — docs/decisions/2026-08-27-recurring-tasks.md):
// • ОДНА строка задачи катится вперёд (как Todoist/Vikunja), экземпляров на каждое вхождение НЕТ:
//   отметили готовой → срок прыгает на следующее вхождение, статус остаётся открытым;
// • день недели и число месяца берутся из срока задачи (`due_date`). Исключения:
//   `recur_anchor_dom` (без него задача со сроком 31 января после февральского зажатия залипла
//   бы на 28-м числе навсегда) и правило #823 — `recur_interval` (каждые N),
//   `recur_weekdays` (несколько дней недели), `recur_setpos` (n-й/последний день недели месяца);
// • следующее вхождение считается ОТ ГРАФИКА, а не от даты выполнения: «отчёт по средам»
//   остаётся по средам, сколько бы раз ни опоздали.

import {
  isRecurFreq,
  nextOccurrenceOf,
  type RecurFreq,
  recurrenceText,
  validateRecurFields,
} from "./recurrence-rule.ts";

// Правило (словарь RRULE колонками), арифметика и подписи — в recurrence-rule.ts (#823).
export { isRecurFreq, RECUR_FREQS, type RecurFreq } from "./recurrence-rule.ts";

// Часовой пояс команды — КАНОНИЧЕСКОЕ место (task-pings импортирует отсюда, своей копии не
// держит). У задачи нет времени, только дата, поэтому «сегодня» нельзя брать по UTC: после
// 22:00 UTC в Белграде уже следующий день, и перекат уехал бы на сутки назад.
export const TASK_TZ = "Europe/Belgrade";

export function todayInTz(
  now: Date = new Date(),
  tz: string = TASK_TZ,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayOfMonth(iso: string): number | null {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(iso);
  return m ? Number(m[1]) : null;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function diffDays(fromISO: string, toISO: string): number {
  return Math.round(
    (Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Новые поля правила (#823) в том виде, в каком они лежат в задаче. */
export interface RecurExtras {
  interval?: number | null;
  weekdays?: readonly number[] | null;
  setpos?: number | null;
}

/**
 * Следующее вхождение графика: первая дата СТРОГО ПОЗЖЕ max(срок, сегодня).
 *
 * Такое правило разом закрывает три случая: выполнили в срок → следующий цикл;
 * выполнили с опозданием → ближайшее будущее вхождение того же графика (график не уползает);
 * выполнили досрочно → цикл не сбивается и не выдаёт ту же дату повторно.
 *
 * Возвращает null, если задача не регулярная, частота неизвестна или срока нет
 * (считать не от чего) — вызывающий закрывает задачу как обычная.
 */
export function nextOccurrence(
  freq: string | null | undefined,
  anchorDom: number | null | undefined,
  dueISO: string | null | undefined,
  todayISO: string,
  extras: RecurExtras = {},
): string | null {
  if (!isRecurFreq(freq)) return null;
  return nextOccurrenceOf(
    { freq, anchorDom, ...extras },
    dueISO,
    todayISO,
  );
}

// ── Применение при закрытии ──────────────────────────────────────────────────

export interface RecurRow {
  status: string;
  recur_freq: string | null;
  recur_anchor_dom: number | null;
  recur_interval: number | null;
  recur_weekdays: number[] | null;
  recur_setpos: number | null;
  due_date: string | null;
  start_date: string | null;
  remind_date: string | null;
}

export interface RecurPatch {
  status: "open";
  due_date: string;
  reminded_at: null;
  start_date?: string;
  remind_date?: string;
}

/**
 * Патч, которым регулярная задача перекатывается на следующий цикл вместо закрытия.
 * null — задача не регулярная (или считать не от чего): закрывается как обычная.
 *
 * `start_date` и `remind_date` сдвигаются на ТУ ЖЕ дельту, что и срок: иначе пинг остался бы
 * в прошлом и молча не сработал, а начало оказалось бы позже срока (validateTaskDates отбьёт
 * следующую же правку задачи). `reminded_at` сбрасывается — пинг взводится заново, тем же
 * правилом, что при ручном переносе напоминания.
 */
export function buildRecurPatch(
  row: RecurRow,
  todayISO: string,
): RecurPatch | null {
  const next = nextOccurrence(
    row.recur_freq,
    row.recur_anchor_dom,
    row.due_date,
    todayISO,
    {
      interval: row.recur_interval,
      weekdays: row.recur_weekdays,
      setpos: row.recur_setpos,
    },
  );
  if (!next || !row.due_date) return null;

  const delta = diffDays(row.due_date, next);
  // Новый цикл начинается с «Открыто»: иначе задача, закрытая из «В работе», навсегда
  // осталась бы в работе.
  const patch: RecurPatch = {
    status: "open",
    due_date: next,
    reminded_at: null,
  };
  if (row.start_date) patch.start_date = addDays(row.start_date, delta);
  if (row.remind_date) patch.remind_date = addDays(row.remind_date, delta);
  return patch;
}

// ── приём из запроса ─────────────────────────────────────────────────────────

/** Новые поля правила из тела запроса (веб/MCP) — как пришли, до проверки. */
export type RecurInputExtras = {
  recur_interval?: unknown;
  recur_weekdays?: unknown;
  recur_setpos?: unknown;
};

/** Ключи тела запроса, которые трогают правило повторяемости. */
export const RECUR_BODY_KEYS = [
  "recur_freq",
  "recur_interval",
  "recur_weekdays",
  "recur_setpos",
] as const;

/** Вынуть из тела запроса только присланные поля правила (отсутствие ключа ≠ null). */
export function pickRecurExtras(body: Record<string, unknown>): RecurInputExtras {
  const out: RecurInputExtras = {};
  if ("recur_interval" in body) out.recur_interval = body.recur_interval;
  if ("recur_weekdays" in body) out.recur_weekdays = body.recur_weekdays;
  if ("recur_setpos" in body) out.recur_setpos = body.recur_setpos;
  return out;
}

type RuleColumns = {
  recur_interval: number;
  recur_weekdays: number[] | null;
  recur_setpos: number | null;
};

const RULE_DEFAULTS: RuleColumns = {
  recur_interval: 1,
  recur_weekdays: null,
  recur_setpos: null,
};

export type ResolvedRecurrence =
  | ({
    ok: true;
    recur_freq: RecurFreq | null;
    recur_anchor_dom: number | null;
  } & RuleColumns)
  | { ok: false; error: string };

/** Якорь числа: monthly по числу и yearly помнят исходное число срока. */
function anchorFor(freq: RecurFreq, dueISO: string): number | null {
  return freq === "monthly" || freq === "yearly" ? dayOfMonth(dueISO) : null;
}

function checkFields(
  freq: RecurFreq,
  extras: RecurInputExtras,
): ({ ok: true } & RuleColumns) | { ok: false; error: string } {
  const v = validateRecurFields(freq, {
    interval: extras.recur_interval,
    weekdays: extras.recur_weekdays,
    setpos: extras.recur_setpos,
  });
  if (!v.ok) return v;
  return {
    ok: true,
    recur_interval: v.interval,
    recur_weekdays: v.weekdays,
    recur_setpos: v.setpos,
  };
}

/**
 * Проверяет правило из запроса и выводит якорь из срока. Один вход для веба, бота и MCP —
 * чтобы правило не проверяли тремя разными способами (или не проверили вовсе).
 *
 * `null`/`undefined` — снятие цикличности: гасим частоту, якорь И новые поля правила, иначе у
 * обычной задачи остался бы висеть хвост от прошлой регулярности.
 */
export function resolveRecurrence(
  freq: unknown,
  dueISO: string | null | undefined,
  extras: RecurInputExtras = {},
): ResolvedRecurrence {
  if (freq === null || freq === undefined) {
    return {
      ok: true,
      recur_freq: null,
      recur_anchor_dom: null,
      ...RULE_DEFAULTS,
    };
  }
  if (!isRecurFreq(freq)) {
    return {
      ok: false,
      error: "recur_freq: ожидается daily, weekly, monthly или yearly",
    };
  }

  // День недели и число берутся из срока — без срока цикличность бессмысленна.
  if (!dueISO || dayOfMonth(dueISO) === null) {
    return { ok: false, error: "цикличность требует срока (due_date)" };
  }

  const fields = checkFields(freq, extras);
  if (!fields.ok) return fields;
  return {
    ok: true,
    recur_freq: freq,
    recur_anchor_dom: anchorFor(freq, dueISO),
    recur_interval: fields.recur_interval,
    recur_weekdays: fields.recur_weekdays,
    recur_setpos: fields.recur_setpos,
  };
}

export type RecurrencePatch =
  | ({
    ok: true;
    recur_freq: RecurFreq | null;
    recur_anchor_dom?: number | null;
  } & RuleColumns)
  | { ok: false; error: string };

type StoredRecurrence = {
  recur_freq: string | null;
  recur_anchor_dom: number | null;
  recur_interval?: number | null;
  recur_weekdays?: number[] | null;
  recur_setpos?: number | null;
  due_date: string | null;
};

/**
 * Что писать в задачу по полям правила из запроса — с ГЛАВНОЙ оговоркой: якорь
 * пересчитывается только когда человек тронул срок или частоту.
 *
 * Иначе любая правка регулярной задачи сбрасывала бы график: TaskModal шлёт `recur_freq` и
 * `due_date` при каждом автосейве, поэтому у задачи «31-го числа», стоящей после зажатия на
 * 28 февраля, правка одного названия молча увела бы её с 31-го числа на 28-е — навсегда.
 * Автоматический перекат срок меняет мимо этого пути (updateTask), якорь там не трогается.
 *
 * `bodyFreq === undefined` — частоту не прислали: берётся сохранённая. Новое поле правила,
 * которого нет в запросе, остаётся сохранённым, пока частота та же; сменили частоту — поле
 * берёт значение по умолчанию (дни недели от weekly не переживают переход на monthly).
 *
 * Отсутствие ключа `recur_anchor_dom` в ответе значит «не трогать сохранённый».
 */
export function recurrencePatchFor(
  bodyFreq: unknown,
  effDueISO: string | null | undefined,
  stored: StoredRecurrence,
  extras: RecurInputExtras = {},
): RecurrencePatch {
  const freqSent = bodyFreq !== undefined;
  const freq = freqSent ? bodyFreq : stored.recur_freq;
  if (freq === null && !freqSent) {
    const sentSomething = Object.values(extras).some((v) => v !== null && v !== undefined);
    if (sentSomething) {
      return {
        ok: false,
        error: "правило повтора без частоты: сначала задай recur_freq",
      };
    }
  }

  const sameFreq = freq === stored.recur_freq;
  const merged: RecurInputExtras = {
    recur_interval: "recur_interval" in extras ? extras.recur_interval : sameFreq ? stored.recur_interval : null,
    recur_weekdays: "recur_weekdays" in extras ? extras.recur_weekdays : sameFreq ? stored.recur_weekdays : null,
    recur_setpos: "recur_setpos" in extras ? extras.recur_setpos : sameFreq ? stored.recur_setpos : null,
  };

  const resolved = resolveRecurrence(freq, effDueISO, merged);
  if (!resolved.ok) return resolved;

  const rule: RuleColumns = {
    recur_interval: resolved.recur_interval,
    recur_weekdays: resolved.recur_weekdays,
    recur_setpos: resolved.recur_setpos,
  };
  const freqChanged = resolved.recur_freq !== stored.recur_freq;
  const dueChanged = (effDueISO ?? null) !== stored.due_date;
  const anchorMissing = resolved.recur_anchor_dom !== null &&
    stored.recur_anchor_dom == null;

  if (freqChanged || dueChanged || anchorMissing) {
    return {
      ok: true,
      recur_freq: resolved.recur_freq,
      recur_anchor_dom: resolved.recur_anchor_dom,
      ...rule,
    };
  }
  return { ok: true, recur_freq: resolved.recur_freq, ...rule };
}

// ── подпись для Telegram ─────────────────────────────────────────────────────

/**
 * Подпись правила по-русски для бота — тем же модулем, что и веб (recurrence-rule.ts, копия в
 * miniapp/src/lib/recurrenceRule.ts), со строчной буквы: она стоит в строке после срока.
 * null — задача не регулярная.
 */
export function recurrenceLabelRu(task: {
  recur_freq: string | null;
  recur_anchor_dom?: number | null;
  recur_interval?: number | null;
  recur_weekdays?: number[] | null;
  recur_setpos?: number | null;
  due_date: string | null;
}): string | null {
  if (!isRecurFreq(task.recur_freq)) return null;
  const text = recurrenceText({
    freq: task.recur_freq,
    interval: task.recur_interval,
    weekdays: task.recur_weekdays,
    setpos: task.recur_setpos,
    anchorDom: task.recur_anchor_dom,
  }, task.due_date);
  if (!text) return null;
  return text.ru.charAt(0).toLowerCase() + text.ru.slice(1);
}
