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
  label_ids: string[];
  project_id: string | null;
  project_linked: boolean;
  parent_id: string | null;
  tree_x: number | null;
  tree_y: number | null;
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

export type Project = {
  id: string;
  group_id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  parent_id: string | null;
  // Вкладка-владелец проекта (Sprint.id). Проект принадлежит одной вкладке; подпроект — вкладке родителя.
  sprint_id: string | null;
  created_by: number | null;
  created_at: string;
  // Отдаётся из GET /projects (агрегаты):
  task_count?: number;
  backlog_count?: number;
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
  is_demo?: boolean;
};

export type AdminWorkspace = {
  id: string;
  name: string;
  allowed_markets: string[] | null;
  user_count: number;
};

export type AdminUser = {
  // Ожидающие приглашения (добавлены по @username, ещё не вошли в бота) имеют telegram_id=null
  // и pending=true; удаляются по username. id — PK строки allowed_users.
  id?: string;
  telegram_id: number | null;
  pending?: boolean;
  name: string;
  username: string | null;
  is_admin: boolean;
  role: string | null;
  markets: string[];
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

export type Entry = {
  id: string;
  content: string;
  summary: string | null;
  added_by: string;
  // Имя импортёра (резолв added_by_telegram_id/owner_id → user_profiles на сервере, GET /meetings).
  // null, если не из профилей. added_by — это источник ("granola"), НЕ человек.
  importer_name?: string | null;
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

// Участник встречи из календаря (Google Calendar, собирается рекордером при claim).
// Аудио-диаризации нет — это список из календарного события, не «кто что сказал».
export type Attendee = { name?: string; email?: string };

export type TranscriptSegment = { start: number; end: number; text: string; speaker?: string };

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
  // Участники из календаря (детальный GET /agent-meetings/:id, select *). Может быть пусто
  // для ручных записей без календарного события.
  attendees?: Attendee[] | null;
  // transcript присутствует только в детальном GET /agent-meetings/:id
  transcript?: { language?: string; model?: string; segments?: TranscriptSegment[] } | null;
  recorders: RecorderRef[] | null;
  // Имена записавших (резолв recorders[].telegram_id → user_profiles на сервере). Уникальные,
  // фолбэк «#id». Отдаётся всеми ответами /agent-meetings (список и деталь).
  recorder_names?: string[] | null;
  entry_id: string | null;
  created_at: string;
};

// Живая пометка «на полях», сделанная в виджете рекордера во время записи (таблица
// meeting_live_notes). offset_sec — смещение от старта записи, когда пометку набрали.
export type MeetingLiveNote = {
  id: string;
  offset_sec: number;
  text: string;
  author_id: number;
  created_at: string;
};
