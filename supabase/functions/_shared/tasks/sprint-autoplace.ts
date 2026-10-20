// Правило размещения: задача, уже стоящая в спринтах пространства, находится в том спринте,
// на даты которого приходится её срок (решение владельца 19.10.2026 —
// docs/decisions/2026-10-19-sprints-go-live-and-auto-by-deadline.md, дизайн —
// docs/superpowers/specs/2026-10-19-sprint-auto-by-deadline-design.md).
//
// Правило описано здесь один раз, чистой функцией, и его же обязана повторять SQL-функция
// `sprint_autoplace_task` (миграция 20261019120000): триггер на `tasks.due_date` ловит смену срока
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
  /** В идущем спринте у задачи есть живая (не снятая) строка. */
  inActive: boolean;
  /** Запланированные спринты, где у задачи есть живая строка. */
  draftIds: string[];
  /** Состояние строки в идущем спринте (`null` — строки нет). `auto` — отметку поставила автоматика. */
  carry: { to_carry: boolean; auto: boolean; reason: string | null } | null;
}

export interface PlacementPlan {
  /** Добавить в идущий «сверх плана» (срок внутри него, а задачи там нет). */
  addToActive: boolean;
  /** Поставить отметку переноса в идущем (причина остаётся пустой). */
  setCarry: boolean;
  /** Снять отметку, поставленную автоматикой: срок вернули. */
  clearCarry: boolean;
  /** Существующий запланированный спринт, в который кладём задачу. */
  targetId: string | null;
  /** Недостающие спринты по порядку; задача уходит в последний из них. */
  create: NextCycleDates[];
  /** Запланированные спринты, из которых задачу убираем (строка удаляется). */
  removeDraftIds: string[];
  /** Срок дальше предела автосоздания: спринты не созданы, задача не переехала. */
  limited: boolean;
}

function emptyPlan(): PlacementPlan {
  return {
    addToActive: false,
    setCarry: false,
    clearCarry: false,
    targetId: null,
    create: [],
    removeDraftIds: [],
    limited: false,
  };
}

const isBlank = (s: string | null | undefined) => (s ?? "").trim() === "";

export function planPlacement(input: PlacementInput): PlacementPlan {
  const { due, cycles } = input;
  const plan = emptyPlan();
  if (!due) return plan;

  const active = cycles.find((c) => c.status === "active");
  if (active) {
    // Просрочено относительно идущего спринта — задача остаётся где была.
    if (due < active.start_date) return plan;
    if (due <= active.end_date) {
      return {
        ...plan,
        addToActive: !input.inActive,
        clearCarry: !!input.carry && input.carry.to_carry && input.carry.auto && isBlank(input.carry.reason),
        removeDraftIds: [...input.draftIds],
      };
    }
    // Срок за концом идущего: задача остаётся в нём, но с отметкой переноса. Саму причину
    // система не придумывает — её вписывает человек.
    plan.setCarry = input.inActive && !(input.carry?.to_carry ?? false);
  }

  const covering = cycles
    .filter((c) => c.status === "draft" && c.start_date <= due && due <= c.end_date)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0))[0];
  if (covering) {
    return { ...plan, targetId: covering.id, removeDraftIds: input.draftIds.filter((id) => id !== covering.id) };
  }

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

  const create: NextCycleDates[] = [];
  let prev = { name: last.name, start_date: last.start_date, end_date: last.end_date };
  while (prev.end_date < due) {
    const next = nextCycleDates(prev);
    create.push(next);
    prev = next;
  }
  return { ...plan, create, removeDraftIds: [...input.draftIds] };
}
