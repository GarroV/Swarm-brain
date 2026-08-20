// Единственный источник правды о доступе к ЗАДАЧЕ: воркспейс + приватность.
//
// Зачем отдельный модуль. Правило было переписано руками в шести местах и закономерно
// разошлось (issue #45): `swarm-mcp` проверял только воркспейс, поэтому любой участник правил
// (`toolUpdateTask`) и удалял (`toolDeleteTask`) чужую ЛИЧНУЮ задачу. Второго слоя нет по
// устройству — всё ходит SERVICE_ROLE_KEY, RLS не механизм авторизации (см. миграцию
// 20260819180000_rls_enable_remaining.sql), поэтому промах в проверке = сразу доступ к данным.
//
// Отличие от записей/встреч: у ЗАДАЧ админ имеет оверсайт намеренно (руководитель получает
// апдейты), у приватных `entries` — НЕТ admin-байпаса (решение владельца 2026-08-07).
// Не переносить это послабление на записи — там свой страж `swarm-api/entries-guard.ts`.

export type TaskAccessRow = {
  is_private: boolean;
  owner_id: number | null;
  group_id?: string | null;
};

// Приватную задачу видит только владелец или админ; командную — любой в воркспейсе.
// owner_id = null у приватной задачи (осиротевшая) закрыта для всех, кроме админа: fail-closed.
export function canViewTask(task: TaskAccessRow, viewerId: number, isAdmin: boolean): boolean {
  return !task.is_private || isAdmin || task.owner_id === viewerId;
}

// Мутировать приватную задачу может только владелец или админ.
export function canMutateTask(task: TaskAccessRow, viewerId: number, isAdmin: boolean): boolean {
  return !task.is_private || isAdmin || task.owner_id === viewerId;
}

// Единый текст отказа для инструментов, отвечающих строкой (MCP).
//
// Отказ НЕОТЛИЧИМ от «нет такой задачи» — намеренно: иначе перебор id показывает, что у коллеги
// есть личная задача, и сам этот факт уже утечка. По той же причине не подставляем ни заголовок,
// ни владельца, ни причину отказа.
//
// `null` — доступ есть, вызывающий продолжает.
export function taskAccessError(
  id: string,
  task: TaskAccessRow | null,
  viewerId: number,
  isAdmin: boolean,
  viewerGroupId?: string | null,
): string | null {
  const notFound = `Задача ${id} не найдена.`;
  if (!task) return notFound;
  if (viewerGroupId !== undefined && task.group_id !== viewerGroupId) return notFound;
  if (!canViewTask(task, viewerId, isAdmin)) return notFound;
  return null;
}
