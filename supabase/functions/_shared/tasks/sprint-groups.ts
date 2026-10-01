// Группы спринта (01.10.2026, решение владельца — docs/decisions/2026-10-01-sprint-drag-grouping.md):
// в списке спринта задачу бросают на задачу, называют группу — и получается запись в `projects`
// с флагом `sprint_group`. Технически это проект или подпроект, но живёт он только в спринте:
// доска «Проекты», селектор проекта в карточке и публичный хаб его не видят, пока группу не
// «пробросили в проекты» (флаг снят).
//
// Почему правило видимости отдельной чистой функцией. Выборок `projects` много (доска, селектор,
// MCP, хаб), и если хотя бы одна забудет фильтр, временная группа молча всплывёт у всей команды.
// Ошибка здесь не падает — поэтому модуль в ядре (scripts/core-paths.txt) и под порчей.

type GroupRow = {
  id: string;
  parent_id: string | null;
  sprint_group?: boolean | null;
};

const isGroup = (r: GroupRow | undefined): boolean => r?.sprint_group === true;

/**
 * Список без групп спринта — то, что видят доска «Проекты», селектор и хаб. Ребёнок скрытой
 * группы скрыт вместе с ней: интерфейс подпроекты под группу не заводит, но строка, сделанная
 * руками или старым кодом, иначе всплыла бы на доске сиротой без родителя.
 */
export function withoutSprintGroups<T extends GroupRow>(rows: readonly T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.filter((r) => !isGroup(r) && !(r.parent_id !== null && isGroup(byId.get(r.parent_id))));
}

/**
 * Можно ли повесить новую группу под `parentId`. null — можно, строка — текст отказа.
 * Группа спринта родителем не бывает: группа в группе прячется вместе с ней и при «пробросе»
 * родителя повисла бы на доске невидимым ребёнком. Глубину (не больше двух уровней) отдельно
 * проверяет `validateParent` при создании.
 */
export function parentForSprintGroup(
  parentId: string | null,
  rows: readonly GroupRow[],
): string | null {
  if (parentId === null) return null;
  const parent = rows.find((r) => r.id === parentId);
  if (!parent) return "parent_id не найден в этом воркспейсе";
  if (isGroup(parent)) return "группа спринта не может быть родителем";
  return null;
}

/**
 * Что делать с задачами, когда группу распускают. Распускается только группа спринта —
 * обычный проект так «распустить» нельзя: его состав видят на доске, и снять его одной кнопкой
 * из спринта значило бы разобрать чужой проект. Задачи уходят туда, где группа висела: в
 * родительский проект или без проекта.
 */
export function dissolvePlan(
  project: GroupRow,
): { ok: true; moveTasksTo: string | null } | { ok: false } {
  if (!isGroup(project)) return { ok: false };
  return { ok: true, moveTasksTo: project.parent_id };
}
