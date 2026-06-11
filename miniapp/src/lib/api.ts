import { getInitData } from "./telegram";
import type { Me, Task, User, Entry, Integration, GranolaNote, AdminWorkspace, AdminUser, Sprint, SprintStatus, TaskDependency, DependencyType } from "@/types";

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  due_date?: string | null;
  assignee_telegram_id?: number | null;
  country?: string | null;
  task_role?: string | null;
  // Модуль задач (Рой):
  is_private?: boolean;
  start_date?: string | null;
  sprint_id?: string | null;
  tags?: string[];
  timeline_position?: number | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput> & { status?: string };

export type TaskFilters = {
  status?: string;
  sprint_id?: string;
  tags?: string[];
  start_date_from?: string;
  start_date_to?: string;
  due_date_from?: string;
  due_date_to?: string;
  mine?: boolean;
};

export type CreateEntryInput = {
  content: string;
  is_private?: boolean;
};

export type UpdateEntryInput = {
  content?: string;
  summary?: string | null;
};

export type UpdateMeetingInput = {
  confirmed?: boolean;
  summary?: string | null;
  countries?: string[];
};

export type UpdateMeInput = {
  role?: string | null;
  markets?: string[];
};

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export { ApiError };

const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === "true";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_ME: Me = {
  telegram_id: 123456,
  name: "Dev User",
  username: "devuser",
  group_id: "cee",
  language: "en",
  role: "bd",
  markets: ["KZ", "PL"],
  is_admin: true,
};

const MOCK_USERS: User[] = [
  { telegram_id: 123456, name: "Dev User", username: "devuser", role: "bd", markets: ["KZ"] },
  { telegram_id: 789012, name: "Alice Smith", username: "alice", role: "marketing", markets: ["PL"] },
  { telegram_id: 345678, name: "Bob Jones", username: "bob", role: "rnd", markets: ["RS", "ME"] },
];

let mockTasks: Task[] = [
  {
    id: "1", title: "Prepare Q2 report", description: "Collect metrics and draft slides",
    assignees: ["Dev User"], assignee_telegram_ids: [123456], due_date: "2026-06-15",
    tags: [], country: "KZ", task_role: "bd", source: "mini_app", status: "open",
    created_at: new Date().toISOString(), updated_at: null, meeting_id: null, url: null, group_id: "cee",
    created_by_name: "Dev User",
    is_private: false, owner_id: null, start_date: "2026-06-10", timeline_position: null, sprint_id: null,
  },
  {
    id: "2", title: "Design landing page", description: null,
    assignees: ["Alice Smith"], assignee_telegram_ids: [789012], due_date: null,
    tags: [], country: "PL", task_role: "marketing", source: "mini_app", status: "in_progress",
    created_at: new Date().toISOString(), updated_at: null, meeting_id: null, url: null, group_id: "cee",
    created_by_name: "Alice Smith",
    is_private: false, owner_id: null, start_date: null, timeline_position: null, sprint_id: null,
  },
  {
    id: "3", title: "Review contracts", description: null,
    assignees: [], assignee_telegram_ids: [], due_date: "2026-05-30",
    tags: [], country: null, task_role: "rnd", source: "mini_app", status: "done",
    created_at: new Date().toISOString(), updated_at: null, meeting_id: null, url: null, group_id: "cee",
    created_by_name: null,
    is_private: false, owner_id: null, start_date: null, timeline_position: null, sprint_id: null,
  },
];

