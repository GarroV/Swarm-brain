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
};
