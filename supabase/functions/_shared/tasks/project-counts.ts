/** Счётчики по проектам: всего задач и из них в бэклоге — ровно status='backlog'. Раньше бэклогом
 * считалось `!project_linked` («не в дереве»): для DECIMUS это давало «в бэклоге 71» при пустом
 * status=backlog (#1272). */
export function countProjectTasks(
  tasks: ReadonlyArray<{ project_id: string | null; status: string }>,
): Map<string, { total: number; backlog: number }> {
  const counts = new Map<string, { total: number; backlog: number }>();
  for (const t of tasks) {
    if (!t.project_id) continue;
    const c = counts.get(t.project_id) ?? { total: 0, backlog: 0 };
    c.total += 1;
    if (t.status === "backlog") c.backlog += 1;
    counts.set(t.project_id, c);
  }
  return counts;
}
