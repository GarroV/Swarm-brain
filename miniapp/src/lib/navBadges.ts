// Счётчики на пунктах бокового меню (issue #903). Чистая логика без React: считает число для
// красного кружка, рисует его RoyRail (десктоп) и RoyTabBar (мобайл).
import type { Task } from "@/types";
import { isOverdue, matchesLens, type Viewer } from "@/lib/smartLists";

/** Мои открытые просроченные задачи. «Сегодня» не считается: isOverdue — строго раньше сегодняшней полуночи. */
export function countMyOverdue(
  tasks: Task[],
  me: Viewer | null,
  now: Date = new Date(),
): number {
  if (!me) return 0;
  return tasks.filter((t) => matchesLens(t, "mine", me) && isOverdue(t, now))
    .length;
}

/** Текст кружка; null — кружка нет (ноль и мусор не рисуем). */
export function badgeLabel(count: number | undefined, max = 99): string | null {
  if (!count || count <= 0 || !Number.isFinite(count)) return null;
  return count > max ? `${max}+` : String(Math.floor(count));
}
