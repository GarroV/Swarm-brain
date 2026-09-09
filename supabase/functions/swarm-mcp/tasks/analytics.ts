// MCP-инструменты статистики по задачам (issue #286, этапы Э0 и Э2).
//
// Запрос руководства: «выгружать статистику по задачам — где, когда, куда передвинуть».
// get_task_stats отвечает на «сколько и как быстро» из полей самой задачи, get_task_history и
// get_recent_task_changes — на «где, когда, куда» из журнала перемещений.
//
// Доступ считается тем же каноническим правилом, что в остальном коде задач: воркспейс +
// canViewTask (_shared/tasks/access.ts). RLS не авторизация — всё ходит service_role, поэтому
// промах в проверке здесь сразу означает утечку чужих личных задач.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listTasks, getTask } from "../../_shared/tasks/db.ts";
import { canViewTask, taskAccessError } from "../../_shared/tasks/access.ts";
import { computeTaskStats, periodStartISO, type StatsTask } from "../../_shared/tasks/analytics.ts";
import { ADMIN_USER_ID, fetchProjectRows, resolveGroupId } from "./tools.ts";
import { pickProjectByName, visibleProjectNames } from "../../_shared/tasks/project-access.ts";
import { projectNotFoundMessage } from "./format.ts";
import {
  formatRecentChanges,
  formatTaskHistory,
  formatTaskStats,
  type JournalRow,
  type RecentChangeRow,
} from "./analytics-format.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Выборка под статистику: считаем в коде, поэтому берём с потолком. Задач в воркспейсе сотни —
// потолок про запас, а не про производительность.
const STATS_TASK_CAP = 1000;
const CHANGES_DEFAULT_LIMIT = 100;
const CHANGES_MAX_LIMIT = 400;
const CHANGES_READ_MULTIPLIER = 4;
const CHANGES_READ_CAP = 2000;
const DEFAULT_PERIOD = "week";

/** Имена авторов изменений по telegram_id (fallback — legacy-текст changed_by). */
async function resolveAuthors(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const { data } = await supabase
    .from("user_profiles").select("telegram_id, first_name, last_name").in("telegram_id", ids);
  for (const p of (data ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string }>) {
    out.set(p.telegram_id, [p.first_name, p.last_name].filter(Boolean).join(" ") || String(p.telegram_id));
  }
  return out;
}

type RawJournalRow = {
  task_id: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  old_status: string | null;
  new_status: string | null;
  changed_by: string | null;
  changed_by_telegram_id: number | null;
  created_at: string;
};

/** Строка журнала → читаемая. Старые строки без `field` — это всегда смена статуса. */
function toJournalRow(r: RawJournalRow, names: Map<number, string>): JournalRow {
  return {
    field: r.field ?? "status",
    old_value: r.old_value ?? r.old_status,
    new_value: r.new_value ?? r.new_status,
    author: r.changed_by_telegram_id
      ? (names.get(r.changed_by_telegram_id) ?? String(r.changed_by_telegram_id))
      : (r.changed_by ?? "—"),
    created_at: r.created_at,
  };
}

export async function toolGetTaskStats(args: {
  period?: string;
  since?: string;
  assignee?: string;
  project?: string;
  country?: string;
  requesting_user_id: number;
}): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";

  // Окно: since важнее period. Неразобранное значение — ОТКАЗ: молча подставленная неделя
  // неотличима от «за твой период столько», и отчёт руководству соврёт.
  let sinceISO: string;
  if (args.since) {
    const t = Date.parse(args.since);
    if (Number.isNaN(t)) return `Ошибка: since «${args.since}» не разобрать — нужна дата ISO (2026-09-01). Статистика НЕ посчитана.`;
    sinceISO = new Date(t).toISOString();
  } else {
    const period = args.period ?? DEFAULT_PERIOD;
    const start = periodStartISO(period);
    if (!start) return `Ошибка: period «${period}» неизвестен — допустимы day, week, month, quarter, year (или since с датой). Статистика НЕ посчитана.`;
    sinceISO = start;
  }

  let projectId: string | undefined;
  if (args.project) {
    const rows = await fetchProjectRows(groupId);
    const match = pickProjectByName(rows, args.project, args.requesting_user_id);
    if (!match) return projectNotFoundMessage(args.project, visibleProjectNames(rows, args.requesting_user_id));
    projectId = match.id;
  }

  const tasks = await listTasks({
    country: args.country,
    assigneeText: args.assignee,
    projectId,
    viewerId: args.requesting_user_id,
    limit: STATS_TASK_CAP,
  }, groupId);

  const stats = computeTaskStats(tasks as StatsTask[], { sinceISO });
  const scope = [
    args.assignee ? `исполнитель: ${args.assignee}` : null,
    args.project ? `проект: ${args.project}` : null,
    args.country ? `рынок: ${args.country}` : null,
  ].filter(Boolean).join(", ");
  const label = args.since ? "период" : (args.period ?? DEFAULT_PERIOD);
  return formatTaskStats(stats, { label, scope: scope || undefined });
}

