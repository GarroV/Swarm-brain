// Журнал изменений задачи — что, когда, кем и с чего на что (issue #286).
//
// Зачем чистой функцией. До 09.09.2026 история задач была фикцией: `task_history` писал только
// бот и только на перекате регулярной задачи — на проде в таблице лежали ДВЕ строки на две
// задачи, при том что задачи двигают каждый день. Веб, где карточки тащат мышью, не писал
// историю никогда. Поэтому вопрос руководства «где, когда, куда передвинули» ответа не имел
// вовсе, и восстановить прошлое нечем: архива не существует, данные копятся только вперёд.
//
// Здесь живёт РЕШЕНИЕ, какие строки журнала породит патч, — отдельно от записи в базу, чтобы
// его можно было проверить тестами: молчаливо не записанное изменение неотличимо от «его не
// было», а заметно это станет через месяц, когда отчёт окажется пустым.

/** Поля, изменения которых попадают в журнал: колонка задачи → имя в журнале. */
export const TRACKED_FIELDS: Record<string, string> = {
  status: "status",
  due_date: "due_date",
  assignees: "assignee",
  project_id: "project",
  sprint_id: "sprint",
  priority: "priority",
};

/** Колонки, которые нужно прочитать до апдейта, чтобы знать «было». */
export const HISTORY_SNAPSHOT_COLUMNS = Object.keys(TRACKED_FIELDS);

export type TaskSnapshot = Record<string, unknown>;

export type HistoryRow = {
  task_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_by_telegram_id: number | null;
  group_id: string | null;
  /** Совместимость: у field='status' дублируем в старые колонки, их читают прежние запросы. */
  old_status: string | null;
  new_status: string | null;
  note: string | null;
};

/** Значение поля в текстовый вид журнала. Массив (assignees) — «Аня, Вася», пустое — null. */
export function historyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    return parts.length ? parts.join(", ") : null;
  }
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Какие строки журнала породит этот патч. Пишем ТОЛЬКО реально изменившиеся поля: патч часто
 * несёт весь объект формы, и без сравнения журнал забился бы строками «было X, стало X», в
 * которых настоящее перемещение не найти.
 *
 * `patch` — то, что уходит в базу (после переката и прочих подстановок), `snapshot` — что было.
 */
export function historyRowsFor(args: {
  taskId: string;
  snapshot: TaskSnapshot | null;
  patch: Record<string, unknown>;
  actor?: string | null;
  actorTelegramId?: number | null;
  groupId?: string | null;
  note?: string | null;
}): HistoryRow[] {
  const { taskId, snapshot, patch } = args;
  if (!snapshot) return [];

  const rows: HistoryRow[] = [];
  for (const [column, field] of Object.entries(TRACKED_FIELDS)) {
    if (!(column in patch)) continue;
    const before = historyValue(snapshot[column]);
    const after = historyValue(patch[column]);
    if (before === after) continue;
    rows.push({
      task_id: taskId,
      field,
      old_value: before,
      new_value: after,
      changed_by: args.actor ?? null,
      changed_by_telegram_id: args.actorTelegramId ?? null,
      group_id: args.groupId ?? null,
      old_status: field === "status" ? before : null,
      new_status: field === "status" ? after : null,
      note: args.note ?? null,
    });
  }
  return rows;
}
