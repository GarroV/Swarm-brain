// В каком пространстве запись ВИДНА — одно определение на весь код (этап 2 решения
// docs/decisions/2026-11-05-second-workspace.md).
//
// У записи два разных понятия пространства:
//   * `group_id` — ДОМАШНЕЕ. По нему пишут и обрабатывают: claim, дедуп, публикация, ключ
//     OpenAI, права админа на правку и удаление, черновики (`meetings`), задачи из встречи.
//   * `visible_group_ids` — где запись видна при ЧТЕНИИ: список, поиск, карточка, дайджест,
//     бот, MCP. Всегда содержит домашнее (держит триггер `entries_visible_group_ids_ensure`,
//     миграция 20261105180000); лишние пространства бывают только у встреч.
//
// Чтение для просмотра фильтруется здесь: `visibleInWorkspace(query, g)` вместо
// `.eq("group_id", g)`, проверка строки — `isEntryVisibleInWorkspace(entry, g)`. Чтение,
// которое не переведено, работает по домашнему — пропуск значит «не видно второй команде»,
// а не «видно чужим» (fail-closed).
//
// ⛔ Это НЕ приватность. Личную запись видят только владелец и `shared_with` в любом
// пространстве — условие приватности (`access.ts`) проверяется отдельно и везде.

/** Колонка признака принадлежности у `entries`. */
export const ENTRY_VISIBLE_GROUPS_COLUMN = "visible_group_ids";

/**
 * Годится ли значение как id пространства в фильтре. id — опаковый слаг (`cee`, `demo`);
 * всё, что не похоже на слаг, в фильтр PostgREST не пускаем: запятая или фигурная скобка
 * сломали бы литерал массива `cs.{…}`.
 */
export function isWorkspaceId(groupId: unknown): groupId is string {
  return typeof groupId === "string" && /^[A-Za-z0-9_-]+$/.test(groupId);
}

/** Минимум от построителя запроса supabase-js, который нужен фильтру. */
interface Containable<T> {
  contains(column: string, value: string[]): T;
  is(column: string, value: null): T;
}

/**
 * Оставить в выборке записи, видимые в пространстве `groupId` (`visible_group_ids @> {g}`).
 * Пространство не задано или не похоже на слаг — выборка пустая (`id is null` не бывает).
 */
export function visibleInWorkspace<T extends Containable<T>>(
  query: T,
  groupId: string | null | undefined,
): T {
  if (!isWorkspaceId(groupId)) return query.is("id", null);
  return query.contains(ENTRY_VISIBLE_GROUPS_COLUMN, [groupId]);
}

export type EntryWorkspaceRow = {
  group_id?: string | null;
  visible_group_ids?: string[] | null;
};

/**
 * Видна ли строка в пространстве `groupId`. Домашнее — всегда; остальные — из
 * `visible_group_ids`. Колонку не выбрали — остаётся только домашнее (fail-closed).
 */
export function isEntryVisibleInWorkspace(
  entry: EntryWorkspaceRow | null | undefined,
  groupId: string | null | undefined,
): boolean {
  if (!entry || !isWorkspaceId(groupId)) return false;
  if (entry.group_id === groupId) return true;
  return Array.isArray(entry.visible_group_ids) && entry.visible_group_ids.includes(groupId);
}
