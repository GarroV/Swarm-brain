// Исходы «не пойдёт» опроса календаря (#1244) в строки таблицы meeting_join_outcomes. Причины
// пропуска — слова бота, поэтому разбор живёт здесь, а не в общем модуле _shared/join-outcomes.ts.
import type { DispatchSkip, SkipReason } from "../_shared/calendar-dispatch.ts";
import { type OutcomeRecord, SKIP_OUTCOMES } from "../_shared/join-outcomes.ts";

// Каждая причина пропуска обязана быть исходом: новая причина без исхода здесь не соберётся.
const _SKIP_REASONS_ARE_OUTCOMES: readonly SkipReason[] = SKIP_OUTCOMES;
const _OUTCOMES_ARE_SKIP_REASONS: Record<SkipReason, true> = Object.fromEntries(
  SKIP_OUTCOMES.map((o) => [o, true]),
) as Record<SkipReason, true>;
void _SKIP_REASONS_ARE_OUTCOMES;
void _OUTCOMES_ARE_SKIP_REASONS;

/** Строки исходов по «не пойдёт» опроса календаря. Причины уровня человека — раз в час. */
export function outcomesFromSkips(
  groupId: string,
  skipped: readonly DispatchSkip[],
  nowMs: number,
): OutcomeRecord[] {
  const hour = new Date(nowMs).toISOString().slice(0, 13);
  return skipped.map((s) => ({
    group_id: groupId,
    invited_by: s.invited_by,
    meeting_id: null,
    calendar_key: s.calendar_key,
    outcome: s.reason,
    source: "calendar" as const,
    outcome_key: s.calendar_key ?? `person:${hour}`,
    detail: null,
  }));
}
