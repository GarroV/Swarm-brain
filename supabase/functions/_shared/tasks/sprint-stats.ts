// Итоги спринта. Считаются ОДИН РАЗ в момент приёмки и записываются в `sprint_cycles.stats`;
// после этого отчёт неизменен — что бы дальше ни случилось с живыми задачами (переоткрыли,
// переименовали, удалили), цифры принятого спринта не двигаются.
//
// Поэтому расчёт живёт здесь чистой функцией: без обращения к базе, полностью под тестами.
import { isClosedStatus } from "./statuses.ts";
import { type CarryInput, planCarry } from "./sprint-carry.ts";

/** Позиция состава спринта в виде, пригодном для счёта: живая до приёмки, замороженная после. */
export interface SprintItemView {
  /** Была ли задача в составе на момент старта спринта. */
  in_plan: boolean;
  status: string;
  assignees: string[];
  project: string | null;
  completed_at: string | null;
  /** Отметка сверки: ok | risk | problem. Нет отметки — человек промолчал. */
  check_status?: string | null;
  /** Человек сам пометил «к переносу» — перенос считается ручным, а не автоматическим. */
  to_carry?: boolean;
  /** Задача удалена: строка осталась упоминанием и в счёт не идёт. */
  removed_at?: string | null;
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
  /** Из них помечены человеком «к переносу» (с причиной). */
  carried_manual: number;
  /** Из них уехали сами, потому что спринт кончился, а задача нет. */
  carried_auto: number;
  /**
   * Отменённые. Решение владельца 18.09.2026: отдельной цифрой, вне процента — не входят ни в
   * «сделано», ни в знаменатель. Иначе отмена задачи улучшает отчёт.
   */
  cancelled: number;
  /** Упоминания удалённых задач: в составе видны, в счёте не участвуют. */
  removed: number;
  check_ok: number;
  check_risk: number;
  check_problem: number;
  unassigned: number;
  byPerson: PersonRow[];
  byProject: ProjectRow[];
  byDay: { day: string; done: number }[];
}

export function computeSprintStats(
  items: readonly SprintItemView[],
): SprintStats {
  // Упоминание удалённой задачи не считается нигде: самой задачи больше нет, а её строка
  // осталась только чтобы история спринта не рвалась.
  const removed = items.filter((i) => i.removed_at != null);
  const live = items.filter((i) => i.removed_at == null);

  // Отменённая — не сделанная и не невыполненная: её вынимают из счёта целиком.
  const counted = live.filter((i) => i.status !== "cancelled");

  const plan = counted.filter((i) => i.in_plan);
  const extra = counted.filter((i) => !i.in_plan);
  const done = (list: readonly SprintItemView[]) =>
    list.filter((i) => isClosedStatus(i.status)).length;

  const planDone = done(plan);

  const people = new Map<string, PersonRow>();
  const projects = new Map<string | null, ProjectRow>();
  const days = new Map<string, number>();
  let unassigned = 0;

  for (const it of counted) {
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

    const proj = projects.get(it.project) ??
      { name: it.project, total: 0, done: 0 };
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

  // Ручной и автоматический перенос разводит та же чистая функция, что и приёмка, — правило
  // переноса описано один раз (`sprint-carry.ts`), иначе цифры отчёта и факт разъедутся.
  const carryInput: CarryInput[] = live.map((i, idx) => ({
    id: String(idx),
    status: i.status,
    to_carry: i.to_carry === true,
    removed_at: null,
  }));
  const carry = planCarry(carryInput);
  const carriedManual = carry.filter((c) => c.kind === "manual").length;
  const carriedAuto = carry.filter((c) => c.kind === "auto").length;

  const checks = (kind: string) =>
    live.filter((i) => i.check_status === kind).length;

  return {
    plan: plan.length,
    planDone,
    planPercent: plan.length === 0
      ? 0
      : Math.round((planDone / plan.length) * 100),
    extra: extra.length,
    extraDone: done(extra),
    carried: carriedManual + carriedAuto,
    carried_manual: carriedManual,
    carried_auto: carriedAuto,
    cancelled: live.filter((i) => i.status === "cancelled").length,
    removed: removed.length,
    check_ok: checks("ok"),
    check_risk: checks("risk"),
    check_problem: checks("problem"),
    unassigned,
    byPerson: [...people.values()].sort((a, b) =>
      b.plan - a.plan || b.done - a.done || a.name.localeCompare(b.name)
    ),
    byProject: [...projects.values()].sort((a, b) =>
      b.total - a.total || (a.name ?? "￿").localeCompare(b.name ?? "￿")
    ),
    byDay: [...days.entries()].map(([day, n]) => ({ day, done: n })).sort((
      a,
      b,
    ) => a.day.localeCompare(b.day)),
  };
}
