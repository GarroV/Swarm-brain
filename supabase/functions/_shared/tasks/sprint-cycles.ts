// Спринты: доступ к данным. Логика итогов — в `sprint-stats.ts` (чистая, под тестами),
// правила доступа — в вызывающих роутах (`swarm-api/sprint-cycles.ts`).
//
// ⚠️ Таблица `sprints` — это вкладки доски проектов. Спринты живут в `sprint_cycles`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeSprintStats, type SprintItemView } from "./sprint-stats.ts";
import { isClosedStatus } from "./statuses.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export type CycleStatus = "draft" | "active" | "accepted";

export interface SprintCycle {
  id: string;
  group_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: CycleStatus;
  created_by: string | null;
  started_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  summary: string | null;
  stats: unknown | null;
  created_at: string;
}

export interface CycleInput {
  name: string;
  start_date: string;
  end_date: string;
}

/** Задача в составе спринта: до приёмки — живая, после — из клона. */
export interface SprintItem {
  id: string;
  task_id: string | null;
  in_plan: boolean;
  added_at: string;
  title: string;
  status: string;
  assignees: string[];
  project_id: string | null;
  project: string | null;
  completed_at: string | null;
  frozen: boolean;
}

// Все операции изолированы по group_id — спринт принадлежит воркспейсу, как и всё остальное.

export async function listCycles(groupId: string): Promise<SprintCycle[]> {
  const { data } = await supabase.from("sprint_cycles")
    .select("*").eq("group_id", groupId)
    .order("start_date", { ascending: false });
  return (data ?? []) as SprintCycle[];
}

export async function getCycle(id: string, groupId: string): Promise<SprintCycle | null> {
  const { data } = await supabase.from("sprint_cycles")
    .select("*").eq("id", id).eq("group_id", groupId).maybeSingle();
  return (data as SprintCycle | null) ?? null;
}

