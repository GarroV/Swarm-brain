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
// Первая — «Актуальное» (владелец 27.10.2026: «не сегодня, а актуальное. В актуальном у нас
// будет просрочка, задачи на сегодня, и задачи на завтрашний день»): просроченные сверху, потом
// сегодня, завтра и задачи с ПИНГОМ на сегодня или завтра, даже если срок дальше или его нет
// («задачи с пингом тоже отображались в ближайших задачах» — пинг стоял на сегодня, а задача
// лежала в «Дальше»). До 27.10 секция звалась «Задачи сегодня» (13.10.2026). `late` — сколько
// в ней просроченных. Главная («Мои задачи», homeTasks.ts) держит своё деление и этим не задета.
const CURRENT_LABEL: [string, string] = ["Актуальное", "Current"];
const DAY_MS = 86_400_000;

// Пинг — дата без времени («2026-10-27»): читаем её как локальную дату, а не полночь UTC, иначе
// западнее Гринвича пинг съезжал бы на вчера.
function remindMidnight(task: Task): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(task.remind_date ?? "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
}

/** Место в «Актуальном»: 0 — просрочено, 1 — сегодня, 2 — завтра, 3 — только пинг; null — не там. */
export function currentRank(task: Task, now: Date = new Date()): number | null {
  if (isDone(task)) return null;
  const today = midnight(now);
  const tomorrow = today + DAY_MS;
  const due = dueMidnight(task);
  if (due != null && due < today) return 0;
  if (due === today) return 1;
  if (due != null && due <= tomorrow) return 2;
  const ping = remindMidnight(task);
  if (ping != null && ping >= today && ping <= tomorrow) return 3;
  return null;
}

export function groupByDue(tasks: Task[], now: Date, lang: 0 | 1): TaskSection[] {
  const current: Array<{ t: Task; r: number }> = [];
  const by = new Map<DueBucket, Task[]>();
  for (const t of tasks) {
    const r = currentRank(t, now);
    if (r != null) { current.push({ t, r }); continue; }
    const b = dueBucket(t, now);
    by.set(b, [...(by.get(b) ?? []), t]);
  }
  // Сортировка устойчивая: внутри одного места порядок списка сохраняется.
  const ordered = [...current].sort((a, b) => a.r - b.r);
  const sections: TaskSection[] = ordered.length
    ? [{
        key: "today",
        label: CURRENT_LABEL[lang],
        tasks: ordered.map((x) => x.t),
        late: ordered.filter((x) => x.r === 0).length,
      }]
    : [];
  return [
    ...sections,
    ...DUE_BUCKETS.filter((b) => b.id !== "over" && b.id !== "today" && by.has(b.id)).map((b) => ({
      key: b.id,
      label: b.label[lang],
      tasks: by.get(b.id)!,
    })),
  ];
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
