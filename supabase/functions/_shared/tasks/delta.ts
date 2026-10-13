// Чистые куски дельты списка задач (`GET /tasks?since=`), отдельно от db.ts: тесту не нужен клиент базы.

/** Колонка, без которой клиент не отличит архивную задачу дельты от живой. */
export const DELTA_EXTRA_COLUMNS = "archived_at";

/**
 * Условие дельты: правили после `since` ИЛИ архивировали после `since`. Архивация (`archivePatch`)
 * `updated_at` не трогает, поэтому одного `updated_at` мало — архивная задача не доехала бы
 * до клиента и висела бы у него в списке до полной перезагрузки.
 */
export function deltaOrFilter(since: string): string {
  return `updated_at.gt.${since},archived_at.gt.${since}`;
}
