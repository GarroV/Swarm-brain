import { getInitData } from "./telegram";
import type { Me, Task, User } from "@/types";

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  due_date?: string | null;
  assignee_telegram_id?: number | null;
  country?: string | null;
  task_role?: string | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput> & { status?: string };

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === "true";

// ── Mock data (DEV_MODE only) ────────────────────────────────────────────────

const MOCK_ME: Me = {
  telegram_id: 123456,
  name: "Dev User",
  group_id: "cee",
  language: "en",
};

const MOCK_USERS: User[] = [
  {
    telegram_id: 123456,
    name: "Dev User",
    username: "devuser",
    role: "bd",
    markets: ["KZ"],
  },
  {
    telegram_id: 789012,
    name: "Alice Smith",
    username: "alice",
    role: "marketing",
    markets: ["PL"],
  },
];

let mockTasks: Task[] = [
  {
    id: "1",
    title: "Prepare Q2 report",
    description: "Collect metrics and draft slides",
    assignees: ["Dev User"],
    assignee_telegram_ids: [123456],
    due_date: "2026-06-15",
    tags: [],
    country: "KZ",
    task_role: "bd",
    source: "mini_app",
    status: "open",
    created_at: new Date().toISOString(),
    updated_at: null,
    meeting_id: null,
    url: null,
    group_id: "cee",
  },
  {
    id: "2",
    title: "Design landing page",
    description: null,
    assignees: ["Alice Smith"],
    assignee_telegram_ids: [789012],
    due_date: null,
    tags: [],
    country: "PL",
    task_role: "marketing",
    source: "mini_app",
    status: "in_progress",
    created_at: new Date().toISOString(),
    updated_at: null,
    meeting_id: null,
    url: null,
    group_id: "cee",
  },
  {
    id: "3",
    title: "Review contracts",
    description: null,
    assignees: [],
    assignee_telegram_ids: [],
    due_date: "2026-05-30",
    tags: [],
    country: null,
    task_role: "rnd",
    source: "mini_app",
    status: "done",
    created_at: new Date().toISOString(),
    updated_at: null,
    meeting_id: null,
    url: null,
    group_id: "cee",
  },
];

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL!;
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `tma ${getInitData()}`,
      ...(options?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchMe(): Promise<Me> {
  if (DEV_MODE) return MOCK_ME;
  return apiFetch<Me>("/me");
}

export async function fetchUsers(): Promise<User[]> {
  if (DEV_MODE) return MOCK_USERS;
  return apiFetch<User[]>("/users");
}

export async function fetchTasks(status?: string): Promise<Task[]> {
  if (DEV_MODE) {
    return status ? mockTasks.filter((t) => t.status === status) : mockTasks;
  }
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<Task[]>(`/tasks${qs}`);
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  if (DEV_MODE) {
    const newTask: Task = {
      id: Date.now().toString(),
      title: input.title,
      description: input.description ?? null,
      assignees: [],
      assignee_telegram_ids: input.assignee_telegram_id
        ? [input.assignee_telegram_id]
        : [],
      due_date: input.due_date ?? null,
      tags: [],
      country: input.country ?? null,
      task_role: input.task_role ?? null,
      source: "mini_app",
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: null,
      meeting_id: null,
      url: null,
      group_id: "cee",
    };
    mockTasks.push(newTask);
    return newTask;
  }
  return apiFetch<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateTask(
  id: string,
  fields: UpdateTaskInput,
): Promise<Task> {
  if (DEV_MODE) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new ApiError(404, "Not found");
    const task = { ...mockTasks[idx], updated_at: new Date().toISOString() };
    if (fields.title !== undefined) task.title = fields.title;
    if (fields.description !== undefined)
      task.description = fields.description ?? null;
    if (fields.status !== undefined) task.status = fields.status;
    if (fields.due_date !== undefined) task.due_date = fields.due_date ?? null;
    if (fields.country !== undefined) task.country = fields.country ?? null;
    if (fields.task_role !== undefined)
      task.task_role = fields.task_role ?? null;
    if ("assignee_telegram_id" in fields) {
      task.assignee_telegram_ids = fields.assignee_telegram_id
        ? [fields.assignee_telegram_id]
        : [];
    }
    mockTasks[idx] = task;
    return task;
  }
  return apiFetch<Task>(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export async function deleteTask(id: string): Promise<void> {
  if (DEV_MODE) {
    mockTasks = mockTasks.filter((t) => t.id !== id);
    return;
  }
  return apiFetch<void>(`/tasks/${id}`, { method: "DELETE" });
}
