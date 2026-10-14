// Слияние дельты списка задач (`GET /tasks?since=`, решение 13.10.2026, perf-after-move п.2).
// Фон веба больше не перекачивает весь список: после первой полной загрузки он просит только
// изменённое. Здесь — чистая логика слияния; запрос — fetchTasksDelta в api.ts.
import type { Task } from "@/types";

/** Строка дельты: обычная задача списка + отметка архивации (непусто — задачу надо убрать). */
export type DeltaTask = Task & { archived_at?: string | null };

export type TasksDeltaResponse = {
  tasks: DeltaTask[];
  /** Момент ДО чтения базы на сервере — следующий `since`. */
  serverTime: string;
  /** Дельта упёрлась в лимит сервера — слияние ненадёжно, нужна полная перезагрузка. */
  truncated: boolean;
};

/**
 * Накладывает дельту на текущий список по id: архивные убираются, изменённые заменяются на месте,
 * новые встают в начало. Порядок не важен — экраны сортируют сами (smartLists). Идемпотентна:
 * повторное применение той же дельты даёт тот же список (окно запроса перекрывается намеренно).
 */
export function mergeTasksDelta(current: Task[], delta: DeltaTask[]): Task[] {
  if (delta.length === 0) return current;
  const byId = new Map(delta.map((t) => [t.id, t]));
  const next: Task[] = [];
  for (const t of current) {
    const d = byId.get(t.id);
    if (!d) { next.push(t); continue; }
    byId.delete(t.id);
    if (!d.archived_at) next.push(d);
  }
  const fresh = [...byId.values()].filter((t) => !t.archived_at);
  return fresh.length ? [...fresh, ...next] : next;
}
