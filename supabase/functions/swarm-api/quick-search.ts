import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { buildEntriesQuery } from "./entries-guard.ts";
import { applyListFilters, ENTRY_LIGHT_COLUMNS, parseMeetingsListParams } from "./meetings-list.ts";
import { onlyLive } from "../_shared/tasks/live.ts";
import { listProjects } from "../_shared/tasks/projects.ts";
import {
  dropUnknownProjects,
  loadProjectVisibility,
  visibleProjectFilter,
} from "../_shared/tasks/project-visibility.ts";

// Подсказки поиска слева (решение владельца 19.10.2026, docs/decisions/2026-10-19-search-and-2fa-deadline.md §1):
//   GET /search/quick?q= — по названию: задачи, проекты, встречи, заметки. Лёгкий список без текстов.
// Права — те же, что у списков, и ТОЛЬКО через их хелперы: записи — buildEntriesQuery (воркспейс,
// приватность, архив), задачи — видимость проектов (project-visibility), проекты — listProjects.
// Ошибка здесь не падает, а показывает чужую приватную запись или задачу закрытого проекта.

/** Короче — слишком шумно: две буквы уже что-то значат, одна — нет. */
export const QUICK_MIN_CHARS = 2;
/** Сколько строк в группе. */
export const QUICK_GROUP_LIMIT = 6;
/** Потолок длины запроса. */
const MAX_QUERY_CHARS = 100;
/** Задачи берём с запасом: часть отсеет видимость проекта, остаток режется до лимита группы. */
const TASK_FETCH = QUICK_GROUP_LIMIT * 2;
const TITLE_CHARS = 80;

type Ctx = {
  supabase: SupabaseClient;
  telegramId: number;
  groupId: string | null;
  origin: string;
};

export type QuickSearchResult = {
  tasks: { id: string; title: string; status: string; due_date: string | null }[];
  projects: { id: string; name: string; emoji: string | null }[];
  meetings: { id: string; title: string; date: string | null }[];
  notes: { id: string; title: string; date: string | null }[];
};

const EMPTY: QuickSearchResult = { tasks: [], projects: [], meetings: [], notes: [] };

/** Запрос человека → чистая строка поиска; короче минимума — пустая (поиска нет). */
export function cleanQuickQuery(raw: string | null): string {
  const q = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
  return q.length >= QUICK_MIN_CHARS ? q : "";
}

/** Шаблон для ilike: `\`, `%` и `_` — обычные символы, а не подстановки. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

type EntryHit = {
  id: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  entry_date: string | null;
  created_at: string;
};

/** Название записи: metadata.title, иначе первая строка текста (как deriveEntryTitle в вебе). */
export function entryTitle(row: Pick<EntryHit, "content" | "metadata">): string {
  const t = row.metadata?.title;
  if (typeof t === "string" && t.trim()) return t.trim().slice(0, TITLE_CHARS);
  const first = (row.content ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return first.slice(0, TITLE_CHARS);
}

/** Роут /search/quick. null — путь не про подсказки, index.ts идёт дальше. */
export async function handleQuickSearchRoutes(ctx: Ctx, req: Request, routePath: string): Promise<Response | null> {
  if (routePath !== "/search/quick") return null;
  if (req.method !== "GET") return apiErr(405, "Method not allowed", ctx.origin);
  const q = cleanQuickQuery(new URL(req.url).searchParams.get("q"));
  if (!q || !ctx.groupId) return json(EMPTY, 200, ctx.origin);
  try {
    return json(await quickSearch(ctx.supabase, ctx.groupId, ctx.telegramId, q), 200, ctx.origin);
  } catch (e) {
    return serverError(ctx.origin, "search quick", e);
  }
}

export async function quickSearch(
  supabase: SupabaseClient,
  groupId: string,
  telegramId: number,
  q: string,
): Promise<QuickSearchResult> {
  const [tasks, projects, meetings, notes] = await Promise.all([
    findTasks(supabase, groupId, telegramId, q),
    findProjects(groupId, telegramId, q),
    findEntries(supabase, groupId, telegramId, q, true),
    findEntries(supabase, groupId, telegramId, q, false),
  ]);
  return { tasks, projects, meetings, notes };
}

async function findTasks(supabase: SupabaseClient, groupId: string, viewerId: number, q: string) {
  const visibility = await loadProjectVisibility(groupId, viewerId);
  let query = onlyLive(supabase.from("tasks").select("id,title,status,due_date,project_id"))
    .eq("group_id", groupId)
    .ilike("title", likePattern(q));
  const hidden = visibleProjectFilter(visibility.hidden);
  if (hidden) query = query.or(hidden);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(TASK_FETCH);
  if (error) throw new Error(`quick search tasks: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    status: string;
    due_date: string | null;
    project_id: string | null;
  }[];
  return dropUnknownProjects(rows, visibility.known).slice(0, QUICK_GROUP_LIMIT)
    .map(({ id, title, status, due_date }) => ({ id, title, status, due_date }));
}

async function findProjects(groupId: string, viewerId: number, q: string) {
  const needle = q.toLowerCase();
  const list = await listProjects(groupId, { viewerId });
  return list.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, QUICK_GROUP_LIMIT)
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji ?? null }));
}

async function findEntries(
  supabase: SupabaseClient,
  groupId: string,
  telegramId: number,
  q: string,
  meetings: boolean,
) {
  const lp = parseMeetingsListParams(new URLSearchParams({ q }), { def: QUICK_GROUP_LIMIT, max: QUICK_GROUP_LIMIT });
  let query = buildEntriesQuery(supabase, ENTRY_LIGHT_COLUMNS, { groupId, telegramId });
  // Встречи — только согласованные, как в списке «Встречи»: черновик из вычитки видят причастные.
  query = meetings
    ? query.eq("entry_type", "meeting").eq("metadata->>confirmed", "true")
    : query.neq("entry_type", "meeting");
  const { data, error } = await applyListFilters(query, lp)
    .order("created_at", { ascending: false })
    .limit(QUICK_GROUP_LIMIT);
  if (error) throw new Error(`quick search entries: ${error.message}`);
  return ((data ?? []) as unknown as EntryHit[]).map((r) => ({
    id: r.id,
    title: entryTitle(r),
    date: r.entry_date ?? r.created_at.slice(0, 10),
  }));
}
