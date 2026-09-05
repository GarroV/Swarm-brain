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
};

/** Личную запись видит только её автор. Общую — любой в воркспейсе. */
export function canViewEntry(entry: EntryAccessRow, viewerId: number | null | undefined): boolean {
  if (!entry.is_private) return true;
  return viewerId != null && entry.owner_id === viewerId;
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
