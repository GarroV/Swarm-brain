import type {
  BoardPlanTask,
  SprintCycle,
  SprintCycleItem,
  User,
} from "@/types";
import { byNumberedName } from "@/lib/initiatives";
import { isOverdue } from "../format";

// Чистые правила доски спринтов: что считать «требует внимания», как работают поиск и фильтр по
// человеку, как собирается следующий спринт. Вёрстки здесь нет — её читают колонки и карточки.

export const CLOSED_STATUSES = new Set(["done", "cancelled"]);

export const isClosedStatus = (status: string): boolean =>
  CLOSED_STATUSES.has(status);

/** Фильтры над доской: действуют на ВСЕ колонки, включая мастер-план (спека, «Доска»). */
export type BoardFilter = {
  query: string;
  /** Имя человека или null — все. */
  person: string | null;
  /** Только то, что требует внимания. */
  attention: boolean;
};

export const NO_FILTER: BoardFilter = {
  query: "",
  person: null,
  attention: false,
};

/** Исполнители задачи по именам: подписи из задачи плюс люди по telegram_id. */
export function namesOf(
  assignees: readonly string[],
  ids: readonly number[],
  users: readonly Pick<User, "telegram_id" | "name">[],
): string[] {
  const names = new Set<string>(assignees);
  for (const u of users) if (ids.includes(u.telegram_id)) names.add(u.name);
  return [...names];
}

function matchesText(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || title.toLowerCase().includes(q);
}

function matchesPerson(
  names: readonly string[],
  person: string | null,
): boolean {
  return !person || names.includes(person);
}

/** Строка спринта просит внимания: незакрытая и с риском, проблемой или просроченным сроком. */
export function itemNeedsAttention(item: SprintCycleItem): boolean {
  if (isClosedStatus(item.status) || item.removed) return false;
  return item.check_status === "risk" || item.check_status === "problem" ||
    (!!item.due_date && isOverdue(item.due_date));
}

/** Снимок без причины — просьба вписать её. */
export const snapshotNeedsReason = (item: SprintCycleItem): boolean =>
  !!item.moved && item.moved.reason === null;

/** Задача мастер-плана просит внимания: незакрытая и просроченная. */
export function planTaskNeedsAttention(t: BoardPlanTask): boolean {
  return !isClosedStatus(t.status) && !!t.due_date && isOverdue(t.due_date);
}

/** Подходит ли строка спринта под фильтры. `names` — исполнители с учётом telegram_id из плана. */
export function itemMatches(
  item: SprintCycleItem,
  names: readonly string[],
  f: BoardFilter,
): boolean {
  if (!matchesText(item.title, f.query) || !matchesPerson(names, f.person)) {
    return false;
  }
  return !f.attention ||
    (item.moved ? snapshotNeedsReason(item) : itemNeedsAttention(item));
}

export function planTaskMatches(
  t: BoardPlanTask,
  names: readonly string[],
  f: BoardFilter,
): boolean {
  if (!matchesText(t.title, f.query) || !matchesPerson(names, f.person)) {
    return false;
  }
  return !f.attention || planTaskNeedsAttention(t);
}

/** Группы колонки спринта: по названию группы, «без группы» — последней. Названия — как в списке. */
export function groupItems(
  items: readonly SprintCycleItem[],
): { name: string | null; items: SprintCycleItem[] }[] {
  const by = new Map<string | null, SprintCycleItem[]>();
  for (const i of items) {
    const list = by.get(i.project) ?? [];
    list.push(i);
    by.set(i.project, list);
  }
  return [...by]
    .sort(([a], [b]) => a === null ? 1 : b === null ? -1 : byNumberedName(a, b))
    .map(([name, list]) => ({ name, items: list }));
}

const MS_DAY = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_DAY).toISOString()
    .slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY,
  );
}

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * Следующий спринт после последнего: даты встык, та же длина, имя с увеличенным номером
 * («Спринт 5» → «Спринт 6»), а без номера — по датам. Нет спринтов — две недели от `today`.
 */
export function nextCycleDraft(
  cycles: readonly Pick<SprintCycle, "name" | "start_date" | "end_date">[],
  today: string,
): { name: string; start_date: string; end_date: string } {
  const last = [...cycles].sort((a, b) => a.end_date.localeCompare(b.end_date))
    .at(-1);
  const start = last ? addDays(last.end_date, 1) : today;
  const length = last
    ? Math.max(1, daysBetween(last.start_date, last.end_date) + 1)
    : 14;
  const end = addDays(start, length - 1);
  const m = last?.name.match(/^(.*?)(\d+)\s*$/);
  const name = m
    ? `${m[1]}${Number(m[2]) + 1}`
    : `Спринт ${dm(start)} — ${dm(end)}`;
  return { name, start_date: start, end_date: end };
}

/** Спринт, в окно которого попадает срок задачи («спринт срока», флажок 🏁). */
export function dueCycle<
  T extends Pick<SprintCycle, "start_date" | "end_date">,
>(
  cycles: readonly T[],
  due: string | null,
): T | null {
  if (!due) return null;
  return cycles.find((c) => c.start_date <= due && due <= c.end_date) ?? null;
}
