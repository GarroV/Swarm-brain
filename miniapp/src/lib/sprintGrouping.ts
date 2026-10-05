// Группировка перетаскиванием в списке спринта (решение владельца 01.10.2026,
// docs/decisions/2026-10-01-sprint-dnd-groups.md): задачу бросают на задачу — появляется
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

// ── Задержка над целью → подзадача (дополнение владельца 01.10.2026) ──────────────────────
// «может быть задержать, и при этом должно показать явно что это будет подзадача». Бросок сразу
// группирует; подержал над той же задачей — режим меняется на «подзадача», и экран показывает
// силуэт будущей строки. Время передаётся снаружи: функция не знает про таймеры браузера.

/** Сколько держать над задачей, чтобы бросок сделал подзадачу, а не группу. */
export const SUBTASK_HOLD_MS = 700;
/** Долгое нажатие на таче, после которого строка «поднимается»; короче — это прокрутка. */
export const LONG_PRESS_MS = 500;

export type HoverMode = "group" | "subtask";

/** `enteredAt` — когда курсор встал на текущую цель; null — цели нет, таймер сброшен. */
export function hoverMode(enteredAt: number | null, now: number): HoverMode {
  if (enteredAt === null) return "group";
  return now - enteredAt >= SUBTASK_HOLD_MS ? "subtask" : "group";
}

export type DraggedTask = {
  taskId: string;
  projectId: string | null;
  parentId: string | null;
  /** Свои подзадачи у тащимой: вложенность одна, такая задача подзадачей не станет. */
  hasKids: boolean;
};

/** Почему подзадачи не выйдет — экран пишет причину на силуэте. */
export type SubtaskBlock = "self" | "target-subtask" | "has-kids" | "already";

export function subtaskBlock(
  dragged: DraggedTask,
  target: Extract<DropTarget, { kind: "task" }>,
): SubtaskBlock | null {
  if (target.taskId === dragged.taskId) return "self";
  // Вложенность одна (решение 24.09.2026): родителем годится только задача верхнего уровня.
  if (target.isSubtask) return "target-subtask";
  if (dragged.hasKids) return "has-kids";
  if (dragged.parentId === target.taskId) return "already";
  return null;
}

export type ResolvedDrop =
  | DropAction
  /** Сделать тащимую подзадачей `parentTaskId`; подзадача живёт в проекте родителя. */
  | { kind: "subtask"; parentTaskId: string; projectId: string | null };

export function resolveDrop(
  dragged: DraggedTask,
  target: DropTarget,
  mode: HoverMode,
  projects: readonly GroupingProject[],
): ResolvedDrop {
  if (target.kind === "task" && mode === "subtask") {
    if (subtaskBlock(dragged, target) !== null) return NONE;
    return {
      kind: "subtask",
      parentTaskId: target.taskId,
      projectId: target.projectId,
    };
  }
  // Подзадачу бросили на заголовок её же группы — вытащить её обратно в отдельную задачу (#807).
  // Перенос отвязывает подзадачу от родителя, проект остаётся тем же.
  if (target.kind === "header" && dragged.parentId !== null) {
    return { kind: "move", projectId: target.projectId };
  }
  return dropAction(dragged.taskId, target, projects, {
    draggedProjectId: dragged.projectId,
  });
}
