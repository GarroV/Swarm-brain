// Перенос задачи между спринтами — серверный слой (решение владельца 22.10.2026,
// docs/decisions/2026-10-22-sprint-board-direction.md; проект —
// docs/superpowers/specs/2026-10-22-sprint-board-design.md).
//
// Правило живёт в базе (`sprint_move_task`, миграция 20261022120000): задача сразу в спринте-цели,
// в идущем — снимок с причиной, срок меняется только явной новой датой, строка под замком. Здесь
// только то, чего база не знает: доступ зрителя (как у `updateItem`) и комментарий-причина в
// задаче от его имени (тот же путь, что у причины из «Спринтов», решение 19.10.2026).
//
// Отдельно от `sprint-items.ts`: тот уже отвечает за состав и отметки, а перенос — своё действие
// со своими отказами.

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { itemTaskVisible } from "./sprint-items.ts";
import { buildReasonComment, type ReasonLang } from "./sprint-reason-comment.ts";
import { postReasonComment } from "./sprint-reason-post.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** Отказ правила переноса (нет причины, задача уже перенесена, цель не та): роут → 409 с текстом. */
export class MoveRefusedError extends Error {}

export interface MoveInput {
  groupId: string;
  /** Telegram id того, кто переносит: доступ, автор снимка и комментария. */
  viewer: number;
  /** Спринт, из которого переносят (строка обязана быть в нём). */
  cycleId: string;
  itemId: string;
  targetCycleId: string;
  reason: string;
  /** Новый срок задачи, `YYYY-MM-DD`; `null` — срок не меняется. */
  newDue: string | null;
  lang?: ReasonLang;
}

interface ItemRef {
  taskId: string;
  cycleName: string;
}

/**
 * Строка спринта, которую зритель вправе трогать: спринт в его воркспейсе, строка в этом спринте,
 * задача видна ему (закрытый проект — только тем, кто его видит). Иначе `null` — для роута 404.
 */
async function loadItem(groupId: string, cycleId: string, itemId: string, viewer: number): Promise<ItemRef | null> {
  const { data: cycle, error: cErr } = await supabase.from("sprint_cycles")
    .select("id, name").eq("id", cycleId).eq("group_id", groupId).maybeSingle();
  if (cErr) throw new Error(`sprint move cycle: ${cErr.message}`);
  if (!cycle) return null;
  const { data: item, error: iErr } = await supabase.from("sprint_items")
    .select("id, task_id").eq("id", itemId).eq("cycle_id", cycleId).maybeSingle();
  if (iErr) throw new Error(`sprint move item: ${iErr.message}`);
  const taskId = (item as { task_id: string | null } | null)?.task_id;
  if (!taskId) return null;
  if (!(await itemTaskVisible(taskId, groupId, viewer))) return null;
  return { taskId, cycleName: (cycle as { name: string }).name };
}

/**
 * Перенести задачу из идущего спринта в запланированный того же пространства. Причина
 * обязательна; срок меняется, только если пришла новая дата. Причина уходит комментарием в
 * задачу («Перенос (<спринт>): <причина>») — один раз, только после успешного переноса.
 *
 * `null` — строки нет или она не видна зрителю; `MoveRefusedError` — отказ правила.
 */
export async function moveItem(input: MoveInput): Promise<{ targetItemId: string; revived: boolean } | null> {
  const reason = input.reason.trim();
  if (!reason) throw new MoveRefusedError("Нужна причина переноса");
  const ref = await loadItem(input.groupId, input.cycleId, input.itemId, input.viewer);
  if (!ref) return null;

  const { data, error } = await supabase.rpc("sprint_move_task", {
    p_item_id: input.itemId,
    p_target_cycle_id: input.targetCycleId,
    p_reason: reason,
    p_new_due: input.newDue,
    p_actor: String(input.viewer),
  });
  if (error) {
    // P0001 — отказы самого правила (тексты для человека). Остальное — поломка, не 409.
    if (error.code === "P0001") throw new MoveRefusedError(error.message);
    throw new Error(`sprint move: ${error.message}`);
  }
  const out = (data ?? {}) as { target_item_id?: string; revived?: boolean };

  const text = buildReasonComment(
    { field: "carry_reason", before: null, after: reason, checkStatus: null },
    ref.cycleName,
    input.lang ?? "ru",
  );
  if (text) await postReasonComment(ref.taskId, input.viewer, text);

  return { targetItemId: String(out.target_item_id), revived: out.revived === true };
}

/**
 * Вписать причину в снимок, у которого её нет (перенос автоматикой: срок сменили в карточке).
 * Уже записанную причину не переписывает — её спрашивают один раз. `false` — строка не снимок,
 * причина уже есть или строка не видна зрителю.
 */
export async function setMovedReason(input: {
  groupId: string;
  viewer: number;
  cycleId: string;
  itemId: string;
  reason: string;
  lang?: ReasonLang;
}): Promise<boolean> {
  const reason = input.reason.trim();
  if (!reason) throw new MoveRefusedError("Нужна причина переноса");
  const ref = await loadItem(input.groupId, input.cycleId, input.itemId, input.viewer);
  if (!ref) return false;

  const { data, error } = await supabase.from("sprint_items")
    .update({ carry_reason: reason })
    .eq("id", input.itemId).eq("cycle_id", input.cycleId)
    .not("moved_at", "is", null)
    .or("carry_reason.is.null,carry_reason.eq.")
    .select("id").maybeSingle();
  if (error) throw new Error(`sprint moved reason: ${error.message}`);
  if (!data) return false;

  const text = buildReasonComment(
    { field: "carry_reason", before: null, after: reason, checkStatus: null },
    ref.cycleName,
    input.lang ?? "ru",
  );
  if (text) await postReasonComment(ref.taskId, input.viewer, text);
  return true;
}

/** id строки задачи в спринте — для MCP, который знает задачу, а не строку. */
export async function itemIdFor(cycleId: string, taskId: string): Promise<string | null> {
  const { data, error } = await supabase.from("sprint_items")
    .select("id").eq("cycle_id", cycleId).eq("task_id", taskId).maybeSingle();
  if (error) throw new Error(`sprint item lookup: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}
