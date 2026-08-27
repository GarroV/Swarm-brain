// Цикличность задач (регулярные задачи). Чистая арифметика дат, без БД и сети —
// применение при закрытии задачи живёт в `db.ts` → `updateTask`.
//
// Модель (решения владельца 2026-08-27, канон — docs/decisions/2026-08-27-recurring-tasks.md):
// • ОДНА строка задачи катится вперёд (как Todoist/Vikunja), экземпляров на каждое вхождение НЕТ:
//   отметили готовой → срок прыгает на следующее вхождение, статус остаётся открытым;
// • день недели и число месяца НЕ хранятся отдельно — они и есть срок задачи (`due_date`).
//   Исключение — `recur_anchor_dom`: без него задача со сроком 31 января после февральского
//   зажатия залипла бы на 28-м числе навсегда;
// • следующее вхождение считается ОТ ГРАФИКА, а не от даты выполнения: «отчёт по средам»
//   остаётся по средам, сколько бы раз ни опоздали.

export type RecurFreq = "daily" | "weekly" | "monthly";

export const RECUR_FREQS: readonly string[] = ["daily", "weekly", "monthly"];

export function isRecurFreq(v: unknown): v is RecurFreq {
  return typeof v === "string" && RECUR_FREQS.includes(v);
}

// Часовой пояс команды — КАНОНИЧЕСКОЕ место (task-pings импортирует отсюда, своей копии не
// держит). У задачи нет времени, только дата, поэтому «сегодня» нельзя брать по UTC: после
// 22:00 UTC в Белграде уже следующий день, и перекат уехал бы на сутки назад.
export const TASK_TZ = "Europe/Belgrade";

