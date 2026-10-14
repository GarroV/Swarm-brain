// Дельта списка задач: `GET /tasks?since=<ISO>` (решение 13.10.2026, perf-after-move п.2).
// Веб раньше перекачивал весь список (~305 КБ) каждые 10 с; теперь первая загрузка полная,
// дальше фон просит только то, что изменилось. Ответ без `since` не меняется — на него завязаны
// бот, MCP и другие экраны.

import { DELTA_EXTRA_COLUMNS } from "../_shared/tasks/delta.ts";

/**
 * Разбор `since`. Возвращает канонический ISO (`toISOString`) или null, если параметр не дата.
 * Каноническая форма — не косметика: строка уходит в PostgREST-фильтр `.or(...)`, и сырой ввод
 * с запятой или скобкой дописал бы к условию чужие фильтры. Пересборка через Date это исключает.
 */
export function parseSince(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Колонки дельты: обычная проекция списка + archived_at. */
export function deltaColumns(listColumns: string): string {
  return `${listColumns},${DELTA_EXTRA_COLUMNS}`;
}

export type TasksDeltaResponse<T> = {
  tasks: T[];
  /** Момент ДО чтения базы: следующий `since`. Снятый до запроса, он перекрывает, а не теряет правки. */
  serverTime: string;
  /** Дельта упёрлась в лимит — клиент обязан сделать полную перезагрузку. */
  truncated: boolean;
};
