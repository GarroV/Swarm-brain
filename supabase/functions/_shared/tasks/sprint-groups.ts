// Группы спринта (01.10.2026, решение владельца — docs/decisions/2026-10-01-sprint-dnd-groups.md):
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

/** Строка журнала задачи о смене проекта (task_history, field='project'). */
export type ProjectMove = {
  task_id: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

/**
 * Куда вернуть каждую задачу распускаемой группы: «задачи возвращаются, куда были». Откуда
 * задача пришла в группу, знает журнал (#286): последний переход в эту группу, его old_value.
 *
 * - Пришла без проекта — возвращается без проекта.
 * - Пришла из проекта, который ещё жив (не в архиве, в этом воркспейсе), — туда.
 * - Журнала нет (задачу завели прямо в группе) или прежний проект с тех пор убран — туда, где
 *   висела группа (`fallback`): задача не должна указывать на архивный проект.
 * - Подзадача, чей родитель распускается вместе с ней, едет за родителем: подзадача живёт в
 *   проекте родителя (#478), и раздельный возврат разорвал бы пару молча.
 */
export function dissolveTargets(args: {
  groupId: string;
  fallback: string | null;
  tasks: ReadonlyArray<{ id: string; parent_id: string | null }>;
  moves: readonly ProjectMove[];
  /** Живые проекты воркспейса, кроме самой группы. */
  liveProjectIds: ReadonlySet<string>;
}): Map<string, string | null> {
  const lastIn = new Map<string, ProjectMove>();
  for (const m of args.moves) {
    if (m.new_value !== args.groupId) continue;
    const seen = lastIn.get(m.task_id);
    if (!seen || m.created_at > seen.created_at) lastIn.set(m.task_id, m);
  }
  const own = new Map<string, string | null>();
  for (const t of args.tasks) {
    const move = lastIn.get(t.id);
    if (!move) own.set(t.id, args.fallback);
    else if (move.old_value === null) own.set(t.id, null);
    else if (args.liveProjectIds.has(move.old_value)) own.set(t.id, move.old_value);
    else own.set(t.id, args.fallback);
  }
  const out = new Map<string, string | null>();
  for (const t of args.tasks) {
    const parentTarget = t.parent_id !== null && own.has(t.parent_id) ? own.get(t.parent_id)! : undefined;
    out.set(t.id, parentTarget !== undefined ? parentTarget : own.get(t.id)!);
  }
  return out;
}