let mockEntries: Entry[] = [
  {
    id: "e1", content: "Обсудили стратегию выхода на рынок Казахстана. Ключевые игроки: Kaspi, Halyk. Нужно готовить локализацию Q3.",
    summary: "Стратегия Казахстан: Kaspi, Halyk, локализация Q3", added_by: "Dev User",
    source: "note", metadata: {}, countries: ["KZ"], entry_type: "note", entry_date: "2026-06-01",
    group_id: "cee", is_private: false, owner_id: 123456, created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "e2", content: "Личная заметка: нужно изучить конкурентов в Польше до конца месяца.",
    summary: null, added_by: "Dev User",
    source: "note", metadata: {}, countries: ["PL"], entry_type: "note", entry_date: null,
    group_id: "cee", is_private: true, owner_id: 123456, created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "e3", content: "Встреча с партнёром из Сербии. Обсудили условия дистрибуции, подписание планируется в июле.",
    summary: "Сербия: дистрибуция, подписание в июле", added_by: "Alice Smith",
    source: "granola", metadata: { confirmed: true }, countries: ["RS"], entry_type: "meeting", entry_date: "2026-05-30",
    group_id: "cee", is_private: false, owner_id: 789012, created_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

const mockMeetings: Entry[] = [
  {
    id: "m1", content: "Kickoff встреча нового квартала. Участники: Dev User, Alice, Bob. Приоритеты: рост Польши, запуск в Сербии.",
    summary: "Q3 kickoff: приоритеты Польша + Сербия", added_by: "Dev User",
    source: "granola", metadata: { confirmed: false, title: "Q3 Kickoff" }, countries: ["PL", "RS"], entry_type: "meeting", entry_date: "2026-06-01",
    group_id: "cee", is_private: false, owner_id: 123456, created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "m2", content: "Встреча с командой Read.ai для обсуждения интеграции.",
    summary: "Read.ai интеграция — обсуждение деталей", added_by: "Alice Smith",
    source: "read_ai", metadata: { confirmed: true, title: "Read.ai Integration Call" }, countries: [], entry_type: "meeting", entry_date: "2026-05-28",
    group_id: "cee", is_private: false, owner_id: 789012, created_at: new Date(Date.now() - 432000000).toISOString(),
  },
];

const mockIntegrations: Integration[] = [];

const mockGranolaUnprocessed: GranolaNote[] = [
  {
    id: "gn1", title: "Partner Call — Warsaw",
    created_at: new Date(Date.now() - 3600000).toISOString(),
    calendar_event: { scheduled_start_time: new Date(Date.now() - 7200000).toISOString() },
    attendees: [{ name: "Jan Kowalski", email: "jan@example.com" }],
  },
];

// ── Fetch helper ──────────────────────────────────────────────────────────────

// База — same-origin прокси /api (CF Pages Function). В Telegram шлём initData
// в Authorization: tma; в браузере — httpOnly cookie (credentials: include),
// прокси перекладывает её в Bearer на сервере.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

function authHeaders(): Record<string, string> {
  const initData = getInitData();
  return initData ? { Authorization: `tma ${initData}` } : {};
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

async function apiFetchNoContentType<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...authHeaders(),
      ...(options?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function fetchMe(): Promise<Me> {
  if (DEV_MODE) return MOCK_ME;
  return apiFetch<Me>("/me");
}

// Гасит httpOnly-cookie roj_session (браузерная сессия). Обрабатывает CF-функция
// /api/auth/logout напрямую, минуя прокси в swarm-api. Внутри Telegram Mini App
// бессмысленно — там сессия определяется initData, а не cookie.
export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
}

export async function fetchConfig(): Promise<{ allowed_markets: string[] }> {
  if (DEV_MODE) return { allowed_markets: ["RS","HR","SI","ME","BG","ES","RO","PL","EE","LT","CY","HU","MD","BY","TR","AZ","AM","GE","TJ","KG","MN","NG","MX","ID","RU","UA","KZ"] };
  return apiFetch<{ allowed_markets: string[] }>("/config");
}

export async function patchMe(fields: UpdateMeInput): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>("/me", { method: "PATCH", body: JSON.stringify(fields) });
}

export async function fetchUsers(): Promise<User[]> {
  if (DEV_MODE) return MOCK_USERS;
  return apiFetch<User[]>("/users");
}

export async function fetchTasks(filters?: string | TaskFilters): Promise<Task[]> {
  const f: TaskFilters = typeof filters === "string" ? { status: filters } : (filters ?? {});
  if (DEV_MODE) {
    let r = mockTasks;
    if (f.status) r = r.filter((t) => t.status === f.status);
    if (f.sprint_id) r = r.filter((t) => t.sprint_id === f.sprint_id);
    if (f.tags?.length) r = r.filter((t) => f.tags!.some((tag) => t.tags.includes(tag)));
    return r;
  }
  const params = new URLSearchParams();
  if (f.status) params.set("status", f.status);
  if (f.sprint_id) params.set("sprint_id", f.sprint_id);
  if (f.tags?.length) params.set("tags", f.tags.join(","));
  if (f.start_date_from) params.set("start_date_from", f.start_date_from);
  if (f.start_date_to) params.set("start_date_to", f.start_date_to);
  if (f.due_date_from) params.set("due_date_from", f.due_date_from);
  if (f.due_date_to) params.set("due_date_to", f.due_date_to);
  if (f.mine) params.set("mine", "true");
  const qs = params.toString();
  return apiFetch<Task[]>(`/tasks${qs ? `?${qs}` : ""}`);
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  if (DEV_MODE) {
    const newTask: Task = {
      id: Date.now().toString(), title: input.title, description: input.description ?? null,
      assignees: [], assignee_telegram_ids: input.assignee_telegram_id ? [input.assignee_telegram_id] : [],
      due_date: input.due_date ?? null, tags: input.tags ?? [], country: input.country ?? null,
      task_role: input.task_role ?? null, source: "mini_app", status: "open",
      created_at: new Date().toISOString(), updated_at: null, meeting_id: null, url: null, group_id: "cee",
      created_by_name: MOCK_ME.name,
      is_private: input.is_private ?? false, owner_id: input.is_private ? MOCK_ME.telegram_id : null,
      start_date: input.start_date ?? null, timeline_position: input.timeline_position ?? null,
      sprint_id: input.sprint_id ?? null,
    };
    mockTasks.push(newTask);
    return newTask;
  }
  return apiFetch<Task>("/tasks", { method: "POST", body: JSON.stringify(input) });
}

export async function updateTask(id: string, fields: UpdateTaskInput): Promise<Task> {
  if (DEV_MODE) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new ApiError(404, "Not found");
    const task = { ...mockTasks[idx], updated_at: new Date().toISOString() };
    if (fields.title !== undefined) task.title = fields.title;
    if (fields.description !== undefined) task.description = fields.description ?? null;
    if (fields.status !== undefined) task.status = fields.status;
    if (fields.due_date !== undefined) task.due_date = fields.due_date ?? null;
    if (fields.country !== undefined) task.country = fields.country ?? null;
    if (fields.task_role !== undefined) task.task_role = fields.task_role ?? null;
    if (fields.start_date !== undefined) task.start_date = fields.start_date ?? null;
    if (fields.sprint_id !== undefined) task.sprint_id = fields.sprint_id ?? null;
    if (fields.tags !== undefined) task.tags = fields.tags ?? [];
    if (fields.timeline_position !== undefined) task.timeline_position = fields.timeline_position ?? null;
    if (fields.is_private !== undefined) {
      task.is_private = fields.is_private;
      task.owner_id = fields.is_private ? MOCK_ME.telegram_id : null;
    }
    if ("assignee_telegram_id" in fields) {
      task.assignee_telegram_ids = fields.assignee_telegram_id ? [fields.assignee_telegram_id] : [];
    }
    mockTasks[idx] = task;
    return task;
  }
  return apiFetch<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteTask(id: string): Promise<void> {
  if (DEV_MODE) { mockTasks = mockTasks.filter((t) => t.id !== id); return; }
  return apiFetch<void>(`/tasks/${id}`, { method: "DELETE" });
}

export async function extractTasks(text: string): Promise<Task[]> {
  if (DEV_MODE) return [];
  return apiFetch<Task[]>("/tasks/extract", { method: "POST", body: JSON.stringify({ text }) });
}

// ── Sprints (Рой) ───────────────────────────────────────────────────────────────
let mockSprints: Sprint[] = [
  { id: "sp1", group_id: "cee", name: "Sprint 24", start_date: "2026-06-02", end_date: "2026-06-15", status: "active", created_at: new Date().toISOString() },
];

export async function fetchSprints(): Promise<Sprint[]> {
  if (DEV_MODE) return mockSprints;
  return apiFetch<Sprint[]>("/sprints");
}

export async function createSprint(input: { name: string; start_date: string; end_date: string; status?: SprintStatus }): Promise<Sprint> {
  if (DEV_MODE) {
    const s: Sprint = { id: Date.now().toString(), group_id: "cee", name: input.name, start_date: input.start_date, end_date: input.end_date, status: input.status ?? "planned", created_at: new Date().toISOString() };
    mockSprints.push(s);
    return s;
  }
  return apiFetch<Sprint>("/sprints", { method: "POST", body: JSON.stringify(input) });
}

export async function updateSprint(id: string, fields: Partial<{ name: string; start_date: string; end_date: string; status: SprintStatus }>): Promise<Sprint> {
  if (DEV_MODE) {
    const i = mockSprints.findIndex((s) => s.id === id);
    if (i === -1) throw new ApiError(404, "Not found");
    mockSprints[i] = { ...mockSprints[i], ...fields };
    return mockSprints[i];
  }
  return apiFetch<Sprint>(`/sprints/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteSprint(id: string): Promise<void> {
  if (DEV_MODE) { mockSprints = mockSprints.filter((s) => s.id !== id); return; }
  return apiFetch<void>(`/sprints/${id}`, { method: "DELETE" });
}

export async function addTasksToSprint(sprintId: string, taskIds: string[]): Promise<void> {
  if (DEV_MODE) { mockTasks = mockTasks.map((t) => (taskIds.includes(t.id) ? { ...t, sprint_id: sprintId } : t)); return; }
  await apiFetch<{ updated: number }>(`/sprints/${sprintId}/tasks`, { method: "POST", body: JSON.stringify({ task_ids: taskIds }) });
}

export async function removeTasksFromSprint(sprintId: string, taskIds: string[]): Promise<void> {
  if (DEV_MODE) { mockTasks = mockTasks.map((t) => (taskIds.includes(t.id) ? { ...t, sprint_id: null } : t)); return; }
  await apiFetch<{ updated: number }>(`/sprints/${sprintId}/tasks`, { method: "DELETE", body: JSON.stringify({ task_ids: taskIds }) });
}

// ── Task dependencies (Рой) ───────────────────────────────────────────────────────
export async function fetchDependencies(taskId: string): Promise<TaskDependency[]> {
  if (DEV_MODE) return [];
  return apiFetch<TaskDependency[]>(`/tasks/${taskId}/dependencies`);
}

export async function createDependency(taskId: string, dependsOnId: string, type: DependencyType = "blocks"): Promise<TaskDependency> {
  if (DEV_MODE) return { id: Date.now().toString(), task_id: taskId, depends_on_id: dependsOnId, dependency_type: type, created_at: new Date().toISOString() };
  return apiFetch<TaskDependency>(`/tasks/${taskId}/dependencies`, { method: "POST", body: JSON.stringify({ depends_on_id: dependsOnId, dependency_type: type }) });
}

export async function deleteDependency(taskId: string, depId: string): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/tasks/${taskId}/dependencies/${depId}`, { method: "DELETE" });
}

// ── Entries ───────────────────────────────────────────────────────────────────

export async function fetchEntries(filters?: { source?: string; type?: string; date_from?: string; date_to?: string }): Promise<Entry[]> {
  if (DEV_MODE) return mockEntries;
  const qs = new URLSearchParams(
    Object.entries(filters ?? {}).filter(([, v]) => v != null) as [string, string][]
  ).toString();
  return apiFetch<Entry[]>(`/entries${qs ? `?${qs}` : ""}`);
}

export async function fetchEntry(id: string): Promise<Entry> {
  if (DEV_MODE) {
    const e = mockEntries.find((x) => x.id === id);
    if (!e) throw new ApiError(404, "Not found");
    return e;
  }
  return apiFetch<Entry>(`/entries/${id}`);
}

export async function patchEntry(id: string, fields: UpdateEntryInput): Promise<Entry> {
  if (DEV_MODE) {
    const idx = mockEntries.findIndex((x) => x.id === id);
    if (idx === -1) throw new ApiError(404, "Not found");
    mockEntries[idx] = { ...mockEntries[idx], ...fields };
    return mockEntries[idx];
  }
  return apiFetch<Entry>(`/entries/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteEntry(id: string): Promise<void> {
  if (DEV_MODE) { mockEntries = mockEntries.filter((x) => x.id !== id); return; }
  return apiFetch<void>(`/entries/${id}`, { method: "DELETE" });
}

export async function searchEntries(q: string): Promise<Entry[]> {
  if (DEV_MODE) {
    const lq = q.toLowerCase();
    return mockEntries.filter((e) =>
      e.content.toLowerCase().includes(lq) || (e.summary ?? "").toLowerCase().includes(lq)
    );
  }
  return apiFetch<Entry[]>(`/search?q=${encodeURIComponent(q)}`);
}

export async function createEntry(input: CreateEntryInput): Promise<Entry> {
  if (DEV_MODE) {
    const e: Entry = {
      id: Date.now().toString(), content: input.content, summary: null, added_by: "Dev User",
      source: "note", metadata: {}, countries: [], entry_type: "note", entry_date: null,
      group_id: "cee", is_private: input.is_private ?? false, owner_id: 123456,
      created_at: new Date().toISOString(),
    };
    mockEntries.unshift(e);
    return e;
  }
  return apiFetch<Entry>("/entries", { method: "POST", body: JSON.stringify(input) });
}

export async function uploadFile(file: File, is_private = false): Promise<Entry> {
  const form = new FormData();
  form.append("file", file);
  form.append("is_private", String(is_private));
  if (DEV_MODE) {
    const e: Entry = {
      id: Date.now().toString(), content: `Файл: ${file.name}`, summary: null, added_by: "Dev User",
      source: "file", metadata: { filename: file.name }, countries: [], entry_type: "document", entry_date: null,
      group_id: "cee", is_private, owner_id: 123456, created_at: new Date().toISOString(),
    };
    mockEntries.unshift(e);
    return e;
  }
  return apiFetchNoContentType<Entry>("/entries/upload", { method: "POST", body: form });
}

// ── Meetings ──────────────────────────────────────────────────────────────────

export async function fetchMeetings(filters?: { confirmed?: boolean }): Promise<Entry[]> {
  if (DEV_MODE) {
    if (filters?.confirmed !== undefined)
      return mockMeetings.filter((m) => Boolean(m.metadata.confirmed) === filters.confirmed);
    return mockMeetings;
  }
  const qs = filters?.confirmed !== undefined ? `?confirmed=${filters.confirmed}` : "";
  return apiFetch<Entry[]>(`/meetings${qs}`);
}

export async function fetchMeeting(id: string): Promise<Entry> {
  if (DEV_MODE) {
    const m = mockMeetings.find((x) => x.id === id);
    if (!m) throw new ApiError(404, "Not found");
    return m;
  }
  return apiFetch<Entry>(`/meetings/${id}`);
}

export async function patchMeeting(id: string, fields: UpdateMeetingInput): Promise<Entry> {
  if (DEV_MODE) {
    const idx = mockMeetings.findIndex((x) => x.id === id);
    if (idx === -1) throw new ApiError(404, "Not found");
    if (fields.confirmed !== undefined)
      mockMeetings[idx] = { ...mockMeetings[idx], metadata: { ...mockMeetings[idx].metadata, confirmed: fields.confirmed } };
    if (fields.summary !== undefined)
      mockMeetings[idx] = { ...mockMeetings[idx], summary: fields.summary };
    if (fields.countries !== undefined)
      mockMeetings[idx] = { ...mockMeetings[idx], countries: fields.countries };
    return mockMeetings[idx];
  }
  return apiFetch<Entry>(`/meetings/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteMeeting(id: string): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/meetings/${id}`, { method: "DELETE" });
}

// ── Integrations / Granola ────────────────────────────────────────────────────

export async function fetchIntegrations(): Promise<Integration[]> {
  if (DEV_MODE) return mockIntegrations;
  return apiFetch<Integration[]>("/integrations");
}

export async function connectGranola(api_key: string): Promise<void> {
  if (DEV_MODE) {
    mockIntegrations.push({ service: "granola", last_polled_at: null, skipped_note_ids: [] });
    void api_key;
    return;
  }
  return apiFetch<void>("/integrations/granola", { method: "POST", body: JSON.stringify({ api_key }) });
}

export async function disconnectGranola(): Promise<void> {
  if (DEV_MODE) {
    const idx = mockIntegrations.findIndex((i) => i.service === "granola");
    if (idx !== -1) mockIntegrations.splice(idx, 1);
    return;
  }
  return apiFetch<void>("/integrations/granola", { method: "DELETE" });
}

export async function fetchGranolaUnprocessed(period: "today" | "7d" | "30d" = "7d"): Promise<GranolaNote[]> {
  if (DEV_MODE) return mockGranolaUnprocessed;
  return apiFetch<GranolaNote[]>(`/granola/notes?period=${period}`);
}

export async function previewGranolaNote(id: string): Promise<{ summary: string }> {
  if (DEV_MODE) return { summary: "Тезисы встречи: обсудили стратегию, наметили следующие шаги." };
  return apiFetch<{ summary: string }>(`/granola/notes/${id}/preview`);
}

export async function importGranolaNote(id: string, visibility: "public" | "private"): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/granola/notes/${id}/import`, { method: "POST", body: JSON.stringify({ visibility }) });
}

export async function skipGranolaNote(id: string): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/granola/notes/${id}/skip`, { method: "POST" });
}

// ── Feedback & Digest ─────────────────────────────────────────────────────────

export async function sendFeedback(text: string): Promise<void> {
  if (DEV_MODE) { console.log("DEV feedback:", text); return; }
  return apiFetch<void>("/feedback", { method: "POST", body: JSON.stringify({ text }) });
}

export async function generateDigest(days = 7): Promise<{ text: string }> {
  if (DEV_MODE) return { text: "**Дайджест за 7 дней**\n\n• Встреча с партнёром в Варшаве\n• Обсуждение стратегии Q3\n• Запуск локализации для KZ" };
  return apiFetch<{ text: string }>("/digest", { method: "POST", body: JSON.stringify({ days }) });
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function fetchAdminWorkspaces(): Promise<AdminWorkspace[]> {
  if (DEV_MODE) return [
    { id: "cee", name: "CEE", allowed_markets: null, user_count: 3 },
    { id: "other", name: "Other Markets", allowed_markets: ["NG","MX","ID"], user_count: 2 },
  ];
  return apiFetch<AdminWorkspace[]>("/admin/workspaces");
}

export async function fetchAdminWorkspaceUsers(wsId: string): Promise<AdminUser[]> {
  if (DEV_MODE) return MOCK_USERS.map(u => ({ ...u, is_admin: false, created_at: new Date().toISOString() }));
  return apiFetch<AdminUser[]>(`/admin/workspaces/${wsId}/users`);
}

export async function addUserToWorkspace(wsId: string, telegramId: number): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/admin/workspaces/${wsId}/users`, { method: "POST", body: JSON.stringify({ telegram_id: telegramId }) });
}

export async function removeUserFromWorkspace(wsId: string, userId: number): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/admin/workspaces/${wsId}/users/${userId}`, { method: "DELETE" });
}

export async function patchAdminWorkspace(wsId: string, fields: { name?: string; allowed_markets?: string[] | null }): Promise<AdminWorkspace> {
  if (DEV_MODE) return { id: wsId, name: fields.name ?? wsId, allowed_markets: fields.allowed_markets ?? null, user_count: 0 };
  return apiFetch<AdminWorkspace>(`/admin/workspaces/${wsId}`, { method: "PATCH", body: JSON.stringify(fields) });
}
