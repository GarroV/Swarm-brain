// Единственный источник правды о доступе к ЗАДАЧЕ: воркспейс + приватность.
//
// Зачем отдельный модуль. Правило было переписано руками в шести местах и закономерно
// разошлось (issue #45): `swarm-mcp` проверял только воркспейс, поэтому любой участник правил
// (`toolUpdateTask`) и удалял (`toolDeleteTask`) чужую ЛИЧНУЮ задачу. Второго слоя нет по
// устройству — всё ходит SERVICE_ROLE_KEY, RLS не механизм авторизации (см. миграцию
// 20260819180000_rls_enable_remaining.sql), поэтому промах в проверке = сразу доступ к данным.
//
// Админского обхода здесь НЕТ (решение владельца 2026-08-21): личная задача видна и правится
// ТОЛЬКО владельцем, как и приватные `entries` с 2026-08-07. Раньше `isAdmin` пропускал мимо
// проверки — под флагом `allowed_users.is_admin` в проде было больше одного человека, то есть
// «личное» на деле видели несколько аккаунтов. Параметр убран из сигнатур целиком, чтобы его
// нельзя было вернуть незаметно одним аргументом.

export type TaskAccessRow = {
  is_private: boolean;
  owner_id: number | null;
  group_id?: string | null;
};

// Приватную задачу видит только владелец; командную — любой в воркспейсе.
// owner_id = null у приватной задачи (осиротевшая) закрыта для всех: fail-closed.
export function canViewTask(task: TaskAccessRow, viewerId: number): boolean {
  return !task.is_private || task.owner_id === viewerId;
}

// Мутировать приватную задачу может только владелец.
export function canMutateTask(task: TaskAccessRow, viewerId: number): boolean {
  return !task.is_private || task.owner_id === viewerId;
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
  viewerGroupId?: string | null,
): string | null {
  const notFound = `Задача ${id} не найдена.`;
  if (!task) return notFound;
  if (viewerGroupId !== undefined && task.group_id !== viewerGroupId) return notFound;
  if (!canViewTask(task, viewerId)) return notFound;
  return null;
}