export async function createCycle(
  input: CycleInput,
  groupId: string,
  createdBy: string | null,
): Promise<SprintCycle> {
  const { data, error } = await supabase.from("sprint_cycles").insert({
    group_id: groupId,
    name: input.name,
    start_date: input.start_date,
    end_date: input.end_date,
    status: "draft",
    created_by: createdBy,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as SprintCycle;
}

export async function updateCycle(
  id: string,
  fields: Partial<CycleInput> & { summary?: string | null },
  groupId: string,
): Promise<SprintCycle | null> {
  const { data } = await supabase.from("sprint_cycles")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as SprintCycle | null) ?? null;
}

export async function deleteCycle(id: string, groupId: string): Promise<boolean> {
  // Принятый спринт — архив, его не удаляют: иначе исчезает единственная память о периоде.
  const { data } = await supabase.from("sprint_cycles")
    .delete().eq("id", id).eq("group_id", groupId).neq("status", "accepted")
    .select("id").maybeSingle();
  return !!data;
}

/**
 * Старт спринта: всё, что сейчас в составе, становится «планом», от которого потом считается
 * процент. Добавленное позже пойдёт как «сверх плана» — именно это различие владелец просил
 * видеть в итогах, чтобы набранная по ходу мелочь не улучшала картинку.
 */
export async function startCycle(id: string, groupId: string): Promise<SprintCycle | null> {
  const cycle = await getCycle(id, groupId);
  if (!cycle || cycle.status !== "draft") return null;

  await supabase.from("sprint_items").update({ in_plan: true }).eq("cycle_id", id);
  const { data } = await supabase.from("sprint_cycles")
    .update({ status: "active", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).eq("group_id", groupId)
    .select().maybeSingle();
  return (data as SprintCycle | null) ?? null;
}

const TASK_FIELDS = "id, title, status, assignees, project_id, is_private, group_id, completed_at";

/**
 * Добавление задач в спринт.
 *
 * Возвращает, сколько строк реально добавилось: молча пропускаются чужие воркспейсы, приватные
 * задачи (отчёт спринта не должен становиться каналом утечки) и уже добавленные.
 * Статус `backlog` переводится в `open`: в спринтовом канбане колонки «Бэклог» нет — её роль
 * играет пул «Задачи» слева, и задача в статусе `backlog` не попала бы ни в одну колонку.
 */
export async function addItems(
  cycleId: string,
  taskIds: string[],
  groupId: string,
  addedBy: string | null,
): Promise<number> {
  if (taskIds.length === 0) return 0;
  const cycle = await getCycle(cycleId, groupId);
  if (!cycle || cycle.status === "accepted") return 0;

  const { data: tasks } = await supabase.from("tasks")
    .select(TASK_FIELDS)
    .in("id", taskIds).eq("group_id", groupId).eq("is_private", false);
  const allowed = (tasks ?? []) as { id: string; status: string }[];
  if (allowed.length === 0) return 0;

  const { data: existing } = await supabase.from("sprint_items")
    .select("task_id").eq("cycle_id", cycleId);
  const already = new Set((existing ?? []).map((r) => (r as { task_id: string | null }).task_id));

  const fresh = allowed.filter((t) => !already.has(t.id));
  if (fresh.length === 0) return 0;

  const { data: inserted } = await supabase.from("sprint_items").insert(
    fresh.map((t) => ({
      cycle_id: cycleId,
      task_id: t.id,
      // Спринт уже идёт — значит это «сверх плана»; в черновике план ещё не зафиксирован.
      in_plan: cycle.status === "draft",
      added_by: addedBy,
    })),
  ).select("id");

  const fromBacklog = fresh.filter((t) => t.status === "backlog").map((t) => t.id);
  if (fromBacklog.length > 0) {
    await supabase.from("tasks")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .in("id", fromBacklog);
  }

  return (inserted ?? []).length;
}

export async function removeItem(cycleId: string, taskId: string, groupId: string): Promise<boolean> {
  const cycle = await getCycle(cycleId, groupId);
  if (!cycle || cycle.status === "accepted") return false; // архив неизменен
  const { data } = await supabase.from("sprint_items")
    .delete().eq("cycle_id", cycleId).eq("task_id", taskId)
    .select("id").maybeSingle();
  return !!data;
}

/** Состав спринта: у принятого — из клона, у живого — из задач. */
export async function listItems(cycleId: string, groupId: string): Promise<SprintItem[]> {
  const cycle = await getCycle(cycleId, groupId);
  if (!cycle) return [];

  const { data: rows } = await supabase.from("sprint_items")
    .select("id, task_id, in_plan, added_at, frozen_at, frozen_title, frozen_status, frozen_assignees, frozen_project, frozen_completed_at")
    .eq("cycle_id", cycleId).order("added_at", { ascending: true });
  const items = (rows ?? []) as Record<string, unknown>[];
  if (items.length === 0) return [];

  const liveIds = items.filter((r) => !r.frozen_at && r.task_id).map((r) => r.task_id as string);
  const live = new Map<string, Record<string, unknown>>();
  if (liveIds.length > 0) {
    const { data: tasks } = await supabase.from("tasks").select(TASK_FIELDS).in("id", liveIds);
    for (const t of (tasks ?? []) as Record<string, unknown>[]) live.set(t.id as string, t);
  }

  const projectNames = await loadProjectNames(items, live);

  return items.map((r) => {
    const t = r.task_id ? live.get(r.task_id as string) : undefined;
    const frozen = !!r.frozen_at;
    const projectId = (t?.project_id as string | null) ?? null;
    return {
      id: r.id as string,
      task_id: (r.task_id as string | null) ?? null,
      in_plan: !!r.in_plan,
      added_at: r.added_at as string,
      title: frozen ? (r.frozen_title as string) : ((t?.title as string) ?? "(задача удалена)"),
      status: frozen ? (r.frozen_status as string) : ((t?.status as string) ?? "cancelled"),
      assignees: frozen ? ((r.frozen_assignees as string[]) ?? []) : ((t?.assignees as string[]) ?? []),
      project_id: projectId,
      project: frozen ? ((r.frozen_project as string | null) ?? null) : (projectId ? projectNames.get(projectId) ?? null : null),
      completed_at: frozen ? ((r.frozen_completed_at as string | null) ?? null) : ((t?.completed_at as string | null) ?? null),
      frozen,
    };
  });
}

async function loadProjectNames(
  items: Record<string, unknown>[],
  live: Map<string, Record<string, unknown>>,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of items) {
    const t = r.task_id ? live.get(r.task_id as string) : undefined;
    const pid = t?.project_id as string | null | undefined;
    if (pid) ids.add(pid);
  }
  const names = new Map<string, string>();
  if (ids.size === 0) return names;
  const { data } = await supabase.from("projects").select("id, name").in("id", [...ids]);
  for (const p of (data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);
  return names;
}

export interface AcceptResult {
  cycle: SprintCycle;
  frozen: number;
  carried: number;
}

/**
 * Приёмка спринта: замораживаем состав клоном, считаем итоги, переносим незакрытые дальше.
 *
 * Одной операцией — как `transfer_cycle_issues` у Plane: разделив приёмку и перенос на две
 * кнопки, легко получить спринт, принятый без переноса, и потерянные хвосты.
 * Живые задачи после этого живут своей жизнью: переоткрытие задачи архив не меняет.
 */
export async function acceptCycle(
  id: string,
  groupId: string,
  acceptedBy: string | null,
  opts: { summary?: string | null; nextCycleId?: string | null } = {},
): Promise<AcceptResult | null> {
  const cycle = await getCycle(id, groupId);
  if (!cycle || cycle.status === "accepted") return null;

  const items = await listItems(id, groupId);
  const now = new Date().toISOString();

  for (const it of items) {
    await supabase.from("sprint_items").update({
      frozen_at: now,
      frozen_title: it.title,
      frozen_status: it.status,
      frozen_assignees: it.assignees,
      frozen_project: it.project,
      frozen_completed_at: it.completed_at,
    }).eq("id", it.id);
  }

  const stats = computeSprintStats(items.map((it): SprintItemView => ({
    in_plan: it.in_plan,
    status: it.status,
    assignees: it.assignees,
    project: it.project,
    completed_at: it.completed_at,
  })));

  let carried = 0;
  const openIds = items.filter((it) => !isClosedStatus(it.status) && it.task_id).map((it) => it.task_id as string);
  if (opts.nextCycleId && openIds.length > 0) {
    const next = await getCycle(opts.nextCycleId, groupId);
    // В принятый спринт переносить нельзя — иначе архив, который обязан быть неизменным,
    // получит новые строки задним числом (та же проверка у Plane).
    if (next && next.status !== "accepted") {
      carried = await addItems(opts.nextCycleId, openIds, groupId, acceptedBy);
    }
  }

  const { data } = await supabase.from("sprint_cycles").update({
    status: "accepted",
    accepted_at: now,
    accepted_by: acceptedBy,
    summary: opts.summary ?? cycle.summary,
    stats,
    updated_at: now,
  }).eq("id", id).eq("group_id", groupId).select().maybeSingle();

  return { cycle: data as SprintCycle, frozen: items.length, carried };
}
