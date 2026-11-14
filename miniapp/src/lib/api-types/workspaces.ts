export interface WorkspaceConfig {
  allowed_markets: string[];
  /** Имя воркспейса; null/нет — старый сервер или воркспейс без имени. */
  workspace_name?: string | null;
}

/** Сводка по пространству — только счётчики (GET /admin/workspaces/:id/stats, workspaces-routes.ts). */
export type WorkspaceStats = {
  id: string;
  name: string;
  window_days: number;
  people: { total: number; pending: number; admins: number; active: number };
  meetings: { home: number; shared_in: number };
  entries: number;
  tasks_open: number;
  model_spend_usd: number | null;
  recorder_bot: {
    configured: boolean;
    active: boolean;
    last_seen_at: string | null;
  };
};

// Сводка для админа: сколько встреч на вычитке у каждого участника (агрегат, без контента).
export type ReviewCount = { telegram_id: number; name: string; count: number };

// ── Перенос человека в другое пространство (мастер-админ) ─────────────────────
// Контракт серверной части (GET move-preview / POST move) — один и тот же ответ, у POST + moved:true.
// Отказы — JSON `{error, code}` (ApiError.body): 404 person_not_found/workspace_not_found, 409
// same_workspace/person_without_workspace, 403 owner_only/master_admin_only, 400 bad_input; 409
// `conflicts` несёт `conflicts`, 409 `expected_mismatch` — свежие `counts`; `identity_changed` — повтори запрос.
export type MovePreview = {
  person: { account_id?: string; telegram_id: number | null; name: string | null; email: string | null };
  from: { id: string; name: string };
  to: { id: string; name: string };
  counts: {
    private_entries: number;
    entries: number;
    personal_notes: number;
    drafts: number;
    meetings_shared: number;
    tasks: number;
    tasks_detached: number;
    projects: number;
    notifications: number;
    labels: number;
    other: Record<string, number>;
  };
  tasks_mixed: Array<{ id: string; title: string }>;
  tasks_detached: Array<{ id: string; title: string }>;
  projects: Array<{ id: string; name: string }>;
  tokens: {
    claude: boolean;
    chatgpt: boolean;
    oauth: number;
    recorder: boolean;
  };
  /** Машинные строки `код:подробность` (сейчас `people_email_taken:<почта>`); текст — moveMessages.ts. */
  conflicts: string[];
  can_execute: boolean;
  moved?: boolean;
};
