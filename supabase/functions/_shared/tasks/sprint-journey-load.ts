// Загрузка данных «Хода задачи» (решение владельца 22.10.2026) и вызов чистой `buildJourney`.
// Доступ — как у карточки задачи: задача этого воркспейса и видна зрителю по её проекту; иначе
// `null` (роут отвечает 404, о существовании чужой приватной задачи не сообщаем).

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { taskVisibleByProject } from "./project-visibility.ts";
import { resolvePersonNames } from "../users/display-name.ts";
import {
  buildJourney,
  type DueChange,
  type Journey,
  type JourneyComment,
  type JourneyCycle,
  type JourneyRow,
} from "./sprint-journey.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export async function loadJourney(taskId: string, groupId: string, viewer: number): Promise<Journey | null> {
  const { data: task, error } = await supabase.from("tasks")
    .select("id, title, status, due_date, completed_at, group_id, project_id")
    .eq("id", taskId).is("archived_at", null).maybeSingle();
  if (error) throw new Error(`sprint journey task: ${error.message}`);
  const t = task as {
    id: string;
    title: string;
    status: string;
    due_date: string | null;
    completed_at: string | null;
    group_id: string | null;
    project_id: string | null;
  } | null;
  if (!t || t.group_id !== groupId || !(await taskVisibleByProject(t, viewer))) return null;

  const { data: items, error: iErr } = await supabase.from("sprint_items")
    .select("cycle_id, moved_at, moved_to, moved_by, carry_reason, withdrawn_at, plan_reason")
    .eq("task_id", taskId);
  if (iErr) throw new Error(`sprint journey items: ${iErr.message}`);
  const rows = (items ?? []) as Array<Omit<JourneyRow, "moved_to_cycle_id"> & { moved_to: string | null }>;

  // Цель переноса — строка спринта-цели: её спринт берём через неё.
  const targetIds = rows.map((r) => r.moved_to).filter((x): x is string => !!x);
  const targetCycle = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data: tr, error: tErr } = await supabase.from("sprint_items")
      .select("id, cycle_id").in("id", targetIds);
    if (tErr) throw new Error(`sprint journey targets: ${tErr.message}`);
    for (const r of (tr ?? []) as Array<{ id: string; cycle_id: string }>) targetCycle.set(r.id, r.cycle_id);
  }

  const cycleIds = [...new Set([...rows.map((r) => r.cycle_id), ...targetCycle.values()])];
  let cycles: JourneyCycle[] = [];
  if (cycleIds.length > 0) {
    const { data: cs, error: cErr } = await supabase.from("sprint_cycles")
      .select("id, name, start_date, end_date, status").in("id", cycleIds).eq("group_id", groupId);
    if (cErr) throw new Error(`sprint journey cycles: ${cErr.message}`);
    cycles = (cs ?? []) as JourneyCycle[];
  }
  const known = new Set(cycles.map((c) => c.id));

  const { data: cm, error: mErr } = await supabase.from("task_comments")
    .select("id, content, added_by, added_by_telegram_id, created_at").eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (mErr) throw new Error(`sprint journey comments: ${mErr.message}`);
  const rawComments = (cm ?? []) as Array<
    { id: string; content: string; added_by: string; added_by_telegram_id: number | null; created_at: string }
  >;
  const names = await resolvePersonNames(
    supabase,
    rawComments.map((c) => c.added_by_telegram_id).filter((x): x is number => typeof x === "number"),
  );
  const comments: JourneyComment[] = rawComments.map((c) => ({
    id: c.id,
    content: c.content,
    added_by: (c.added_by_telegram_id !== null ? names.get(c.added_by_telegram_id) : undefined) ?? c.added_by,
    created_at: c.created_at,
  }));

  const { data: hist, error: hErr } = await supabase.from("task_history")
    .select("old_value, new_value, created_at").eq("task_id", taskId).eq("field", "due_date")
    .order("created_at", { ascending: true });
  if (hErr) throw new Error(`sprint journey history: ${hErr.message}`);

  return buildJourney({
    task: t,
    rows: rows.filter((r) => known.has(r.cycle_id)).map((r) => ({
      cycle_id: r.cycle_id,
      moved_at: r.moved_at,
      moved_to_cycle_id: r.moved_to ? targetCycle.get(r.moved_to) ?? null : null,
      moved_by: r.moved_by,
      carry_reason: r.carry_reason,
      withdrawn_at: r.withdrawn_at,
      plan_reason: r.plan_reason,
    })),
    cycles,
    comments,
    dueChanges: (hist ?? []) as DueChange[],
    now: Date.now(),
  });
}
