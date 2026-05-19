export type Task = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_id: number | null;
  due_date: string | null;
  tags: string[];
  country: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  meeting_id: string | null;
  url: string | null;
};

export type TaskInput = {
  title: string;
  description?: string | null;
  assignees?: string[];
  assignee_telegram_id?: number | null;
  due_date?: string | null;
  tags?: string[];
  country?: string | null;
  source?: string;
  status?: string;
  meeting_id?: string | null;
};
