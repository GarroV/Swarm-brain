export type Task = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_ids: number[];
  due_date: string | null;
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
};

export type TaskInput = {
  title: string;
  description?: string | null;
  assignees?: string[];
  assignee_telegram_ids?: number[];
  due_date?: string | null;
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
};

// ── Спринты ───────────────────────────────────────────────────────────────────
export type SprintStatus = "planned" | "active" | "completed";

export type Sprint = {
  id: string;
  group_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: SprintStatus;
  created_at: string;
};

export type SprintInput = {
  name: string;
  start_date: string;
  end_date: string;
  status?: SprintStatus;
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
  // Вкладка-владелец проекта (sprints.id). Проект принадлежит одной вкладке; подпроект наследует
  // вкладку родителя. null — проект вне вкладок (легаси/после удаления вкладки: ON DELETE SET NULL).
  sprint_id: string | null;
  // Явный тумблер приватности проекта ВЕРХНЕГО уровня — скрывает его из общего пула (виден только
  // created_by + админу). Подпроект и так приватен по умолчанию (parent_id≠null) — см. listProjects.
  is_private: boolean;
};

export type ProjectInput = {
  name: string;
  color?: string | null;
  emoji?: string | null;
  parent_id?: string | null;
  sprint_id?: string | null;
  is_private?: boolean;
};
