// Ближайшие встречи на главной (docs/decisions/2026-11-09-redesign-content-not-layout.md): чистая
// логика без React — где встать линии «сейчас», как подписать строку и какая запись рекордера
// относится к встрече из календаря (её ждёт вычитка).

import type { TodayMeeting } from "@/lib/api-types/meetings";
import type { AgentMeeting } from "@/types";

/** Запись рекордера относится к встрече календаря, если названия совпали и старт — в пределах часа. */
export const REVIEW_MATCH_WINDOW_MS = 60 * 60_000;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Черновик рекордера «на вычитке» для встречи календаря; null — такой записи нет. Встречи без названия не сопоставляются. */
export function reviewDraftFor(m: TodayMeeting, drafts: AgentMeeting[]): AgentMeeting | null {
  const title = norm(m.title);
  if (!title) return null;
  const start = new Date(m.starts_at).getTime();
  return drafts.find((d) =>
    d.status === "awaiting_review" && d.started_at != null && norm(d.title) === title &&
    Math.abs(new Date(d.started_at).getTime() - start) <= REVIEW_MATCH_WINDOW_MS
  ) ?? null;
}

/** Индекс, перед которым встаёт линия «сейчас»: первая встреча, которая ещё не началась (по признакам
 *  сервера is_past/is_now — те же, что красят строки). Линии нет, если ни одна не началась (нечего
 *  отделять) или все уже позади. */
export function nowLineIndex(meetings: TodayMeeting[]): number | null {
  const first = meetings.findIndex((m) => !m.is_past && !m.is_now);
  return first <= 0 ? null : first;
}

/** «Через 2 ч 20 мин» — минуты до старта; null, если встреча уже началась. */
export function minutesUntil(m: TodayMeeting, now: number): number | null {
  const diff = Math.round((new Date(m.starts_at).getTime() - now) / 60_000);
  return diff > 0 ? diff : null;
}

/** Ближайшая встреча, к которой можно подключиться: идущая или будущая, со ссылкой. */
export function nextJoinable(meetings: TodayMeeting[]): TodayMeeting | null {
  return meetings.find((m) => !m.is_past && m.join_url) ?? null;
}
