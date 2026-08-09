// Смарт-списки задач в стиле macOS Reminders (Direction C из design_handoff_roy).
// Чистая логика без React: фильтрация, счётчики и группировка по рынкам.
// Дизайн-решения и семантика — docs/superpowers/specs/2026-06-18-tasks-reminders-list-design.md

import type { Task, Me } from "@/types";
import type { RoyIconName } from "@/components/roy/icons";
import { countryCode } from "@/lib/countries";

export type SmartListId = "today" | "upcoming" | "all" | "done";
// Линза = ось «как смотреть»: «mine» — назначенные на меня; «team» — ОБЩИЕ (не приватные, без
// конкретного исполнителя); «all» — все; ИЛИ группировкой (market — по рынку, staff — по
// исполнителю, все владельцы, сгруппировано). «staff» — админский вид «все сотрудники».
export type Lens = "mine" | "team" | "all" | "market" | "staff";

export type SmartListDef = { id: SmartListId; label: string; icon: RoyIconName };

// Единый источник правды для порядка/подписей/иконок смарт-списков (время/статус).
// «По рынкам» — НЕ смарт-список, а линза (см. Lens), накладывается на любой из этих списков.
export const SMART_LISTS: SmartListDef[] = [
  { id: "today", label: "Сегодня", icon: "clock" },
  { id: "upcoming", label: "Ближайшие", icon: "cal" },
  { id: "all", label: "Все", icon: "task" },
  { id: "done", label: "Готовые", icon: "check" },
];

export const HIGH_PRIORITY = "high";
const PRI_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

// Поддерживаем оба написания статуса в данных: "progress" и "in_progress".
export function normStatus(status: string): string {
  return status === "progress" ? "in_progress" : status;
}
export function isDone(task: Task): boolean {
  return normStatus(task.status) === "done";
}

// Локальная полночь переданной даты (день без времени), в часовом поясе устройства.
function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
// Полночь срока задачи. null — если срока нет или дата не парсится.
function dueMidnight(task: Task): number | null {
  if (!task.due_date) return null;
  const d = new Date(task.due_date);
  return isNaN(d.getTime()) ? null : midnight(d);
}

export function isOverdue(task: Task, now: Date = new Date()): boolean {
  const due = dueMidnight(task);
  return due != null && !isDone(task) && due < midnight(now);
}

function matchesLens(task: Task, lens: Lens, me: Me | null): boolean {
  // «Все», «По рынкам» и «Все сотрудники» не фильтруют по владельцу (группируют, не отбирают).
  if (lens === "all" || lens === "market" || lens === "staff") return true;
  // «Команда» = ОБЩИЕ задачи: не приватные И без конкретного исполнителя (формулировка владельца —
  // «командная задача = общая, у которой нет определённого юзера»). Приватные и назначенные на
  // кого-либо (в т.ч. на меня) сюда НЕ попадают — назначенные живут в «Мои»/«Все». Общую задачу
  // создаёшь, выбрав в исполнителе «Общие» (без конкретного человека).
  if (lens === "team") return !task.is_private && (task.assignee_telegram_ids?.length ?? 0) === 0;
  if (!me) return false;
  return task.assignee_telegram_ids?.includes(me.telegram_id) ?? false;
}

