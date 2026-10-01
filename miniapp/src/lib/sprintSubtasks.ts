// Подзадачи в составе спринта (#478, владелец 01.10.2026: «в спринте я хочу уметь разворачивать
// задачу чтобы видеть подзадачи»). Чистая логика без React — строки одной группы списка.
//
// Правила:
// - строка состава, чей родитель в этой же группе, рисуется только под родителем, и только когда
//   родитель развёрнут (по умолчанию свёрнут, счётчик «X/Y» виден всегда);
// - под развёрнутым родителем идут ВСЕ его подзадачи: те, что в этой группе, — полной строкой
//   состава (с действиями спринта), остальные — лёгкой строкой с пометкой «в спринте» или
//   «не в спринте». Так каждая строка состава рисуется ровно один раз;
// - подзадача в составе, чей родитель не в этой группе, остаётся на верхнем уровне с подписью
//   «из «<родитель>»» — спрятать её значило бы потерять работу из вида.
// Аналитику спринта это не трогает: только отображение.

import type { Task } from "@/types";
import { isDone } from "@/lib/smartLists";
import type { SubtaskProgress } from "@/lib/subtasks";

export type SprintRowOf<I> =
  | {
    kind: "item";
    item: I;
    depth: 0 | 1;
    /** Есть подзадачи — шеврон и «X/Y». */
    kids?: SubtaskProgress & { taskId: string };
    /** Родитель вне группы — подпись «из «…»». */
    parent?: { id: string; title: string };
  }
  | { kind: "task"; task: Task; inSprint: boolean };

export function sprintRows<I>(
  groupItems: I[],
  o: {
    idOf: (i: I) => string | null;
    parentOf: (i: I) => string | null;
    tasks: Task[];
    /** task_id всех строк состава спринта, не только этой группы. */
    sprintTaskIds: Set<string>;
    isOpen: (taskId: string) => boolean;
  },
): SprintRowOf<I>[] {
  const inGroup = new Map<string, I>();
  for (const i of groupItems) {
    const id = o.idOf(i);
    if (id) inGroup.set(id, i);
  }
  const children = new Map<string, Task[]>();
  for (const t of o.tasks) {
    if (t.parent_id) children.set(t.parent_id, [...(children.get(t.parent_id) ?? []), t]);
  }
  const byId = new Map(o.tasks.map((t) => [t.id, t]));
  const underParent = (i: I) => {
    const p = o.parentOf(i);
    return !!p && inGroup.has(p);
  };

  const rows: SprintRowOf<I>[] = [];
  for (const item of groupItems) {
    if (underParent(item)) continue;
    const id = o.idOf(item);
    const kidTasks = (id && children.get(id)) || [];
    // Строки группы с этим родителем, которых нет среди видимых задач (например, приватная чужая).
    const extraKids = id ? groupItems.filter((g) => o.parentOf(g) === id && !kidTasks.some((k) => k.id === o.idOf(g))) : [];
    const total = kidTasks.length + extraKids.length;
    const p = o.parentOf(item);
    const parentTask = p && !inGroup.has(p) ? byId.get(p) : undefined;
    rows.push({
      kind: "item",
      item,
      depth: 0,
      ...(id && total > 0 ? { kids: { taskId: id, done: kidTasks.filter(isDone).length, total } } : {}),
      ...(parentTask ? { parent: { id: parentTask.id, title: parentTask.title } } : {}),
    });
    if (!id || total === 0 || !o.isOpen(id)) continue;
    for (const k of kidTasks) {
      const row = inGroup.get(k.id);
      if (row) rows.push({ kind: "item", item: row, depth: 1 });
      else rows.push({ kind: "task", task: k, inSprint: o.sprintTaskIds.has(k.id) });
    }
    for (const g of extraKids) rows.push({ kind: "item", item: g, depth: 1 });
  }
  return rows;
}
