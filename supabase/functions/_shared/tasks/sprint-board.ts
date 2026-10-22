// Доска спринтов (решение владельца 22.10.2026, docs/decisions/2026-10-22-sprint-board-direction.md):
// чистая часть — какие спринты закрашены у задачи на мастер-плане. Без обращений к базе, чтобы
// ядро проверялось тестом без стенда; загрузка данных доски — в `sprint-board-load.ts`.

/** Строка спринта в том виде, что нужен полоске: связь «задача — спринт» и признаки ухода. */
export interface SpanRow {
  task_id: string;
  cycle_id: string;
  /** Начало спринта: по нему выстраивается порядок полоски. */
  start_date: string;
  /** Снимок переноса: задача отсюда ушла, спринтом задачи он больше не считается. */
  moved_at: string | null;
  /** Снята из идущего спринта (#576): в спринте её больше нет. */
  withdrawn_at: string | null;
}

/**
 * Спринты каждой задачи по порядку начала. Снимки переноса и снятые строки не входят: полоска
 * показывает, где задача ЖИВЁТ, а не где она когда-то лежала. У задачи без живых строк в карте
 * записи нет. Равные даты — по id спринта, чтобы порядок не прыгал между запросами.
 */
export function buildPlanSpans(rows: readonly SpanRow[]): Map<string, string[]> {
  const per = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (r.moved_at != null || r.withdrawn_at != null) continue;
    const cycles = per.get(r.task_id) ?? new Map<string, string>();
    cycles.set(r.cycle_id, r.start_date);
    per.set(r.task_id, cycles);
  }
  const out = new Map<string, string[]>();
  for (const [taskId, cycles] of per) {
    out.set(
      taskId,
      [...cycles].sort(([ia, da], [ib, db]) => da.localeCompare(db) || ia.localeCompare(ib)).map(([id]) => id),
    );
  }
  return out;
}

/** Задача мастер-плана: то, что нужно карточке и полоске. */
export interface PlanTaskView {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  /** Подписи исполнителей из задачи; люди по telegram_id — `assignee_telegram_ids`, имена знает веб. */
  assignees: string[];
  assignee_telegram_ids: number[];
  /** Подзадача сидит под родителем той же группы; иначе — своей строкой. */
  parent_id: string | null;
  created_at: string;
  /** Спринты задачи по порядку начала (`buildPlanSpans`). */
  cycle_ids: string[];
}

export interface PlanGroupView {
  id: string;
  name: string;
  tasks: PlanTaskView[];
}
