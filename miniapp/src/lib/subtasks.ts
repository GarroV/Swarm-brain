// Подзадачи (#478): задача → подзадача через tasks.parent_id. Чистая логика без React.
// Вложенность — один уровень (решение 24.09.2026: проект → инициатива → задача → подзадача):
// у подзадачи своих подзадач не бывает, поэтому в родители годится только задача без родителя.

import type { Task } from "@/types";
import { isDone } from "@/lib/smartLists";

export function subtasksOf(all: Task[], parentId: string): Task[] {
  return all.filter((t) => t.parent_id === parentId);
}

// Кого можно привязать подзадачей к `parent`: задача того же проекта, не он сам, без своего
// родителя и без своих подзадач (иначе получилось бы два уровня), и не закрытая.
export function subtaskCandidates(all: Task[], parent: Task): Task[] {
  const hasKids = new Set(all.map((t) => t.parent_id).filter(Boolean));
  return all.filter((t) =>
    t.id !== parent.id &&
    !t.parent_id &&
    !hasKids.has(t.id) &&
    !isDone(t) &&
    (t.project_id ?? null) === (parent.project_id ?? null)
  );
}

export type SubtaskProgress = { done: number; total: number };

export function progressByParent(all: Task[]): Map<string, SubtaskProgress> {
  const out = new Map<string, SubtaskProgress>();
  for (const t of all) {
    if (!t.parent_id) continue;
    const p = out.get(t.parent_id) ?? { done: 0, total: 0 };
    out.set(t.parent_id, { done: p.done + (isDone(t) ? 1 : 0), total: p.total + 1 });
  }
  return out;
}

// Строки списка с подзадачами под родителем. Подзадача, чей родитель в этот срез не попал,
// остаётся на верхнем уровне: спрятать её значило бы потерять работу из вида.
// Обобщённо — для задач списка и для строк состава спринта (у них свой id и свой родитель).
export function nestBy<T>(
  items: T[],
  idOf: (x: T) => string | null,
  parentOf: (x: T) => string | null,
): Array<{ item: T; depth: 0 | 1 }> {
  const ids = new Set(items.map(idOf).filter(Boolean));
  const inside = (x: T) => {
    const p = parentOf(x);
    return !!p && ids.has(p);
  };
  const kids = new Map<string, T[]>();
  for (const x of items) {
    if (inside(x)) kids.set(parentOf(x)!, [...(kids.get(parentOf(x)!) ?? []), x]);
  }
  const rows: Array<{ item: T; depth: 0 | 1 }> = [];
  for (const x of items) {
    if (inside(x)) continue;
    rows.push({ item: x, depth: 0 });
    const id = idOf(x);
    for (const k of (id && kids.get(id)) || []) rows.push({ item: k, depth: 1 });
  }
  return rows;
}

export type NestedRow = { task: Task; depth: 0 | 1 };

export function nestSubtasks(list: Task[]): NestedRow[] {
  return nestBy(list, (t) => t.id, (t) => t.parent_id).map(({ item, depth }) => ({ task: item, depth }));
}
