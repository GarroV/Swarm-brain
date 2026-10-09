// Единственный источник правды о доступе к ЗАДАЧЕ: только воркспейс.
//
// Зачем отдельный модуль. Правило доступа было переписано руками в шести местах и закономерно
// разошлось (issue #45). Второго слоя нет по устройству — всё ходит SERVICE_ROLE_KEY, RLS не
// механизм авторизации (см. миграцию 20260819180000_rls_enable_remaining.sql), поэтому промах в
// проверке = сразу доступ к данным.
//
// Решение владельца 09.10.2026 (docs/decisions/2026-10-09-tasks-no-private.md): «личных» задач
// больше нет. Любой участник воркспейса видит и меняет любую задачу своего воркспейса; что
// человек видит в СПИСКЕ, решает фильтр (линзы «мои» / «команда» / «все сотрудники» у админа),
// а не секретность. Изоляция воркспейсов (`group_id`) остаётся и не снимается никогда.
// Это НЕ распространяется на записи, встречи и проекты — там своя приватность
// (`swarm-api/entries-guard.ts`, `_shared/meeting-access.ts`, `_shared/tasks/project-access.ts`).

export type TaskAccessRow = {
  group_id?: string | null;
};

// Задача доступна, только если лежит в воркспейсе зрителя.
export function canAccessTask(task: TaskAccessRow, viewerGroupId: string | null): boolean {
  return viewerGroupId !== null && task.group_id === viewerGroupId;
}

// Единый текст отказа для инструментов, отвечающих строкой (MCP).
//
// Отказ НЕОТЛИЧИМ от «нет такой задачи» — намеренно: перебор id не должен показывать, что в
// чужом воркспейсе есть задача с таким номером. Поэтому не подставляем ни заголовок, ни причину.
//
// `null` — доступ есть, вызывающий продолжает.
export function taskAccessError(
  id: string,
  task: TaskAccessRow | null,
  viewerGroupId: string | null,
): string | null {
  const notFound = `Задача ${id} не найдена.`;
  if (!task || !canAccessTask(task, viewerGroupId)) return notFound;
  return null;
}
