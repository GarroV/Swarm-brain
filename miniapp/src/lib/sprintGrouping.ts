// Группировка перетаскиванием в списке спринта (решение владельца 01.10.2026,
// docs/decisions/2026-10-01-sprint-drag-grouping.md): задачу бросают на задачу — появляется
// окошко с названием, и обе задачи уходят в новую группу. Группа — запись в `projects` с
// признаком `sprint_group`, скрытая с доски «Проекты», пока её не пробросили.
//
// Здесь только решение «что сделать с броском» — чистой функцией, без DOM и запросов. Ошибка
// здесь не падает, а молча кладёт задачу не туда, поэтому модуль в ядре (scripts/core-paths.txt).

export type GroupingProject = {
  id: string;
  parent_id: string | null;
  sprint_group?: boolean;
};

/** Куда бросили: на строку задачи или на заголовок группы (`projectId: null` — «Без направления»). */
export type DropTarget =
  | {
    kind: "task";
    taskId: string;
    projectId: string | null;
    /** Подзадача (#478) группу не собирает: она живёт под своим родителем. */
    isSubtask: boolean;
  }
  | { kind: "header"; projectId: string | null };

export type DropAction =
  | { kind: "none" }
  /** Перенести брошенную задачу в проект (или снять проект, `null`). */
  | { kind: "move"; projectId: string | null }
  /** Спросить название и создать группу под `parentId`; в неё уходят обе задачи. */
  | { kind: "create"; parentId: string | null; targetTaskId: string };

const NONE: DropAction = { kind: "none" };

export function dropAction(
  draggedTaskId: string,
  target: DropTarget,
  projects: readonly GroupingProject[],
  opts: { draggedProjectId?: string | null } = {},
): DropAction {
  const from = opts.draggedProjectId ?? null;

  if (target.kind === "header") {
    if (target.projectId === from) return NONE;
    return { kind: "move", projectId: target.projectId };
  }

  if (target.taskId === draggedTaskId || target.isSubtask) return NONE;

  if (target.projectId === null) {
    return { kind: "create", parentId: null, targetTaskId: target.taskId };
  }
  const project = projects.find((p) => p.id === target.projectId);
  // Проект цели не загружен — закрыт от зрителя или устарел список. Вынимать из него задачу в
  // новую группу нельзя: это чужая раскладка, которой зритель не видит.
  if (!project) return NONE;

  // Цель уже в группе — присоединяемся к ней, а не строим группу в группе.
  if (project.sprint_group === true) {
    if (project.id === from) return NONE;
    return { kind: "move", projectId: project.id };
  }
  // Доска — два уровня: под инициативой (подпроектом) группа стала бы третьим, поэтому она
  // встаёт рядом с инициативой, в том же направлении.
  return {
    kind: "create",
    parentId: project.parent_id ?? project.id,
    targetTaskId: target.taskId,
  };
}
