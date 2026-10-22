// Правило размещения: задача, уже стоящая в спринтах пространства, находится в том спринте,
// на даты которого приходится её срок (решение владельца 19.10.2026 —
// docs/decisions/2026-10-19-sprints-go-live-and-auto-by-deadline.md, дизайн —
// docs/superpowers/specs/2026-10-19-sprint-auto-by-deadline-design.md).
//
// Правило описано здесь один раз, чистой функцией, и его же обязана повторять SQL-функция
// `sprint_autoplace_task` (миграция 20261022121000, первая редакция — 20261019120000): триггер на `tasks.due_date` ловит смену срока
// на любом пути записи (веб, бот, MCP, перекат повторяющейся — всё идёт через task_apply_update).
// Тест на базе (sprint-autoplace.db.test.ts) сверяет результат SQL с `planPlacement`; две
// реализации одного правила иначе разъезжаются молча — как и у sprint-carry.ts.
//
// Чистая функция: ничего не читает и не пишет, «сегодня» приходит параметром.

import { daysBetween, type NextCycleDates, nextCycleDates } from "./sprint-dates.ts";

/** Сколько спринтов подряд автоматика создаёт, самое большее (≈ год при двух неделях на спринт). */
export const MAX_AUTO_SPRINTS = 26;
const SPRINT_DAYS = 14;
/** Срок дальше этого числа дней от сегодняшнего дня спринтов не создаёт (26 × 14 = 364). */
export const AUTO_HORIZON_DAYS = MAX_AUTO_SPRINTS * SPRINT_DAYS;

/** Спринт пространства (не архивный) в виде, достаточном для решения. */
export interface PlacementCycle {
  id: string;
  status: "draft" | "active" | "accepted";
  name: string;
  start_date: string;
  end_date: string;
}

export interface PlacementInput {
  /** Новый срок задачи, `YYYY-MM-DD`; `null` — срок сняли. */
  due: string | null;
  today: string;
  /** Все не архивные спринты ОДНОГО пространства. */
  cycles: PlacementCycle[];
  /**
   * Строка задачи в идущем спринте: `live` — живая; `snapshot` — снимок переноса (задача из него
   * ушла); `null` — строки нет или её сняли.
   */
  activeRow: "live" | "snapshot" | null;
  /** Запланированные спринты, где у задачи есть живая строка. */
  draftIds: string[];
  /**
   * Для снимка в идущем: запланированный спринт, где лежит строка, созданная этим переносом
   * (`carried_from` = снимок). Срок вернули — она лишняя. `null` — такой нет (цель удалена или
   * задача стояла там по плану ещё до переноса).
   */
  snapshotTargetId?: string | null;
  /** Старая пометка «к переносу» в идущем (до уборки, план Task 10); `null` — строки нет. */
  carry: { to_carry: boolean; auto: boolean; reason: string | null } | null;
}

/** Ссылка на спринт, которого ещё нет: i-й из `create` (id появится только в базе). */
export const newCycleRef = (i: number) => `new:${i}`;

export interface PlacementPlan {
  /** Добавить в идущий «сверх плана» (срок внутри него, а задачи там нет). */
  addToActive: boolean;
  /** Снимок в идущем оживает: срок вернули в идущий спринт. */
  revive: boolean;
  /** Снять старую пометку «к переносу», поставленную автоматикой без причины: срок вернули. */
  clearCarry: boolean;
  /**
   * Задача переезжает целиком. `snapshot` — из идущего: там остаётся снимок без причины (её
   * спросят при закрытии). Иначе это единственная строка запланированного спринта, и она просто
   * переставляется в цель (та же строка — ссылка снимка на неё не рвётся).
   */
  move: { from: string; targetCycleId: string; snapshot: boolean } | null;
  /**
   * План задачи на несколько спринтов продлевается до этого спринта включительно: строки во всех
   * запланированных после последнего спринта плана, с пометкой `auto_extended`. Строки плана
   * правило не удаляет никогда.
   */
  extendTo: string | null;
  /** Недостающие спринты по порядку (на них ссылаются `newCycleRef(i)`). */
  create: NextCycleDates[];
  /** Запланированные спринты, из которых задачу убираем (строка удаляется). */
  removeDraftIds: string[];
  /** Срок дальше предела автосоздания: спринты не созданы, задача не переехала. */
  limited: boolean;
}

function emptyPlan(): PlacementPlan {
  return {
    addToActive: false,
    revive: false,
    clearCarry: false,
    move: null,
    extendTo: null,
    create: [],
    removeDraftIds: [],
    limited: false,
  };
}

