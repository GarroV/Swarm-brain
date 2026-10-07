// Главная по стенду (docs/decisions/2026-09-24-home-by-stand.md, образец —
// docs/redesign/stand/js/screens-home.js). Чистая логика без React: какие задачи и какие
// числа видит человек, открыв главную. Это читают как факт («просроченного нет»), поэтому
// правило одно и под тестами.

import type { Task } from "@/types";
import { DUE_BUCKETS, dueBucket, type TaskSection } from "@/lib/taskTable";
import { isDone } from "@/lib/smartLists";

/** «Дальше» — только ближайшие: главная показывает, что подходит, а не весь список. */
export const HOME_LATER_LIMIT = 6;
/** «Без срока» — хвост, чтобы не вытеснял то, у чего срок есть. */
export const HOME_NODUE_LIMIT = 4;
/** «Задачи команды» — первые по сроку, остальные по ссылке «все задачи команды». */
export const HOME_TEAM_LIMIT = 5;

const WEEK_MS = 7 * 86_400_000;

const label = (id: string, lang: 0 | 1) => DUE_BUCKETS.find((b) => b.id === id)!.label[lang];

// Без срока — в конец; сравнение по строке ISO совпадает с порядком дат.
const byDue = (a: Task, b: Task) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999"));

/** Календарный день «YYYY-MM-DD» в поясе устройства — так же читается срок (dueBucket). */
const dayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dueDay = (t: Task) => (t.due_date ? dayOf(new Date(t.due_date)) : null);
// remind_date — голая дата без пояса, сравниваем строкой как есть.
const pingDay = (t: Task) => (t.remind_date ? t.remind_date.slice(0, 10) : null);

export type HomeDateReason = { kind: "due" | "ping"; date: string };

/**
 * Чем задача стоит в «Мои задачи» главной: ближайшее из срока и пинга (владелец 05.10.2026 —
 * «ранжирование идет по дате + по пингу. потому что дедлайн может быть хоть через год, а пинги
 * регулярные»). Прошедший пинг не в счёт: он напоминание, а не срок. Отзвонивший сегодня пинг
 * в счёт — `reminded_at` ставится в полночь, и иначе задача пропадала бы в свой же день.
 * null — ни срока, ни пинга впереди.
 */
export function homeDateReason(t: Task, now: Date): HomeDateReason | null {
  const today = dayOf(now);
  const due = dueDay(t);
  const ping = pingDay(t);
  const futurePing = ping && ping >= today ? ping : null;
  if (due && due < today) return { kind: "due", date: due };
  if (futurePing && (!due || futurePing < due)) return { kind: "ping", date: futurePing };
  return due ? { kind: "due", date: due } : null;
}

const byHomeDate = (now: Date) => (a: Task, b: Task) =>
  (homeDateReason(a, now)?.date ?? "9999").localeCompare(homeDateReason(b, now)?.date ?? "9999");

/**
 * «Мои задачи» главной: Просрочено · Сегодня · Дальше (ближайшие 6) · Без срока (4).
 * Секцию решает ближайшее из срока и пинга (homeDateReason), просрочка — только по сроку.
 * Закрытые не показываются. Пустые секции не выводятся. Вход не мутируется.
 */
export function groupHome(mine: Task[], now: Date, lang: 0 | 1): TaskSection[] {
  const over: Task[] = [];
  const today: Task[] = [];
  const later: Task[] = [];
  const nodue: Task[] = [];
  const today_ = dayOf(now);
  for (const t of mine) {
    if (isDone(t)) continue;
    const r = homeDateReason(t, now);
    if (!r) nodue.push(t);
    else if (r.date < today_) over.push(t);
    else if (r.date === today_) today.push(t);
    else later.push(t);
  }
  const sections: TaskSection[] = [
    { key: "over", label: label("over", lang), tasks: [...over].sort(byDue) },
    { key: "today", label: label("today", lang), tasks: today },
    { key: "later", label: label("later", lang), tasks: [...later].sort(byHomeDate(now)).slice(0, HOME_LATER_LIMIT) },
    { key: "nodue", label: label("nodue", lang), tasks: nodue.slice(0, HOME_NODUE_LIMIT) },
  ];
  return sections.filter((s) => s.tasks.length > 0);
}

/** Сколько «моих» задач не попало на главную — для ссылки «+ ещё N». */
export function hiddenCount(mine: Task[], sections: TaskSection[], now: Date): number {
  const active = mine.filter((t) => dueBucket(t, now) !== "done").length;
  const shown = sections.reduce((n, s) => n + s.tasks.length, 0);
  return Math.max(0, active - shown);
}

/** «Задачи команды» главной: незакрытые, первыми — с ближайшим сроком. */
export function homeTeam(team: Task[], now: Date): Task[] {
  return team.filter((t) => dueBucket(t, now) !== "done").sort(byDue);
}
