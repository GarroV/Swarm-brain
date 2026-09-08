// Единственный источник правды о статусах задачи.
//
// До 05.09.2026 списка не было вовсе: `swarm-api` писал `body.status` как есть, любая строка
// от клиента уезжала в базу, а колонка свободная — CHECK на неё никто не вешал. Так и получился
// #208: статус `pending`, которого не знал ни один экран, спокойно лёг в 32 строки и полтора
// месяца прятал задачи от людей, на которых они были назначены.
//
// Теперь список один и на него смотрят трое: валидация на входе (400 вместо тихой записи),
// CHECK в базе (миграция 20260905190000_tasks_status_check) и тест, сверяющий его с enum'ами MCP.
export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled", "backlog"] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}

/** Текст отказа для API: называет и что пришло, и что принимается. */
export function taskStatusError(v: unknown): string {
  return `Недопустимый статус задачи: ${JSON.stringify(v)}. Принимаются: ${TASK_STATUSES.join(", ")}.`;
}

/** Статусы, означающие, что работа над задачей закончена. */
export const CLOSED_STATUSES = ["done", "cancelled"] as const;

export function isClosedStatus(v: unknown): boolean {
  return typeof v === "string" && (CLOSED_STATUSES as readonly string[]).includes(v);
}

/**
 * Патч поля `completed_at` по новому статусу задачи.
 *
 * До 08.09.2026 даты закрытия не существовало: и веб, и отчёты брали `updated_at`, который
 * сдвигается от ЛЮБОЙ правки — переименовал закрытую задачу, и она «закрыта сегодня».
 * Спринтам нужна честная дата (когда закрыли, сколько шли к результату), поэтому поле
 * появилось, а решение о нём вынесено сюда чистой функцией — под тесты и без обращения к базе.
 *
 * Правила:
 * — переход в закрытый статус ставит время, но НЕ переписывает уже проставленное
 *   (правка закрытой задачи не должна двигать дату закрытия);
 * — любой открытый статус обнуляет дату — в том числе `open`, который приходит от переката
 *   регулярной задачи: перекат не закрытие;
 * — незнакомый статус считается открытым, как и на экранах после #208.
 */
export function completionPatch(
  nextStatus: string | undefined,
  prevCompletedAt: string | null | undefined,
  nowIso: string,
): { completed_at?: string | null } {
  if (nextStatus === undefined) return {};
  if (isClosedStatus(nextStatus)) return prevCompletedAt ? {} : { completed_at: nowIso };
  return prevCompletedAt ? { completed_at: null } : {};
}
