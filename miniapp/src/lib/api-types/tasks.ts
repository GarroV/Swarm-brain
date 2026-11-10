import type { TaskLink } from "@/types";
import type { TaskFile, TaskFileLimits } from "../taskFiles";

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  status?: string;
  due_date?: string | null;
  /** Пинг: день напоминания. null — снять. Перенос взводит сгоревший пинг заново (делает API). */
  remind_date?: string | null;
  assignee_telegram_id?: number | null;
  assignee_person_id?: string | null;
  coassignee_person_ids?: string[];
  /** Старый одиночный ввод; для нескольких стран — `countries` (приоритетнее). */
  country?: string | null;
  /** ISO-коды стран задачи (в PATCH — полный новый список, [] — убрать). */
  countries?: string[];
  task_role?: string | null;
  priority?: string | null;
  // Привязка к встрече (entry.id): задача попадает в блок «Задачи из встречи».
  meeting_id?: string | null;
  // Модуль задач (Рой):
  start_date?: string | null;
  sprint_id?: string | null;
  tags?: string[];
  timeline_position?: number | null;
  label_ids?: string[];
  project_id?: string | null;
  parent_id?: string | null;
  tree_x?: number | null;
  tree_y?: number | null;
  /**
   * Цикличность: daily | weekly | monthly | yearly; null — снять (сервер обнулит и правило).
   * Требует срока (API отобьёт без него).
   */
  recur_freq?: string | null;
  /** Каждые N (1–99). Не прислали — сервер сохранит прежнее, пока частота та же. */
  recur_interval?: number;
  /** Только weekly: дни ISO 1=пн..7=вс; null — день недели срока. */
  recur_weekdays?: number[] | null;
  /** Только monthly: n-й (1–5) или последний (-1) день недели срока; null — по числу. */
  recur_setpos?: number | null;
  /**
   * Ссылки задачи. ⚠️ Списочный ответ GET /tasks их НЕ отдаёт (TASK_LIST_COLUMNS) — задача из
   * списка приходит с `links === undefined`. Слать это поле можно только с догруженной по id
   * задачи, иначе пустой список затрёт реальные ссылки.
   */
  links?: TaskLink[];
};

export type UpdateTaskInput = Partial<CreateTaskInput> & {
  status?: string;
  project_linked?: boolean;
};

export type TaskFilters = {
  status?: string;
  sprint_id?: string;
  tags?: string[];
  label_id?: string;
  start_date_from?: string;
  start_date_to?: string;
  due_date_from?: string;
  due_date_to?: string;
  mine?: boolean;
  project_id?: string;
};

// ── Персональные смарт-метки задач ──────────────────────────────────────────
export type TaskLabel = {
  id: string;
  name: string;
  icon: string;
  color: string | null;
  sort_order: number;
  count: number;
};

// ── Файлы к задаче (#638) ─────────────────────────────────────────────────────
// Список и ссылки — через swarm-api (он проверяет доступ к задаче), байты — напрямую в хранилище
// на MUSPELHEIM по подписанной ссылке. Загрузка — через XHR: у fetch нет прогресса отправки.
export type TaskFilesList = {
  files: TaskFile[];
  limits: TaskFileLimits;
  available: boolean;
};
