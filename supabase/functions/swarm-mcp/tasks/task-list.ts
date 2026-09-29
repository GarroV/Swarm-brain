// Чистые части выдачи get_tasks (issue #626): имя проекта в строке задачи и честная пометка
// об усечении. Без имени проекта агент не мог собрать «задачи без проекта», а без пометки
// усечённый список читался как полный.
import {
  canViewProject,
  parentLookup,
  type ProjectNameRow,
} from "../../_shared/tasks/project-access.ts";

/** id → имя, только для проектов, которые зритель видит. Закрытый чужой проект имени не отдаёт. */
export function visibleProjectNameById(
  rows: ProjectNameRow[],
  viewerId: number | undefined,
): Map<string, string> {
  const index = parentLookup(rows);
  return new Map(
    rows.filter((p) => canViewProject(p, viewerId, index)).map((p) => [p.id, p.name]),
  );
}

/**
 * Подпись проекта для строки задачи: имя, «без проекта» — или null, если проект зрителю
 * не виден (тогда молчим, а не выдаём чужое имя).
 */
export function projectLabel(
  projectId: string | null | undefined,
  names: Map<string, string>,
): string | null {
  if (!projectId) return "без проекта";
  return names.get(projectId) ?? null;
}

/**
 * Шапка выдачи, если показано меньше, чем подошло. `total: null` — число неизвестно
 * (срез базы сам упёрся в потолок); если при этом выдача заполнена до лимита, об этом тоже
 * надо сказать, а не промолчать.
 */
export function truncationNote(shown: number, total: number | null, limit: number): string | null {
  if (total === null) return shown < limit ? null : `⚠️ Показаны первые ${shown}; сколько подходит всего — неизвестно. Сузь фильтр (status, project, country).`;
  if (total > shown) return `⚠️ Показаны ${shown} из ${total}. Сузь фильтр (status, project, country), чтобы увидеть остальные.`;
  return null;
}
