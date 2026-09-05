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
