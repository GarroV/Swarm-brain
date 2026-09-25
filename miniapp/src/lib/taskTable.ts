// Группировка списка задач в новом виде (витрина, экран «Задачи» по стенду,
// docs/redesign/stand/js/screens-tasks.js → groupRows). Чистая логика без React:
// какие задачи попадают в какую секцию — это то, что человек читает как «что горит».

import type { Task, User } from "@/types";
import { isDone } from "@/lib/smartLists";

export type DueBucket = "over" | "today" | "later" | "nodue" | "done";

export const DUE_BUCKETS: ReadonlyArray<{ id: DueBucket; label: [string, string] }> = [
  { id: "over", label: ["Просрочено", "Overdue"] },
  { id: "today", label: ["Сегодня", "Today"] },
  { id: "later", label: ["Дальше", "Later"] },
  { id: "nodue", label: ["Без срока", "No due date"] },
  { id: "done", label: ["Сделано", "Done"] },
];

function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Та же полночь срока, что у isOverdue в smartLists: срок читается в поясе устройства.
function dueMidnight(task: Task): number | null {
  if (!task.due_date) return null;
  const d = new Date(task.due_date);
  return isNaN(d.getTime()) ? null : midnight(d);
}

// Завершённая задача не «просрочена» и не «на сегодня»: срок у неё уже ничего не требует.
export function dueBucket(task: Task, now: Date = new Date()): DueBucket {
  if (isDone(task)) return "done";
  const due = dueMidnight(task);
  if (due == null) return "nodue";
  const today = midnight(now);
  if (due < today) return "over";
  if (due === today) return "today";
  return "later";
}

export type TaskSection = { key: string; label: string; tasks: Task[]; late?: number };

// Секции по сроку в фиксированном порядке; пустые не показываются.
export function groupByDue(tasks: Task[], now: Date, lang: 0 | 1): TaskSection[] {
  const by = new Map<DueBucket, Task[]>();
  for (const t of tasks) {
    const b = dueBucket(t, now);
    by.set(b, [...(by.get(b) ?? []), t]);
  }
  return DUE_BUCKETS.filter((b) => by.has(b.id)).map((b) => ({
    key: b.id,
    label: b.label[lang],
    tasks: by.get(b.id)!,
  }));
}

export const UNASSIGNED = "0";

// «Все сотрудники» — список ПО ЛЮДЯМ (просьба владельца 22.09.2026). Порядок — по числу задач,
// сверху заваленные: список читают ради перекоса нагрузки. «Не назначен» всегда последним.
// Задача с двумя исполнителями — в обеих группах: она и правда работа обоих.
export function groupByPerson(tasks: Task[], users: User[], now: Date, unassignedLabel: string): TaskSection[] {
  const names = new Map(users.map((u) => [String(u.telegram_id), u.name]));
  const by = new Map<string, Task[]>();
  for (const t of tasks) {
    const ids = t.assignee_telegram_ids?.length ? t.assignee_telegram_ids.map(String) : [UNASSIGNED];
    ids.forEach((id, i) => {
      by.set(id, [...(by.get(id) ?? []), t]);
      if (!names.has(id) && t.assignees?.[i]) names.set(id, t.assignees[i]);
    });
  }
  const label = (id: string) => (id === UNASSIGNED ? unassignedLabel : names.get(id) ?? id);
  return [...by.keys()]
    .sort((a, b) => {
      if ((a === UNASSIGNED) !== (b === UNASSIGNED)) return a === UNASSIGNED ? 1 : -1;
      return by.get(b)!.length - by.get(a)!.length || label(a).localeCompare(label(b));
    })
    .map((id) => {
      const list = by.get(id)!;
      return {
        key: id,
        label: label(id),
        tasks: list,
        late: list.filter((t) => dueBucket(t, now) === "over").length,
      };
    });
}
