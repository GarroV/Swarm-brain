// Приёмка спринта: считаем итоги и даты здесь, а меняем данные — одной транзакцией в базе.
//
// Почему не как раньше: прежняя приёмка (#267) шла отдельными запросами — заморозить состав,
// создать следующий спринт, перенести хвосты, поставить статус. Обрыв между шагами оставлял
// принятый спринт без переноса, то есть молча потерянную работу команды на две недели вперёд.
// Теперь всё это делает `accept_sprint_cycle` под блокировкой строки спринта.
//
// Граница ответственности: цифры и даты считает TypeScript (под тестами), данные меняет SQL.
// Так правило остаётся в одном месте и проверяется без базы, а неделимость — в базе.

// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts — файлы функций
// импортируют по адресу, потому что карту собирает не тот бандлер, что раскатывает функции.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeSprintStats, type SprintItemView } from "./sprint-stats.ts";
import { nextCycleDates } from "./sprint-dates.ts";
import { getCycle, type SprintCycle } from "./sprint-cycles.ts";
import { listItems } from "./sprint-items.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export interface AcceptResult {
  cycle: SprintCycle;
  next: SprintCycle | null;
  frozen: number;
  carried: number;
  carried_manual: number;
  carried_auto: number;
}

/** Спринт не в том состоянии, чтобы его принимать: роут превращает это в 409. */
export class AcceptConflictError extends Error {}

/**
 * Приёмка: снимок состава, итоги, следующий спринт и перенос хвостов — всё или ничего.
 *
 * Итоги считаются по составу ГЛАЗАМИ АДМИНИСТРАТОРА участка — приватные задачи входят в
 * цифры, но не в тексты: иначе процент выполнения зависел бы от того, кто нажал кнопку.
 */
export async function acceptCycle(
  id: string,
  groupId: string,
  acceptedBy: string | null,
  opts: { summary?: string | null } = {},
): Promise<AcceptResult | null> {
  const cycle = await getCycle(id, groupId);
  if (!cycle) return null;
  if (cycle.status === "accepted") {
    throw new AcceptConflictError("Спринт уже принят");
  }
  if (cycle.status !== "active") {
    throw new AcceptConflictError(
      "Принять можно только идущий спринт — этот ещё черновик",
    );
  }

  const items = await listItems(id, groupId, { id: acceptedBy, isAdmin: true });
  const stats = computeSprintStats(items.map((it): SprintItemView => ({
    in_plan: it.in_plan,
    status: it.status,
    assignees: it.assignees,
    project: it.project,
    completed_at: it.completed_at,
    check_status: it.check_status,
    to_carry: it.to_carry,
    removed_at: it.removed_at,
  })));

  const next = nextCycleDates({
    name: cycle.name,
    start_date: cycle.start_date,
    end_date: cycle.end_date,
  });

  const { data, error } = await supabase.rpc("accept_sprint_cycle", {
    p_cycle_id: id,
    p_group_id: groupId,
    p_accepted_by: acceptedBy,
    p_summary: opts.summary ?? null,
    p_stats: stats,
    p_next_name: next.name,
    p_next_start: next.start_date,
    p_next_end: next.end_date,
    p_next_check: next.check_date,
  });

  if (error) {
    // P0001 — наши собственные проверки внутри функции (спринт не найден, не идёт). Всё
    // остальное — настоящая поломка, и прятать её под 409 нельзя.
    if (error.code === "P0001") throw new AcceptConflictError(error.message);
    throw new Error(error.message);
  }

  const out = (data ?? {}) as Record<string, number | string>;
  const accepted = await getCycle(id, groupId);
  const nextId = out.next_cycle_id ? String(out.next_cycle_id) : null;
  const manual = Number(out.carried_manual ?? 0);
  const auto = Number(out.carried_auto ?? 0);

  return {
    cycle: accepted ?? cycle,
    next: nextId ? await getCycle(nextId, groupId) : null,
    frozen: Number(out.frozen ?? 0),
    carried: manual + auto,
    carried_manual: manual,
    carried_auto: auto,
  };
}
