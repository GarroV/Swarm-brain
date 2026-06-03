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

export type User = {
  telegram_id: number;
  name: string;
  username: string | null;
  role: string | null;
  markets: string[];
};

export type Me = {
  telegram_id: number;
  name: string;
  username: string | null;
  group_id: string;
  language: string | null;
  role: string | null;
  markets: string[];
  is_admin: boolean;
};

export type AdminWorkspace = {
  id: string;
  name: string;
  allowed_markets: string[] | null;
  user_count: number;
};

export type AdminUser = {
  telegram_id: number;
  name: string;
  username: string | null;
  is_admin: boolean;
  role: string | null;
  markets: string[];
  created_at: string;
};

export type Entry = {
  id: string;
  content: string;
  summary: string | null;
  added_by: string;
  source: string;
  metadata: Record<string, unknown>;
  countries: string[];
  entry_type: string;
  entry_date: string | null;
  group_id: string | null;
  is_private: boolean;
  owner_id: number | null;
  created_at: string;
};

export type Integration = {
  service: string;
  last_polled_at: string | null;
  skipped_note_ids: string[];
};

export type GranolaNote = {
  id: string;
  title: string;
  created_at: string;
  calendar_event?: { scheduled_start_time?: string };
  attendees?: Array<{ name?: string; email?: string }>;
};
