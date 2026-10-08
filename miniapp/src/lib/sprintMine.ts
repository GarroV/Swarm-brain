// Флажок «Мои задачи» в списке спринта (решение владельца 07.10.2026): включён — задачи
// того, кто смотрит, собираются наверху отдельным блоком, остальные идут ниже. Правило
// «чья строка» — здесь, под тестами.
import type { SprintCycleItem, Task } from "@/types";
import { isAssignedTo } from "@/lib/smartLists";

/**
 * Делит состав на «мои» и «остальные». Своя — та, где смотрящий среди исполнителей ЖИВОЙ
 * задачи (по telegram_id: имена повторяются и меняются). У упоминания удалённой задачи
 * живой нет — оно идёт в остальные.
 */
export function splitMine<T extends Pick<SprintCycleItem, "task_id">>(
  items: readonly T[],
  tasks: readonly Pick<Task, "id" | "assignee_telegram_ids" | "coassignee_telegram_ids">[],
  me: number | null | undefined,
): { mine: T[]; others: T[] } {
  if (me == null) return { mine: [], others: [...items] };
  const own = new Set(
    tasks.filter((t) => isAssignedTo(t, me)).map((t) => t.id),
  );
  const mine: T[] = [];
  const others: T[] = [];
  for (const item of items) {
    (item.task_id && own.has(item.task_id) ? mine : others).push(item);
  }
  return { mine, others };
}
