// Guarded read adapters for the meeting card. No writes, model calls or ingestion changes.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEntriesQuery, getEntrySecure } from "./entries-guard.ts";
import { onlyLive } from "../_shared/tasks/live.ts";
import { OPEN_STATUSES } from "../_shared/tasks/statuses.ts";
import {
  dropUnknownProjects,
  loadProjectVisibility,
  visibleProjectFilter,
} from "../_shared/tasks/project-visibility.ts";
import {
  type ContextAttendee,
  type ContextCandidate,
  type ContextTask,
  participantPeople,
} from "../_shared/meeting-participant-context.ts";

export type ContextActor = { telegramId: number; groupId: string; email: string | null };
export type ContextEntry = {
  id: string;
  metadata: Record<string, unknown>;
  countries: string[];
  entry_date: string | null;
  created_at: string;
  summary: string | null;
};
const CANDIDATE_PAGE = 100;
const CANDIDATE_PAGES = 20;
const TASKS_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANDIDATE_COLUMNS = "id,metadata,entry_date,created_at,summary:summary_preview";

export function contextAttendees(value: unknown): ContextAttendee[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a) => a && typeof a === "object").map((a) => ({
    name: typeof a.name === "string" ? a.name : undefined,
    email: typeof a.email === "string" ? a.email : undefined,
    resource: a.resource === true,
  }));
}

export function contextTitle(entry: ContextEntry): string | null {
  return typeof entry.metadata?.title === "string" ? entry.metadata.title : null;
}

/** Only metadata belonging to already visible published entries is used for this batch lookup. */
async function startTimes(sb: SupabaseClient, rows: ContextEntry[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows.map((r) => r.metadata?.meeting_id).filter((id): id is string => typeof id === "string" && UUID.test(id)),
    ),
  ];
  const times = new Map<string, string>();
  if (!ids.length) return times;
  // Keep both the response and URL below PostgREST's row/URI limits (max_rows is 1000).
  for (let offset = 0; offset < ids.length; offset += CANDIDATE_PAGE) {
    const { data, error } = await sb.from("meetings").select("id,started_at")
      .in("id", ids.slice(offset, offset + CANDIDATE_PAGE));
    if (error) throw new Error("meeting_context_start_lookup_failed");
    for (const row of data ?? []) if (row.started_at) times.set(row.id, row.started_at);
  }
  return times;
}

export function entryStartsAt(row: ContextEntry, times: Map<string, string>): string | null {
  const linked = times.get(String(row.metadata?.meeting_id ?? ""));
  const calendar = row.metadata?.calendar_event as { scheduled_start_time?: unknown } | undefined;
  const raw = linked ?? calendar?.scheduled_start_time;
  // Date.parse also accepts bare dates and local times; neither proves an event's instant.
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
  return typeof raw === "string" && instant.test(raw) && Number.isFinite(Date.parse(raw))
    ? new Date(raw).toISOString()
    : null;
}

export async function loadContextEntry(sb: SupabaseClient, actor: ContextActor, id: string) {
  const entry = await getEntrySecure(sb, id, { ...actor, requireMeeting: true });
  if (entry.metadata?.confirmed !== true) return null;
  const times = await startTimes(sb, [entry]);
  return {
    entry,
    startsAt: entryStartsAt(entry, times) ?? `${(entry.entry_date ?? entry.created_at.slice(0, 10))}T00:00:00.000Z`,
  };
}

export async function loadContextCandidates(sb: SupabaseClient, actor: ContextActor, before: string) {
  const rows: ContextEntry[] = [];
  let truncated = false;
  for (let page = 0; page < CANDIDATE_PAGES; page++) {
    const { data, error } = await buildEntriesQuery(sb, CANDIDATE_COLUMNS, actor)
      .eq("entry_type", "meeting").eq("metadata->>confirmed", "true")
      .or(`entry_date.lte.${before.slice(0, 10)},and(entry_date.is.null,created_at.lt.${before})`)
      .order("entry_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })
      .order("id", { ascending: false }).range(page * CANDIDATE_PAGE, (page + 1) * CANDIDATE_PAGE - 1);
    if (error) throw new Error("meeting_context_candidates_failed");
    const batch = (data ?? []) as unknown as ContextEntry[];
    rows.push(...batch);
    if (batch.length < CANDIDATE_PAGE) break;
    if (page === CANDIDATE_PAGES - 1) truncated = true;
  }
  const times = await startTimes(sb, rows);
  const candidates: ContextCandidate[] = rows.filter((r) => r.summary?.trim()).map((r) => ({
    id: r.id,
    title: contextTitle(r),
    date: r.entry_date ?? r.created_at.slice(0, 10),
    startsAt: entryStartsAt(r, times),
    attendees: contextAttendees(r.metadata?.attendees),
  }));
  return { candidates, truncated };
}

export async function loadParticipantTasks(
  sb: SupabaseClient,
  actor: ContextActor,
  attendees: ContextAttendee[],
  visibility = loadProjectVisibility,
): Promise<{ tasks: ContextTask[]; total: number | null; truncated: boolean }> {
  const emails = [...new Set(attendees.map((a) => (a.email ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return { tasks: [], total: 0, truncated: false };
  const { data: people, error: peopleError } = await sb.from("people")
    .select("id,email,account:allowed_users(telegram_id)").eq("group_id", actor.groupId)
    .is("archived_at", null).in("email", emails);
  if (peopleError) throw new Error("meeting_context_people_failed");
  const mapped = (people ?? []) as unknown as Array<
    { id: string; email: string | null; account: { telegram_id: number | null } | null }
  >;
  const { personIds, telegramIds } = participantPeople(
    attendees,
    mapped.map((p) => ({ ...p, telegramId: p.account?.telegram_id ?? null })),
  );
  if (!personIds.length && !telegramIds.length) return { tasks: [], total: 0, truncated: false };
  const conditions: string[] = [];
  if (personIds.length) {
    conditions.push(
      `assignee_person_id.in.(${personIds.join(",")})`,
      `coassignee_person_ids.ov.{${personIds.join(",")}}`,
    );
  }
  if (telegramIds.length) {
    conditions.push(
      `assignee_telegram_ids.ov.{${telegramIds.join(",")}}`,
      `coassignee_telegram_ids.ov.{${telegramIds.join(",")}}`,
    );
  }
  const scope = await visibility(actor.groupId, actor.telegramId);
  let q = onlyLive(sb.from("tasks").select("id,title,due_date,status,project_id", { count: "exact" }))
    .eq("group_id", actor.groupId).eq("confirmed", true).in("status", [...OPEN_STATUSES])
    .or(conditions.join(","))
    .order("due_date", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
  const projectFilter = visibleProjectFilter(scope.hidden);
  if (projectFilter) q = q.or(projectFilter);
  const { data, count, error } = await q.limit(TASKS_LIMIT + 1);
  if (error) throw new Error("meeting_context_tasks_failed");
  const rows = (data ?? []) as Array<
    { id: string; title: string; due_date: string | null; status: string; project_id: string | null }
  >;
  const visible = dropUnknownProjects(rows, scope.known);
  const dropped = rows.length - visible.length;
  return {
    tasks: visible.slice(0, TASKS_LIMIT).map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      status: t.status,
    })),
    total: dropped ? null : count,
    truncated: rows.length > TASKS_LIMIT || (typeof count === "number" && count > rows.length),
  };
}