const isBlank = (s: string | null | undefined) => (s ?? "").trim() === "";
const byStart = (a: PlacementCycle, b: PlacementCycle) =>
  a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0;

/**
 * Решение по смене срока (решение владельца 22.10.2026, п.4: «если я назначил другую дату, то
 * задача… переносится туда. В этом спринте остаётся её слепок»; правила на граничные случаи —
 * docs/superpowers/specs/2026-10-22-sprint-board-design.md).
 *
 * - Срок внутри идущего: снимок в нём оживает (лишняя строка-цель снимается); задачи там нет —
 *   добавляется сверх плана, а единственная её строка в будущем убирается.
 * - Срок за концом идущего, задача в одной строке: переезжает в спринт срока (из идущего —
 *   со снимком без причины).
 * - Задача ведётся в нескольких спринтах (план): строки не трогаются; срок позже последнего
 *   спринта плана — план продлевается до спринта срока.
 */
export function planPlacement(input: PlacementInput): PlacementPlan {
  const { due, cycles } = input;
  const plan = emptyPlan();
  if (!due) return plan;

  const live = (input.activeRow === "live" ? 1 : 0) + input.draftIds.length;
  const active = cycles.find((c) => c.status === "active");
  if (active) {
    // Просрочено относительно идущего спринта — задача остаётся где была.
    if (due < active.start_date) return plan;
    if (due <= active.end_date) return insideActive(input);
  }

  const covering = cycles
    .filter((c) => c.status === "draft" && c.start_date <= due && due <= c.end_date)
    .sort(byStart)[0];
  let target: { id: string; start_date: string } | null = covering ?? null;
  if (!target) {
    const last = cycles.reduce<PlacementCycle | null>(
      (acc, c) => (acc === null || c.end_date > acc.end_date ? c : acc),
      null,
    );
    // Срок не дальше последнего спринта (зазор, заведённый руками, или раньше всех) — не
    // создаём и не двигаем: задача остаётся где была.
    if (!last || due <= last.end_date) return plan;

    // Предел: опечатка в сроке (2036 вместо 2026) не должна наплодить сотни спринтов.
    const needed = Math.ceil(daysBetween(last.end_date, due) / SPRINT_DAYS);
    if (daysBetween(input.today, due) > AUTO_HORIZON_DAYS || needed > MAX_AUTO_SPRINTS) {
      return { ...plan, limited: true };
    }

    let prev = { name: last.name, start_date: last.start_date, end_date: last.end_date };
    while (prev.end_date < due) {
      const next = nextCycleDates(prev);
      plan.create.push(next);
      prev = next;
    }
    const lastNew = plan.create[plan.create.length - 1];
    target = { id: newCycleRef(plan.create.length - 1), start_date: lastNew.start_date };
  }

  if (live === 0) return plan;
  if (live === 1) {
    if (input.activeRow === "live" && active) {
      return { ...plan, move: { from: active.id, targetCycleId: target.id, snapshot: true } };
    }
    const only = input.draftIds[0];
    if (only === target.id) return { ...plan, create: [] };
    return { ...plan, move: { from: only, targetCycleId: target.id, snapshot: false } };
  }

  // План на несколько спринтов: строки не удаляются, только продлеваются за последний спринт.
  if (input.draftIds.includes(target.id)) return plan;
  const lastPlanEnd = cycles
    .filter((c) => input.draftIds.includes(c.id))
    .reduce((acc, c) => (c.end_date > acc ? c.end_date : acc), "");
  if (target.start_date > lastPlanEnd) return { ...plan, extendTo: target.id };
  return plan;
}

function insideActive(input: PlacementInput): PlacementPlan {
  const plan = emptyPlan();
  if (input.activeRow === "snapshot") {
    const t = input.snapshotTargetId ?? null;
    return { ...plan, revive: true, removeDraftIds: t && input.draftIds.includes(t) ? [t] : [] };
  }
  if (input.activeRow === "live") {
    const c = input.carry;
    return { ...plan, clearCarry: !!c && c.to_carry && c.auto && isBlank(c.reason) };
  }
  // Задачи в идущем нет: она там сверх плана. Единственная её строка в будущем лишняя (задача
  // переехала); строки плана на несколько спринтов остаются — их не удаляет никто, кроме людей.
  return { ...plan, addToActive: true, removeDraftIds: input.draftIds.length === 1 ? [...input.draftIds] : [] };
}
