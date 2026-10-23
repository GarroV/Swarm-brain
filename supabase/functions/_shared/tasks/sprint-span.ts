// План работы задачи — серверный слой «⋯ → Спринты задачи…» (решение владельца 22.10.2026,
// docs/superpowers/specs/2026-10-22-sprint-board-design.md §«Спринты задачи…»).
//
// Правило живёт в базе (`sprint_set_task_span`, миграция 20261023120000): непрерывный отрезок
// запланированных спринтов, лишние строки снимаются только в запланированных, срок задачи не
// меняется, причина обязательна после срока и при продлении из идущего. Здесь только то, чего
// база не знает: доступ зрителя и комментарий-причина в задаче от его имени.

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { itemTaskVisible } from "./sprint-items.ts";
import { postReasonComment } from "./sprint-reason-post.ts";
import type { ReasonLang } from "./sprint-reason-comment.ts";
import { COMMENT_MAX } from "./comments.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** Отказ правила плана (нет причины, прошлый спринт, чужое пространство): роут → 409 с текстом. */
export class SpanRefusedError extends Error {}

export interface SpanInput {
  groupId: string;
  /** Telegram id того, кто ведёт план: доступ, автор строк и комментария. */
  viewer: number;
  taskId: string;
  fromCycleId: string;
  toCycleId: string;
  reason: string | null;
  lang?: ReasonLang;
}

export interface SpanResult {
  added: string[];
  removed: string[];
}

/**
 * Привести план работы задачи к отрезку спринтов `from…to`. `null` — задачи нет или она не видна
 * зрителю (роут отвечает 404); `SpanRefusedError` — отказ правила (текст для человека).
 */
export async function setTaskSpan(input: SpanInput): Promise<SpanResult | null> {
  if (!(await itemTaskVisible(input.taskId, input.groupId, input.viewer))) return null;

  const { data: from, error: fErr } = await supabase.from("sprint_cycles")
    .select("id, tab_id, name").eq("id", input.fromCycleId).eq("group_id", input.groupId).maybeSingle();
  if (fErr) throw new Error(`sprint span cycle: ${fErr.message}`);
  if (!from) throw new SpanRefusedError("Спринт не найден");
  const tabId = (from as { tab_id: string | null }).tab_id;
  if (!tabId) throw new SpanRefusedError("Спринт не в пространстве");

  const reason = input.reason?.trim() || null;
  const { data, error } = await supabase.rpc("sprint_set_task_span", {
    p_task_id: input.taskId,
    p_tab_id: tabId,
    p_group_id: input.groupId,
    p_from_cycle: input.fromCycleId,
    p_to_cycle: input.toCycleId,
    p_reason: reason,
    p_actor: String(input.viewer),
  });
  if (error) {
    // P0001 — отказы самого правила (тексты для человека). Остальное — поломка, не 409.
    if (error.code === "P0001") {
      if (error.message === "Задача не найдена") return null;
      throw new SpanRefusedError(error.message);
    }
    throw new Error(`sprint span: ${error.message}`);
  }
  const out = (data ?? {}) as { added?: string[]; removed?: string[] };
  const added = out.added ?? [];

  // Причина уходит комментарием в задачу — один раз, только если что-то добавили (иначе в
  // строках её негде хранить, и комментарий остался бы без следа в плане).
  if (reason && added.length > 0) {
    const last = added[added.length - 1];
    const { data: cycle } = await supabase.from("sprint_cycles").select("name").eq("id", last).maybeSingle();
    const name = (cycle as { name: string } | null)?.name ?? "";
    const head = `${input.lang === "en" ? "Work plan" : "План работы"} (${name}): `;
    await postReasonComment(input.taskId, input.viewer, head + reason.slice(0, COMMENT_MAX - head.length));
  }
  return { added, removed: out.removed ?? [] };
}
