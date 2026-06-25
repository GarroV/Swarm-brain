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
  created_by_name: string | null;
  // Модуль задач (Рой):
  is_private: boolean;
  owner_id: number | null;
  start_date: string | null;
  timeline_position: number | null;
  sprint_id: string | null;
};

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

export type DependencyType = "blocks" | "relates_to" | "duplicates";

export type TaskDependency = {
  id: string;
  task_id: string;
  depends_on_id: string;
  dependency_type: DependencyType;
  created_at: string;
  direction?: "outgoing" | "incoming";
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

// ── Swarm Meetings (desktop-agent) ──────────────────────────────────────────────

export type TranscriptSegment = { start: number; end: number; text: string };

export type RecorderRef = { telegram_id: number; claimed_at: string; role: string };

export type AgentMeeting = {
  id: string;
  title: string | null;
  source: string;
  identity_kind: string;
  started_at: string | null;
  ended_at: string | null;
  status: "awaiting_review" | "in_base";
  // Состояние генерации тезисов: тезисы готовятся / готовы / не удалось обработать.
  summary_status: "processing" | "done" | "failed";
  draft_notes_md: string | null;
  // transcript присутствует только в детальном GET /agent-meetings/:id
  transcript?: { language?: string; model?: string; segments: TranscriptSegment[] } | null;
  recorders: RecorderRef[] | null;
  entry_id: string | null;
  created_at: string;
};