export function todayInTz(now: Date = new Date(), tz: string = TASK_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Дата — календарный день (YYYY-MM-DD), не момент времени. Считаем в UTC: локальная зона
// сдвинула бы день на границе суток, а у задачи нет времени, только дата.
function parseISO(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 следующего месяца = последний день этого
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

// Календарные дни в ISO сравниваются лексикографически — отдельный компаратор не нужен.
const MAX_MONTH_STEPS = 1200; // 100 лет: страховка от бесконечного цикла на битых данных

/**
 * Следующее вхождение графика: первая дата СТРОГО ПОЗЖЕ max(срок, сегодня).
 *
 * Такое правило разом закрывает три случая: выполнили в срок → следующий цикл;
 * выполнили с опозданием → ближайшее будущее вхождение того же графика (график не уползает);
 * выполнили досрочно → цикл не сбивается и не выдаёт ту же дату повторно.
 *
 * Возвращает null, если задача не регулярная, частота неизвестна или срока нет
 * (считать не от чего) — вызывающий закрывает задачу как обычную.
 */
export function nextOccurrence(
  freq: string | null | undefined,
  anchorDom: number | null | undefined,
  dueISO: string | null | undefined,
  todayISO: string,
): string | null {
  if (!isRecurFreq(freq)) return null;
  if (!dueISO) return null;
  const due = parseISO(dueISO);
  if (!due || !parseISO(todayISO)) return null;

  // Пол отсчёта: просроченную задачу двигаем от сегодня, досрочную — от срока.
  const floor = dueISO > todayISO ? dueISO : todayISO;

  if (freq === "daily") return addDays(floor, 1);

  if (freq === "weekly") {
    // Тот же день недели, что у срока: шагаем неделями от срока, перескакивая прошедшее.
    const weeks = Math.floor(diffDays(dueISO, floor) / 7) + 1;
    return addDays(dueISO, weeks * 7);
  }

  // monthly: то же число месяца. anchor помнит исходное число (31), чтобы после зажатия
  // по короткому месяцу вернуться к нему, а не остаться на 28-м.
  const anchor = anchorDom && anchorDom >= 1 && anchorDom <= 31 ? anchorDom : due.d;
  let y = due.y, m = due.m;
  for (let i = 0; i < MAX_MONTH_STEPS; i++) {
    const cand = fmt(y, m, Math.min(anchor, daysInMonth(y, m)));
    if (cand > floor) return cand;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return null;
}

// ── Применение при закрытии ──────────────────────────────────────────────────

export interface RecurRow {
  status: string;
  recur_freq: string | null;
  recur_anchor_dom: number | null;
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
export function buildRecurPatch(row: RecurRow, todayISO: string): RecurPatch | null {
  const next = nextOccurrence(row.recur_freq, row.recur_anchor_dom, row.due_date, todayISO);
  if (!next || !row.due_date) return null;

  const delta = diffDays(row.due_date, next);
  // Новый цикл начинается с «Открыто»: иначе задача, закрытая из «В работе», навсегда
  // осталась бы в работе.
  const patch: RecurPatch = { status: "open", due_date: next, reminded_at: null };
  if (row.start_date) patch.start_date = addDays(row.start_date, delta);
  if (row.remind_date) patch.remind_date = addDays(row.remind_date, delta);
  return patch;
}

// ── приём из запроса ─────────────────────────────────────────────────────────

export type ResolvedRecurrence =
  | { ok: true; recur_freq: RecurFreq | null; recur_anchor_dom: number | null }
  | { ok: false; error: string };

/**
 * Проверяет частоту из запроса и выводит anchor из срока. Один вход для веба, бота и MCP —
 * чтобы «число месяца» не выводили тремя разными способами (или не забыли вывести вовсе).
 *
 * `null`/`undefined` — снятие цикличности: гасим и частоту, и anchor, иначе у обычной задачи
 * остался бы висеть якорь от прошлой регулярности.
 */
export function resolveRecurrence(
  freq: unknown,
  dueISO: string | null | undefined,
): ResolvedRecurrence {
  if (freq === null || freq === undefined) return { ok: true, recur_freq: null, recur_anchor_dom: null };
  if (!isRecurFreq(freq)) return { ok: false, error: "recur_freq: ожидается daily, weekly или monthly" };

  const due = dueISO ? parseISO(dueISO) : null;
  // День недели и число берутся из срока — без срока цикличность бессмысленна.
  if (!due) return { ok: false, error: "цикличность требует срока (due_date)" };

  return { ok: true, recur_freq: freq, recur_anchor_dom: freq === "monthly" ? due.d : null };
}

export type RecurrencePatch =
  | { ok: true; recur_freq: RecurFreq | null; recur_anchor_dom?: number | null }
  | { ok: false; error: string };

/**
 * Что писать в задачу по полю `recur_freq` из запроса — с ГЛАВНОЙ оговоркой: якорь
 * пересчитывается только когда человек тронул срок или частоту.
 *
 * Иначе любая правка регулярной задачи сбрасывала бы график: TaskModal шлёт `recur_freq` и
 * `due_date` при каждом автосейве, поэтому у задачи «31-го числа», стоящей после зажатия на
 * 28 февраля, правка одного названия молча увела бы её с 31-го числа на 28-е — навсегда.
 * Автоматический перекат срок меняет мимо этого пути (updateTask), якорь там не трогается.
 *
 * Отсутствие ключа `recur_anchor_dom` в ответе значит «не трогать сохранённый».
 */
export function recurrencePatchFor(
  bodyFreq: unknown,
  effDueISO: string | null | undefined,
  stored: { recur_freq: string | null; recur_anchor_dom: number | null; due_date: string | null },
): RecurrencePatch {
  const resolved = resolveRecurrence(bodyFreq, effDueISO);
  if (!resolved.ok) return resolved;

  const freqChanged = resolved.recur_freq !== stored.recur_freq;
  const dueChanged = (effDueISO ?? null) !== stored.due_date;
  const anchorMissing = resolved.recur_freq === "monthly" && stored.recur_anchor_dom == null;

  if (freqChanged || dueChanged || anchorMissing) {
    return { ok: true, recur_freq: resolved.recur_freq, recur_anchor_dom: resolved.recur_anchor_dom };
  }
  return { ok: true, recur_freq: resolved.recur_freq };
}

// Короткая подпись частоты для Telegram. НАМЕРЕННО без дня недели («раз в неделю», а не
// «по средам»): таблица русских падежей живёт в вебе (miniapp/src/lib/recurrenceLabels.ts),
// и вторая копия здесь неизбежно разъехалась бы — а точный день и так виден в строке срока
// той же карточки. null — задача не регулярная.
const FREQ_LABEL_RU: Record<RecurFreq, string> = {
  daily: "каждый день",
  weekly: "раз в неделю",
  monthly: "раз в месяц",
};

export function recurFreqLabelRu(freq: string | null | undefined): string | null {
  return isRecurFreq(freq) ? FREQ_LABEL_RU[freq] : null;
}
