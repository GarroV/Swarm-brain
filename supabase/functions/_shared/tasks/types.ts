export type Task = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_ids: number[];
  due_date: string | null;
  // Пинг — ручное напоминание, независимое от срока (см. swarm-bot/handlers/task-pings.ts).
  // `reminded_at` NOT NULL = пинг уже сгорел; перенос `remind_date` его снова взводит (API).
  remind_date: string | null;
  reminded_at: string | null;
  remind_set_by: number | null;
  tags: string[];
  country: string | null;
  task_role: string | null;
  priority: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  meeting_id: string | null;
  url: string | null;
  group_id?: string | null;
  confirmed: boolean;
  created_by_telegram_id: number | null;
  // Модуль задач (Рой):
  is_private: boolean;
  owner_id: number | null;
  start_date: string | null;
  timeline_position: number | null;
  sprint_id: string | null;
  label_ids: string[];
  project_id: string | null;
  project_linked: boolean;
  parent_id: string | null;
  tree_x: number | null;
  tree_y: number | null;
  // Цикличность: NULL = обычная задача. День недели/число по умолчанию берутся из due_date,
  // recur_anchor_dom помнит исходное число месяца для monthly (31 янв → 28 фев → 31 мар).
  recur_freq: string | null;
  recur_anchor_dom: number | null;
  // Правило #823 (словарь RRULE колонками): каждые N; дни недели ISO 1–7 (только weekly);
  // n-й/последний (-1) день недели срока в месяце (только monthly). Канон — recurrence-rule.ts.
  recur_interval: number;
  recur_weekdays: number[] | null;
  recur_setpos: number | null;
  // Не показывать в публичной дорожной карте хаба (issue #562). Необязательно в типе: узкие
  // проекции (TASK_LIST_COLUMNS) его не читают.
  hidden_from_hub?: boolean;
};

export type TaskInput = {
  title: string;
  description?: string | null;
  assignees?: string[];
  assignee_telegram_ids?: number[];
  due_date?: string | null;
  remind_date?: string | null;
  reminded_at?: string | null;
  remind_set_by?: number | null;
  tags?: string[];
  country?: string | null;
  task_role?: string | null;
  priority?: string | null;
  source?: string;
  status?: string;
  meeting_id?: string | null;
  group_id?: string | null;
  confirmed?: boolean;
  created_by_telegram_id?: number | null;
  // Модуль задач (Рой):
  is_private?: boolean;
  owner_id?: number | null;
  start_date?: string | null;
  timeline_position?: number | null;
  sprint_id?: string | null;
  label_ids?: string[];
  project_id?: string | null;
  project_linked?: boolean;
  parent_id?: string | null;
  tree_x?: number | null;
  tree_y?: number | null;
  recur_freq?: string | null;
  recur_anchor_dom?: number | null;
  recur_interval?: number;
  recur_weekdays?: number[] | null;
  recur_setpos?: number | null;
  hidden_from_hub?: boolean;
  /** Ссылки на материалы: массив {title, url}. Разбор и проверка схемы — `links.ts`. */
  links?: { title: string | null; url: string }[];
};

// ── Спринты ───────────────────────────────────────────────────────────────────
export type SprintStatus = "planned" | "active" | "completed";

// Таблица `sprints` обслуживает две разные поверхности, и их нельзя мешать: пространство,
// заведённое в разделе «Спринты», однажды вылезло вкладкой в «Проектах» и уронило весь раздел
// (разведены 21.09.2026, issue #423).
export type SprintKind = "board_tab" | "space";

export type Sprint = {
  id: string;
  group_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: SprintStatus;
  kind: SprintKind;
  created_at: string;
};

export type SprintInput = {
  name: string;
  start_date: string;
  end_date: string;
  status?: SprintStatus;
  kind?: SprintKind;
};

// ── Зависимости задач ─────────────────────────────────────────────────────────
export type DependencyType = "blocks" | "relates_to" | "duplicates";

export type TaskDependency = {
  id: string;
  task_id: string;
  depends_on_id: string;
  dependency_type: DependencyType;
  created_at: string;
};

// ── Проекты (Project Space) ─────────────────────────────────────────────────────
export type Project = {
  id: string;
  group_id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  created_by: number | null;
  created_at: string;
  parent_id: string | null;
  /**
   * Ответственный за направление или инициативу и её сроки (доска инициатив, 18.09.2026).
   * У задач отдельного «ответственного» нет и не заводится — там работает исполнитель.
   */
  owner_telegram_id: number | null;
  start_date: string | null;
  end_date: string | null;
  // Вкладка-владелец проекта (sprints.id). Проект принадлежит одной вкладке; подпроект наследует
  // вкладку родителя. null — проект вне вкладок (легаси/после удаления вкладки: ON DELETE SET NULL).
  sprint_id: string | null;
  // Тумблер приватности — работает и на проекте, и на подпроекте (решение владельца 2026-08-24):
  // закрытую строку видит только её created_by, админского обхода нет. Наследуется вниз — закрытый
  // проект закрывает свои подпроекты. Предикат — canViewProject (_shared/tasks/project-access.ts).
  is_private: boolean;
  /**
   * Порядок в списке братьев (один родитель + один воркспейс), общий для команды: меньше — выше.
   * Вставка между соседями считается как середина их позиций, поэтому перетаскивание правит одну
   * строку. NULL — строка ещё не размещена, показывается в хвосте по дате создания.
   */
  position: number | null;
  /** Справка «О проекте» (27.09.2026): зачем ведём, что это, ссылки на артефакты. */
  goal: string | null;
  description: string | null;
  links: ProjectLink[];
  /**
   * Группа спринта (01.10.2026): собрана перетаскиванием задачи на задачу прямо в списке
   * спринта. Живёт только там — доска «Проекты», селекторы и хаб её не видят, пока её не
   * «пробросили в проекты» (флаг → false). Правило видимости — `_shared/tasks/sprint-groups.ts`.
   */
  sprint_group: boolean;
};

/** Ссылка на артефакт проекта. url — только http(s), проверяет swarm-api/project-fields.ts. */
export type ProjectLink = { title: string; url: string };

export type ProjectInput = {
  name: string;
  color?: string | null;
  emoji?: string | null;
  parent_id?: string | null;
  sprint_id?: string | null;
  is_private?: boolean;
  /** Ответственный за направление или инициативу (telegram id участника воркспейса). */
  owner_telegram_id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  /** Порядок среди братьев; не передан при создании — проект встаёт в конец списка. */
  position?: number | null;
  goal?: string | null;
  description?: string | null;
  links?: ProjectLink[];
  /** Группа спринта: создаётся только при создании; снять можно («В проекты»), поставить — нет. */
  sprint_group?: boolean;
};
