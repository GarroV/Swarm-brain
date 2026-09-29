// Фильтр по исполнителю — подстрока имени без учёта регистра по `assignees` (text[]). В базе
// его не выразить: PostgREST не умеет ilike по элементам массива, а резолв имени в telegram_id
// теряет внешних исполнителей без учётки. Поэтому фильтр живёт в JS — и обязан стоять ДО
// лимита выдачи (issue #626): раньше база отдавала первые `limit` задач воркспейса, а фильтр
// оставлял из них чужой остаток, и 30 задач сжимались в 9 без признака усечения.

/** Сколько строк тянуть из базы, когда список потом сужается по исполнителю в JS. */
export const ASSIGNEE_SCAN_LIMIT = 2000;

/**
 * Сужает строки до исполнителя и только ПОТОМ режет до лимита. `total` — сколько подошло до
 * среза: по нему выдача честно говорит «показаны N из M».
 */
export function narrowByAssignee<T extends { assignees?: string[] | null }>(
  rows: T[],
  assigneeText: string,
  limit: number,
): { tasks: T[]; total: number } {
  const lower = assigneeText.toLowerCase();
  const matched = rows.filter((t) => t.assignees?.some((a) => a.toLowerCase().includes(lower)));
  return { tasks: matched.slice(0, limit), total: matched.length };
}
