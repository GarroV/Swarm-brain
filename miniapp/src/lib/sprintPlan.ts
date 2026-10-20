// План пространства спринтов (решение владельца 07.10.2026,
// docs/decisions/2026-10-07-sprint-plan-tree.md): весь большой проект одним деревом —
// группы задач пространства → их задачи → подзадачи, сделанные и несделанные вместе.
// Это источник набора спринта вместо плоского бэклога. Правило «что входит в план и как
// считается» живёт здесь чистой функцией под тестами: экран только рисует.
import type { Project, Task, User } from "@/types";
import { byNumberedName } from "@/lib/initiatives";

/** Закрытые статусы — как в списке спринта: «готово» и «отменена». */
const CLOSED = new Set(["done", "cancelled"]);

export type PlanTask = {
  task: Task;
  /** Задача уже в выбранном спринте — второй раз её не берут. */
  inSprint: boolean;
  closed: boolean;
  kids: PlanTask[];
};

export type PlanGroup = {
  project: Project;
  tasks: PlanTask[];
  /** Закрыто / всего — по ВСЕМ задачам группы, без учёта фильтров экрана. */
  done: number;
  total: number;
};

export type Plan = {
  groups: PlanGroup[];
  done: number;
  total: number;
  /** Сколько задач плана ещё можно взять в спринт: открытые и не в спринте. */
  available: number;
};

/** Значение фильтра «Без исполнителя» — не имя человека, чтобы не спутать с тёзкой. */
export const PLAN_UNASSIGNED = "\u0000unassigned";

export type PlanFilter = {
  query?: string;
  hideDone?: boolean;
  /** Один исполнитель (имя) или PLAN_UNASSIGNED. Нужен `users` — имена по telegram_id. */
  assignee?: string;
  users?: readonly User[];
};

/** Исполнители задачи по именам: подписи из задачи плюс люди по telegram_id. */
export function taskAssignees(
  t: Task,
  users: readonly User[] = [],
): string[] {
  const names = new Set<string>(t.assignees ?? []);
  for (const u of users) {
    if (t.assignee_telegram_ids?.includes(u.telegram_id)) names.add(u.name);
  }
  return [...names];
}

function byAssignee(t: Task, f: PlanFilter): boolean {
  if (!f.assignee) return true;
  const names = taskAssignees(t, f.users);
  return f.assignee === PLAN_UNASSIGNED
    ? names.length === 0
    : names.includes(f.assignee);
}

/** Кто есть в плане пространства: имена исполнителей по алфавиту и есть ли задачи без исполнителя. */
export function planPeople(
  tasks: readonly Task[],
  projects: readonly Project[],
  space: string | null,
  users: readonly User[] = [],
): { names: string[]; hasUnassigned: boolean } {
  const groups = new Set(planProjects(projects, space).map((p) => p.id));
  const names = new Set<string>();
  let hasUnassigned = false;
  for (const t of tasks) {
    if (!t.project_id || !groups.has(t.project_id) || t.status === "draft") {
      continue;
    }
    const who = taskAssignees(t, users);
    if (who.length === 0) hasUnassigned = true;
    for (const n of who) names.add(n);
  }
  return {
    names: [...names].sort((a, b) => a.localeCompare(b)),
    hasUnassigned,
  };
}

/** Группы плана: группы задач этого пространства верхнего уровня, по номеру в названии. */
export function planProjects(
  projects: readonly Project[],
  space: string | null,
): Project[] {
  if (!space) return [];
  return projects
    .filter((p) =>
      p.sprint_group === true && p.sprint_id === space && p.parent_id === null
    )
    .sort((a, b) => byNumberedName(a.name, b.name));
}

// Открытые выше закрытых: план читают ради того, что ещё предстоит. Внутри — по созданию,
// чтобы порядок не прыгал от правок.
function byOpenThenCreated(a: PlanTask, b: PlanTask): number {
  if (a.closed !== b.closed) return a.closed ? 1 : -1;
  return a.task.created_at.localeCompare(b.task.created_at);
}

function matches(t: PlanTask, f: PlanFilter): boolean {
  if (f.hideDone && t.closed) return false;
  if (!byAssignee(t.task, f)) return false;
  const q = f.query?.trim().toLowerCase();
  return !q || t.task.title.toLowerCase().includes(q);
}

// Фильтр сохраняет родителя, если подошла хотя бы одна подзадача: иначе найденная
// подзадача осталась бы без контекста.
function filterTree(list: PlanTask[], f: PlanFilter): PlanTask[] {
  const out: PlanTask[] = [];
  for (const t of list) {
    const kids = filterTree(t.kids, f);
    if (matches(t, f) || kids.length > 0) out.push({ ...t, kids });
  }
  return out;
}

function groupTasks(
  own: readonly Task[],
  inSprint: ReadonlySet<string>,
): PlanTask[] {
  const ids = new Set(own.map((t) => t.id));
  const node = (task: Task): PlanTask => ({
    task,
    inSprint: inSprint.has(task.id),
    closed: CLOSED.has(task.status),
    kids: [],
  });
  const nodes = new Map(own.map((t) => [t.id, node(t)]));
  const roots: PlanTask[] = [];
  for (const t of own) {
    const n = nodes.get(t.id)!;
    // Подзадача под родителем, если родитель в той же группе; иначе — своей строкой.
    const parent = t.parent_id && ids.has(t.parent_id)
      ? nodes.get(t.parent_id)
      : undefined;
    if (parent) parent.kids.push(n);
    else roots.push(n);
  }
  for (const n of nodes.values()) n.kids.sort(byOpenThenCreated);
  return roots.sort(byOpenThenCreated);
}

/**
 * Собирает план пространства. Черновики (`draft`) в план не идут — это ещё не задачи.
 * С поиском группы без совпадений прячутся; без поиска пустые группы видны — в них
 * заводят первую задачу.
 */
export function buildPlan(
  tasks: readonly Task[],
  projects: readonly Project[],
  space: string | null,
  inSprint: ReadonlySet<string>,
  filter: PlanFilter = {},
): Plan {
  const groups = planProjects(projects, space);
  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.project_id || t.status === "draft") continue;
    const list = byProject.get(t.project_id) ?? [];
    list.push(t);
    byProject.set(t.project_id, list);
  }
  const searching = !!filter.query?.trim() || !!filter.assignee;
  let done = 0;
  let total = 0;
  let available = 0;
  const out: PlanGroup[] = [];
  for (const project of groups) {
    // Фильтр по человеку меняет и счётчики («5 из 9» — его задачи); поиск и «скрыть готовые» — нет.
    const own = (byProject.get(project.id) ?? []).filter((t) =>
      byAssignee(t, filter)
    );
    const closed = own.filter((t) => CLOSED.has(t.status)).length;
    done += closed;
    total += own.length;
    available += own.filter((t) =>
      !CLOSED.has(t.status) && !inSprint.has(t.id)
    ).length;
    const shown = filterTree(groupTasks(own, inSprint), filter);
    if (searching && shown.length === 0) continue;
    out.push({ project, tasks: shown, done: closed, total: own.length });
  }
  return { groups: out, done, total, available };
}

/** Можно ли взять задачу плана в спринт: открытая и ещё не в нём. */
export function canTake(t: PlanTask): boolean {
  return !t.closed && !t.inSprint;
}

/** Подпись проекта: у подпроекта — «Группа › Имя», иначе тёзки неотличимы. */
export function projectLabel(p: Project, all: readonly Project[]): string {
  if (!p.parent_id) return p.name;
  const parent = all.find((x) => x.id === p.parent_id);
  return parent ? `${parent.name} › ${p.name}` : p.name;
}
