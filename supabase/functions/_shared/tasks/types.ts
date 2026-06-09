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
