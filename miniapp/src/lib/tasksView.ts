// Сохранённый вид доски задач (localStorage «roy_tasks_view») — чистая логика чтения и
// миграции, без React: её гоняют тесты, а хук useReminderTasks только вызывает.
import { DEFAULT_STATUSES, STATUS_FILTERS, type Lens, type SmartListId, type StatusFilter, type StatusSet } from "@/lib/smartLists";
import type { DateRange } from "@/lib/dateRange";

export type SavedTasksView = {
  activeList?: SmartListId;
  activeLabelId?: string | null;
  lens?: Lens;
  byMarket?: boolean;
  allStaff?: boolean;
  range?: DateRange | null;
  statuses?: StatusFilter[];
};

/** Как вид лежит в хранилище: значения могли быть записаны прошлой версией приложения. */
export type StoredTasksView = Omit<SavedTasksView, "activeList"> & { activeList?: string };

// До issue #216 «Готовые» были ЧЕТВЁРТЫМ пунктом оси времени, и у всей команды это значение
// лежит в localStorage. После переноса статуса в свою ось такой `activeList` невалиден: экран
// открылся бы ПУСТЫМ, и человек решил бы, что задачи пропали (раскатка веба до людей доезжает
// вместе с их старым хранилищем — см. docs/decisions про stale-бандл). Переводим на
// «Все» + чип «Готово» — ровно то, что человек и смотрел.
export function migrateSavedView(saved: StoredTasksView | null): SavedTasksView | null {
  if (!saved) return null;
  if (saved.activeList !== "done") return saved as SavedTasksView;
  return { ...saved, activeList: "all", statuses: ["done"] };
}

// Набор статусов из сохранённого вида. Пустой массив — ЗАКОННЫЙ выбор («без фильтра по
// статусу»), поэтому отличаем его от «ничего не сохранено» и не подменяем дефолтом.
// Незнакомые значения выбрасываем: хранилище правят руками и оно переживает версии.
export function savedStatuses(saved: SavedTasksView | null): StatusSet {
  const raw = saved?.statuses;
  if (!Array.isArray(raw)) return DEFAULT_STATUSES;
  return new Set(raw.filter((id): id is StatusFilter => (STATUS_FILTERS as readonly string[]).includes(id)));
}
