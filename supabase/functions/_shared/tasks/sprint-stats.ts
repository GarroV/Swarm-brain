// Итоги спринта. Считаются ОДИН РАЗ в момент приёмки и записываются в `sprint_cycles.stats`;
// после этого отчёт неизменен — что бы дальше ни случилось с живыми задачами (переоткрыли,
// переименовали, удалили), цифры принятого спринта не двигаются.
//
// Поэтому расчёт живёт здесь чистой функцией: без обращения к базе, полностью под тестами.
import { isClosedStatus } from "./statuses.ts";

/** Позиция состава спринта в виде, пригодном для счёта: живая до приёмки, замороженная после. */
export interface SprintItemView {
  /** Была ли задача в составе на момент старта спринта. */
  in_plan: boolean;
  status: string;
  assignees: string[];
  project: string | null;
  completed_at: string | null;
}

export interface PersonRow {
  name: string;
  plan: number;
  done: number;
}

export interface ProjectRow {
  /** null — задача без проекта; такие не прячем, иначе сумма строк не сойдётся с итогом. */
  name: string | null;
  total: number;
  done: number;
}

export interface SprintStats {
  plan: number;
  planDone: number;
  planPercent: number;
  extra: number;
  extraDone: number;
  /** Незакрытые на момент приёмки — они уезжают в следующий спринт. */
  carried: number;
  unassigned: number;
  byPerson: PersonRow[];
  byProject: ProjectRow[];
  byDay: { day: string; done: number }[];
}

export function computeSprintStats(items: readonly SprintItemView[]): SprintStats {
  const plan = items.filter((i) => i.in_plan);
  const extra = items.filter((i) => !i.in_plan);
  const done = (list: readonly SprintItemView[]) => list.filter((i) => isClosedStatus(i.status)).length;

  const planDone = done(plan);

  const people = new Map<string, PersonRow>();
  const projects = new Map<string | null, ProjectRow>();
  const days = new Map<string, number>();
  let unassigned = 0;

  for (const it of items) {
    const closed = isClosedStatus(it.status);

    // Задача на двоих попадает в строку каждого — разговор о загрузке ведётся по людям.
    // В общий итог спринта она при этом входит один раз: сумма строк по людям НЕ равна плану.
    if (it.assignees.length === 0) {
      unassigned += 1;
    } else {
      for (const name of it.assignees) {
        const row = people.get(name) ?? { name, plan: 0, done: 0 };
        row.plan += 1;
        if (closed) row.done += 1;
        people.set(name, row);
      }
    }

    const proj = projects.get(it.project) ?? { name: it.project, total: 0, done: 0 };
    proj.total += 1;
    if (closed) proj.done += 1;
    projects.set(it.project, proj);

    // «Когда сделали» — только там, где дата известна: у задач, закрытых до появления
    // completed_at, её нет вовсе, и придумывать день для них нельзя.
    if (closed && it.completed_at) {
      const day = it.completed_at.slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
  }

  return {
    plan: plan.length,
    planDone,
    planPercent: plan.length === 0 ? 0 : Math.round((planDone / plan.length) * 100),
    extra: extra.length,
    extraDone: done(extra),
    carried: items.filter((i) => !isClosedStatus(i.status)).length,
    unassigned,
    byPerson: [...people.values()].sort((a, b) => b.plan - a.plan || b.done - a.done || a.name.localeCompare(b.name)),
    byProject: [...projects.values()].sort((a, b) =>
      b.total - a.total || (a.name ?? "￿").localeCompare(b.name ?? "￿")
    ),
    byDay: [...days.entries()].map(([day, n]) => ({ day, done: n })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}
