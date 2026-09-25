// Главная по стенду (docs/decisions/2026-09-24-home-by-stand.md, образец —
// docs/redesign/stand/js/screens-home.js). Чистая логика без React: какие задачи и какие
// числа видит человек, открыв главную. Это читают как факт («просроченного нет»), поэтому
// правило одно и под тестами.

import type { Task } from "@/types";
import { DUE_BUCKETS, dueBucket, type TaskSection } from "@/lib/taskTable";

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

/**
 * «Мои задачи» главной: Просрочено · Сегодня · Дальше (ближайшие 6) · Без срока (4).
 * Закрытые не показываются. Пустые секции не выводятся. Вход не мутируется.
 */
export function groupHome(mine: Task[], now: Date, lang: 0 | 1): TaskSection[] {
  const over: Task[] = [];
  const today: Task[] = [];
  const later: Task[] = [];
  const nodue: Task[] = [];
  for (const t of mine) {
    const b = dueBucket(t, now);
    if (b === "over") over.push(t);
    else if (b === "today") today.push(t);
    else if (b === "later") later.push(t);
    else if (b === "nodue") nodue.push(t);
  }
  const sections: TaskSection[] = [
    { key: "over", label: label("over", lang), tasks: [...over].sort(byDue) },
    { key: "today", label: label("today", lang), tasks: today },
    { key: "later", label: label("later", lang), tasks: [...later].sort(byDue).slice(0, HOME_LATER_LIMIT) },
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
