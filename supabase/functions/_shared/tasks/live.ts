// «Живая задача» — одно определение на весь код (#575).
//
// С 21.09.2026 задача не удаляется, а архивируется (`tasks.archived_at`, issue #427). Каждый
// читатель таблицы обязан это знать, и забывали ровно читатели, написанные до архивации или
// мимо общего модуля: бот, напоминания, счётчики, состав спринта. Архивная задача продолжала
// жить в командных списках и переноситься из спринта в спринт.
//
// Поэтому условие живёт здесь, а выборка оборачивается: `onlyLive(supabase.from("tasks").select(...))`.
// Тест-сторож `live.guard.test.ts` проходит по всем выборкам из `tasks` и валит прогон, если
// выборка не обёрнута и не помечена осознанным исключением `// archive-ok: <почему>`.
//
// В SQL то же условие — `t.archived_at is null` (приёмка спринта, миграция 20261001180000).

/** Колонка архива у `tasks`. */
export const ARCHIVED_COLUMN = "archived_at";

/** Минимум от построителя запроса supabase-js, который нужен фильтру. */
interface Filterable<T> {
  is(column: string, value: null): T;
}

/** Оставить в выборке только живые (не архивные) задачи. Тип построителя сохраняется. */
export function onlyLive<T extends Filterable<T>>(query: T): T {
  return query.is(ARCHIVED_COLUMN, null);
}

/**
 * Патч архивации задачи — один на все пути (удаление задачи, архивация её встречи #569).
 * `archivedBy` — кто убрал; без личности (крон, откат) — null.
 */
export function archivePatch(archivedBy?: number | null): { archived_at: string; archived_by: number | null } {
  return { archived_at: new Date().toISOString(), archived_by: archivedBy ?? null };
}