export async function toolGetTaskHistory(args: { task_id: string; requesting_user_id: number }): Promise<string> {
  const task = await getTask(args.task_id);
  const groupId = await resolveGroupId(args.requesting_user_id);
  const denied = taskAccessError(
    args.task_id, task, args.requesting_user_id,
    args.requesting_user_id === ADMIN_USER_ID, groupId ?? null,
  );
  if (denied) return denied;

  const { data, error } = await supabase
    .from("task_history")
    .select("task_id, field, old_value, new_value, old_status, new_status, changed_by, changed_by_telegram_id, created_at")
    .eq("task_id", args.task_id)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("task_history read failed:", error);
    return "Ошибка: не удалось загрузить историю задачи.";
  }
  const raw = (data ?? []) as RawJournalRow[];
  const names = await resolveAuthors(
    [...new Set(raw.map((r) => r.changed_by_telegram_id).filter((x): x is number => !!x))],
  );
  return formatTaskHistory(raw.map((r) => toJournalRow(r, names)), { title: task?.title });
}

export async function toolGetRecentTaskChanges(
  args: { since?: string; limit?: number; requesting_user_id: number },
): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  if (!groupId) return "Ошибка: пользователь не найден в системе.";

  let sinceISO: string;
  if (args.since === undefined) {
    sinceISO = periodStartISO(DEFAULT_PERIOD)!;
  } else {
    const t = Date.parse(args.since);
    if (Number.isNaN(t)) return `Ошибка: since «${args.since}» не разобрать — нужна дата ISO (2026-09-09 или 2026-09-09T07:00:00Z). Изменения НЕ показаны.`;
    sinceISO = new Date(t).toISOString();
  }

  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? CHANGES_DEFAULT_LIMIT)), CHANGES_MAX_LIMIT);
  const readCap = Math.min(limit * CHANGES_READ_MULTIPLIER, CHANGES_READ_CAP);

  const { data, error } = await supabase
    .from("task_history")
    .select("task_id, field, old_value, new_value, old_status, new_status, changed_by, changed_by_telegram_id, created_at")
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(readCap);
  if (error) {
    console.error("task_history recent failed:", error);
    return "Ошибка: не удалось загрузить изменения.";
  }
  const raw = (data ?? []) as RawJournalRow[];
  if (!raw.length) return formatRecentChanges([], { sinceISO });

  // Видимость: журнал сам по себе не знает приватности — спрашиваем задачи.
  const isAdmin = args.requesting_user_id === ADMIN_USER_ID;
  const { data: taskRows } = await supabase
    .from("tasks").select("id, title, group_id, is_private, owner_id")
    .in("id", [...new Set(raw.map((r) => r.task_id))]);
  const titleById = new Map<string, string>();
  for (const t of (taskRows ?? []) as Array<{ id: string; title: string; group_id: string | null; is_private: boolean; owner_id: number | null }>) {
    if (t.group_id !== groupId) continue;
    if (!canViewTask(t, args.requesting_user_id, isAdmin)) continue;
    titleById.set(t.id, t.title);
  }

  const visible = raw.filter((r) => titleById.has(r.task_id));
  const truncated = raw.length >= readCap || visible.length > limit;
  const page = visible.slice(0, limit).reverse();
  if (!page.length) return formatRecentChanges([], { sinceISO });

  const names = await resolveAuthors(
    [...new Set(page.map((r) => r.changed_by_telegram_id).filter((x): x is number => !!x))],
  );
  const rows: RecentChangeRow[] = page.map((r) => ({
    ...toJournalRow(r, names),
    task_id: r.task_id,
    task_title: titleById.get(r.task_id) ?? r.task_id,
  }));
  return formatRecentChanges(rows, { sinceISO, truncated });
}

export const ANALYTICS_TOOL_DEFINITIONS = [
  {
    name: "get_task_stats",
    description: "Статистика по задачам за период: создано/закрыто, время от постановки до закрытия, дисциплина сроков, кто сколько закрыл, что просрочено. Фильтры по исполнителю, проекту, рынку.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["day", "week", "month", "quarter", "year"], description: "Окно статистики, по умолчанию week" },
        since: { type: "string", description: "Точная дата начала (ISO, 2026-09-01) — важнее period. Неразобранное значение = отказ, а не тихий дефолт" },
        assignee: { type: "string", description: "Имя исполнителя — считать только его задачи" },
        project: { type: "string", description: "Имя проекта или подпроекта (точные имена — get_projects)" },
        country: { type: "string", description: "Страна или рынок" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу и приватности" },
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "get_task_history",
    description: "История одной задачи: что, когда и кем менялось — статус, срок, исполнитель, проект, спринт, приоритет. ID задачи печатает get_tasks.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID задачи — полный uuid из строки задачи в get_tasks" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["task_id", "requesting_user_id"],
    },
  },
  {
    name: "get_recent_task_changes",
    description: "Все изменения по доступным задачам за период одной выдачей — «где, когда, куда передвинули». Сгруппировано по задаче, у каждой печатается id.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "С какого момента (ISO). По умолчанию — неделя. Неразобранное значение = отказ" },
        limit: { type: "number", description: "Сколько изменений показать: по умолчанию 100, максимум 400. Если больше — выдача честно скажет, что обрезана" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу и приватности" },
      },
      required: ["requesting_user_id"],
    },
  },
];