// Сравнение по сроку: сначала ближайший, задачи без срока — в конец.
function byDueAsc(a: Task, b: Task): number {
  const da = dueMidnight(a);
  const db = dueMidnight(b);
  if (da == null && db == null) return 0;
  if (da == null) return 1;
  if (db == null) return -1;
  return da - db;
}
function byPriorityDesc(a: Task, b: Task): number {
  return (PRI_RANK[b.priority ?? ""] ?? 0) - (PRI_RANK[a.priority ?? ""] ?? 0);
}
function byCreatedDesc(a: Task, b: Task): number {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}
function byUpdatedDesc(a: Task, b: Task): number {
  const ua = a.updated_at ?? a.created_at ?? "";
  const ub = b.updated_at ?? b.created_at ?? "";
  return ub.localeCompare(ua);
}
// Композиция компараторов: первый ненулевой результат побеждает.
function chain(...cmps: Array<(a: Task, b: Task) => number>) {
  return (a: Task, b: Task): number => {
    for (const cmp of cmps) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

// Базовый предикат «принадлежит списку» (без линзы и сортировки).
function inList(task: Task, listId: SmartListId, now: Date): boolean {
  if (listId === "done") return isDone(task);
  if (isDone(task)) return false; // все остальные списки — только незавершённое
  const today = midnight(now);
  const due = dueMidnight(task);
  switch (listId) {
    case "today":
      return due != null && due <= today;
    case "upcoming":
      return due != null && due > today;
    case "all":
      return true;
  }
}

function sorterFor(listId: SmartListId): (a: Task, b: Task) => number {
  if (listId === "done") return byUpdatedDesc;
  return chain(byDueAsc, byPriorityDesc, byCreatedDesc); // today / upcoming / all
}

// Отфильтрованный и отсортированный список задач для смарт-списка под линзой.
export function filterTasks(tasks: Task[], listId: SmartListId, lens: Lens, me: Me | null, now: Date = new Date()): Task[] {
  return tasks
    .filter((t) => matchesLens(t, lens, me) && inList(t, listId, now))
    .sort(sorterFor(listId));
}

// Счётчики для всех списков (для рельса/чипов).
export function countLists(tasks: Task[], lens: Lens, me: Me | null, now: Date = new Date()): Record<SmartListId, number> {
  const counts = {} as Record<SmartListId, number>;
  for (const def of SMART_LISTS) {
    counts[def.id] = tasks.filter((t) => matchesLens(t, lens, me) && inList(t, def.id, now)).length;
  }
  return counts;
}

export type MarketGroup = { country: string | null; label: string; tasks: Task[] };

// Группировка задач АКТИВНОГО смарт-списка по рынку (страна) — все владельцы (линза market).
// Без страны → «Без рынка», в конец. Группы по убыванию размера, затем по коду рынка.
export function groupByMarket(tasks: Task[], listId: SmartListId, me: Me | null, now: Date = new Date()): MarketGroup[] {
  const inScope = filterTasks(tasks, listId, "all", me, now);
  const map = new Map<string | null, Task[]>();
  for (const t of inScope) {
    // Нормализуем страну к ISO-коду (countryCode): иначе «SI» и «Словения» (или «RS»/«Сербия»)
    // попадают в РАЗНЫЕ группы — один рынок задваивается. Код объединяет любые формы записи.
    const key = t.country && t.country !== "—" ? countryCode(t.country) : null;
    const bucket = map.get(key);
    if (bucket) bucket.push(t);
    else map.set(key, [t]);
  }
  return [...map.entries()]
    .map(([country, list]) => ({ country, label: country ?? "Без рынка", tasks: list }))
    .sort((a, b) => {
      if (a.country === null) return 1;
      if (b.country === null) return -1;
      if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
      return a.label.localeCompare(b.label);
    });
}

export type StaffGroup = { name: string; label: string; tasks: Task[] };

// Группировка задач АКТИВНОГО смарт-списка по ИСПОЛНИТЕЛЮ — все владельцы (админский вид «все сотрудники»).
// Задача с несколькими исполнителями попадает в секцию каждого (полная картина «у кого что»).
// Без исполнителя → «Без исполнителя», в конец. Группы по убыванию размера, затем по имени.
export function groupByAssignee(tasks: Task[], listId: SmartListId, me: Me | null, now: Date = new Date()): StaffGroup[] {
  const inScope = filterTasks(tasks, listId, "all", me, now);
  const NONE = " none";
  const map = new Map<string, Task[]>();
  for (const t of inScope) {
    const names = (t.assignees ?? []).filter(Boolean);
    const keys = names.length ? names : [NONE];
    for (const k of keys) {
      const bucket = map.get(k);
      if (bucket) bucket.push(t);
      else map.set(k, [t]);
    }
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, label: name === NONE ? "Без исполнителя" : name, tasks: list }))
    .sort((a, b) => {
      if (a.name === NONE) return 1;
      if (b.name === NONE) return -1;
      if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
      return a.label.localeCompare(b.label);
    });
}

// ── Персональные смарт-метки (личные списки) ────────────────────────────────
// Список метки авто-собирает незавершённые задачи с этой меткой. Сортировка — как today/upcoming/all.
export function filterByLabel(tasks: Task[], labelId: string): Task[] {
  return tasks
    .filter((t) => !isDone(t) && (t.label_ids?.includes(labelId) ?? false))
    .sort(chain(byDueAsc, byPriorityDesc, byCreatedDesc));
}

export function countByLabel(tasks: Task[], labelId: string): number {
  return tasks.filter((t) => !isDone(t) && (t.label_ids?.includes(labelId) ?? false)).length;
}
