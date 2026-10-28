import type { Task } from "@/types";

// Отметка задачи кружком (отзыв коллеги 28.10.2026: «я не сразу поняла, что оно исчезает просто»):
// выполненная строка не пропадает сразу, а ~2 секунды стоит отмеченной (зелёный кружок, галочка,
// зачёркнутое название), потом плавно гаснет. Повторное нажатие в эти секунды снимает отметку.
// Здесь — только чистые правила; таймеры и состояние держит useReminderTasks (и DashTaskRow).

// Сколько строка стоит отмеченной, и сколько длится угасание (CSS-переход в ROW_FADE_CLASS).
export const DONE_LINGER_MS = 2000;
export const DONE_FADE_MS = 300;

// Класс угасающей строки; длительность держать равной DONE_FADE_MS.
export const ROW_FADE_CLASS = "opacity-0 transition-opacity duration-300 motion-reduce:transition-none pointer-events-none";

// «Задерживающиеся» — снимок задачи ДО отметки. Фильтры и группировки считаются по снимку: пока
// строка задерживается, она для них всё ещё открыта и остаётся в своём месте и в своей группе.
export function revertLingering(tasks: Task[], lingering: ReadonlyMap<string, Task>): Task[] {
  if (lingering.size === 0) return tasks;
  return tasks.map((t) => lingering.get(t.id) ?? t);
}

// Обратно: в готовом результате фильтра снимки заменяются текущей (отмеченной) задачей,
// чтобы строка нарисовалась выполненной.
export function restoreLingering(rows: Task[], tasks: Task[], lingering: ReadonlyMap<string, Task>): Task[] {
  if (lingering.size === 0) return rows;
  const current = new Map<string, Task>();
  for (const t of tasks) if (lingering.has(t.id)) current.set(t.id, t);
  return rows.map((r) => current.get(r.id) ?? r);
}
