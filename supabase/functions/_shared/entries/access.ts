// Единственный источник правды о доступе к ЗАПИСИ: воркспейс + приватность + авторство.
//
// Зачем отдельный модуль — та же история, что у задач (`_shared/tasks/access.ts`, issue #45):
// правило переписано руками в нескольких местах и расходится. У задач его свели в один гард,
// у записей в `swarm-mcp` не свели: `toolUpdateEntry` и `toolReindexEntry` правили запись
// ПО ОДНОМУ id — без владельца, без приватности, без воркспейса. То есть любой человек с
// валидным MCP-токеном мог переписать содержимое чужой личной записи из другого воркспейса.
//
// Второго слоя нет по устройству: всё ходит SERVICE_ROLE_KEY, RLS здесь не механизм
// авторизации (см. миграцию 20260819180000_rls_enable_remaining.sql). Промах в проверке =
// сразу доступ к данным, поэтому проверка обязана быть fail-closed.
//
// ⛔ У ЗАПИСЕЙ АДМИНСКОГО ОБХОДА НЕТ — в отличие от задач. Это решение владельца, а не
// недосмотр: личная запись видна только автору, руководителю в том числе нет
// (docs/decisions/2026-08-21-admin-visibility.md, issue #15). Не добавлять параметр isAdmin
// «для симметрии с задачами» — там оверсайт нужен по делу, здесь запрещён по делу.

export type EntryAccessRow = {
  is_private: boolean;
  owner_id: number | null;
  group_id?: string | null;
  /**
   * С кем ещё разделена ЛИЧНАЯ запись (#641): встреча 1-1, опубликованная «в личное», — одна
   * запись на двоих. Владелец — опубликовавший, второй участник — здесь. У общей записи пусто.
   * Вызывающий обязан выбрать колонку: без неё второй участник получит отказ (fail-closed).
   */
  shared_with?: Array<number | string> | null;
};

/** Есть ли зритель среди тех, с кем разделена личная запись. */
function isSharedWith(entry: EntryAccessRow, viewerId: number): boolean {
  // bigint[] может прийти строками — сравниваем как числа.
  return (entry.shared_with ?? []).some((id) => Number(id) === viewerId);
}

/** Личную запись видит её автор и те, с кем она разделена. Общую — любой в воркспейсе. */
export function canViewEntry(entry: EntryAccessRow, viewerId: number | null | undefined): boolean {
  if (!entry.is_private) return true;
  if (viewerId == null) return false;
  return entry.owner_id === viewerId || isSharedWith(entry, viewerId);
}

/**
 * То же правило видимости для запроса PostgREST (`.or(...)`): общие, свои и разделённые со
 * мной. Единственная строка фильтра на все поверхности — бот, MCP, swarm-api, контекст встречи.
 *
 * В строку попадает только целое число: всё прочее (NaN, строка) даёт фильтр «только общие».
 */
export function entryVisibilityOr(viewerId: number): string {
  const id = typeof viewerId === "number" && Number.isFinite(viewerId) ? Math.trunc(viewerId) : null;
  if (id === null) return "is_private.eq.false";
  return `is_private.eq.false,owner_id.eq.${id},shared_with.cs.{${id}}`;
}

/**
 * Править и удалять запись может только автор — и личную, и общую.
 *
 * `owner_id = null` закрыт для всех: автора у такой записи нет, значит и права нет ни у кого.
 * Это не тупик — записи без автора чинятся на источнике (кто завёл, тот и автор), а не
 * раздачей прав постороннему.
 */
export function canMutateEntry(entry: EntryAccessRow, viewerId: number | null | undefined): boolean {
  return viewerId != null && entry.owner_id != null && entry.owner_id === viewerId;
}

/**
 * Единый текст отказа для инструментов, отвечающих строкой (MCP).
 *
 * Отказ по невидимой записи НЕОТЛИЧИМ от «нет такой записи» — намеренно: иначе перебор id
 * показывает, что у коллеги есть личная запись, и сам этот факт уже утечка. Поэтому в тексте
 * нет ни заголовка, ни владельца, ни причины.
 *
 * Отказ по чужой ВИДИМОЙ записи (общая, но не твоя) назван прямо: её существование и так не
 * секрет, а человеку полезно понимать, почему правка не прошла.
 *
 * `null` — доступ есть, вызывающий продолжает.
 */
export function entryAccessError(
  id: string,
  entry: EntryAccessRow | null,
  viewerId: number | null | undefined,
  viewerGroupId?: string | null,
  opts?: { requireOwner?: boolean },
): string | null {
  const notFound = `Запись ${id} не найдена.`;
  if (!entry) return notFound;
  // Воркспейс проверяем, только когда вызывающий его сообщил: неизвестный воркспейс не повод
  // пропустить, но и не повод отказать в путях, где он не вычисляется.
  if (viewerGroupId !== undefined && entry.group_id !== viewerGroupId) return notFound;
  if (!canViewEntry(entry, viewerId)) return notFound;
  if (opts?.requireOwner && !canMutateEntry(entry, viewerId)) {
    return `Запрещено: менять и удалять запись может только её автор.`;
  }
  return null;
}
