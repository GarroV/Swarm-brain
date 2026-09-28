// Правило связи «задача → подзадача» (#478, #485). Чистая функция: её зовут MCP и (дальше) бот,
// веб держит то же правило в `miniapp/src/lib/subtasks.ts` (`subtaskCandidates`).
//
// Вложенность — ОДИН уровень (решение владельца 24.09.2026: проект → инициатива → задача →
// подзадача). У подзадачи своих подзадач нет, поэтому родителем годится только задача верхнего
// уровня, а задача, у которой уже есть подзадачи, сама подзадачей стать не может. Отсюда же
// следует, что цикла не бывает: для него нужны два уровня.

export interface SubtaskNode {
  id: string;
  group_id?: string | null;
  project_id: string | null;
  parent_id: string | null;
  title: string;
}

/**
 * Почему `parent` нельзя сделать родителем, или null — можно.
 *
 * `child` — существующая задача при привязке, null при создании новой подзадачи (у новой нет
 * ни своих подзадач, ни проекта: проект она наследует от родителя).
 */
export function subtaskLinkError(
  parent: SubtaskNode,
  child: SubtaskNode | null,
  opts: { groupId: string; childHasKids: boolean },
): string | null {
  if (parent.group_id != null && parent.group_id !== opts.groupId) {
    return `Задача ${parent.id} не найдена.`;
  }
  if (child && child.id === parent.id) {
    return "Задача не может быть подзадачей самой себя.";
  }
  if (parent.parent_id) {
    return `«${parent.title}» — сама подзадача, а вложенность одна: выбери задачу верхнего уровня.`;
  }
  if (child && opts.childHasKids) {
    return `У «${child.title}» уже есть подзадачи — подзадачей она стать не может (вложенность одна).`;
  }
  if (child && (child.project_id ?? null) !== (parent.project_id ?? null)) {
    return `Подзадача живёт в проекте родителя: сначала перенеси «${child.title}» в тот же проект (project_name), потом привязывай.`;
  }
  return null;
}
