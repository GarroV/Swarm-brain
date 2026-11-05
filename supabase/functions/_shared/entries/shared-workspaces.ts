// Кто проставляет признак принадлежности встречи (`entries.visible_group_ids`) — этап 2
// решения docs/decisions/2026-11-05-second-workspace.md.
//
// Правило одно: встреча видна в домашнем пространстве, в пространствах её участников, найденных
// по e-mail в `allowed_users`, и в пространстве публикующего. Чистая часть —
// `meetingVisibleGroupIds`, ввод-вывод — `visibleGroupIdsForMeeting`. Их зовут публикация
// (`meeting-publish.ts`) и Read.ai.
//
// Переезд человека (этап 3) ставит признак его прошлым встречам в базе, в той же транзакции, что и
// весь переезд, — функция `move_member_to_workspace` (миграция 20261105200000). Здесь его нет:
// два места с одним правилом разъехались бы.
//
// Приватность это правило не трогает: личную встречу видят владелец и `shared_with`, где бы она
// ни лежала (см. `workspace.ts`). Триггер в базе всё равно добавит домашнее и обрежет массив у
// не-встречи — здесь он не дублируется, но результат функции уже ему соответствует.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isWorkspaceId } from "./workspace.ts";

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** E-mail участников встречи: нижний регистр, без пустых и повторов. */
export function attendeeEmails(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  const out = attendees
    .map((a) => (a != null && typeof a === "object" ? normalizeEmail((a as { email?: unknown }).email) : ""))
    .filter((e) => e.includes("@"));
  return [...new Set(out)];
}

/**
 * Пространства, где видна встреча: домашнее ∪ пространства участников. Отсортировано, без
 * повторов и мусора. Нет домашнего — пусто (запись без пространства не видна нигде).
 */
export function meetingVisibleGroupIds(
  homeGroupId: string | null | undefined,
  attendeeGroupIds: ReadonlyArray<string | null | undefined>,
): string[] {
  if (!isWorkspaceId(homeGroupId)) return [];
  const all = [homeGroupId, ...attendeeGroupIds.filter(isWorkspaceId)];
  return [...new Set(all)].sort();
}

/** Пространства людей SWARM с этими e-mail (`allowed_users`). Ошибка базы — бросает. */
export async function workspacesOfEmails(
  supabase: SupabaseClient,
  emails: string[],
): Promise<string[]> {
  if (emails.length === 0) return [];
  const { data, error } = await supabase.from("allowed_users").select("group_id").in("email", emails);
  if (error) throw new Error(`allowed_users by email: ${error.message}`);
  return ((data ?? []) as Array<{ group_id: string | null }>)
    .map((r) => r.group_id)
    .filter(isWorkspaceId);
}

/**
 * Признак принадлежности для публикуемой встречи: домашнее ∪ пространства участников по e-mail ∪
 * `knownGroupIds` — пространства, известные без базы (сессия публикующего: он уже прошёл
 * `canAccessDraftMeeting`, а из чужого пространства его пускает только e-mail в составе встречи).
 *
 * Пространства записавших по `telegram_id` НЕ берём намеренно: в строку другого пространства
 * встать можно было, только зная ключ (до проверки участия в meeting-claim), — такой записавший
 * открыл бы встречу всей своей команде. Подтверждённый участник и так найден по e-mail.
 *
 * Сбой чтения `allowed_users` не роняет публикацию: остаются домашнее и `knownGroupIds`
 * (fail-closed — недоделанный признак значит «не видно второй команде», а не «видно чужим»).
 */
export async function visibleGroupIdsForMeeting(
  supabase: SupabaseClient,
  homeGroupId: string,
  attendees: unknown,
  extra: { knownGroupIds?: string[] } = {},
): Promise<string[]> {
  const known = extra.knownGroupIds ?? [];
  try {
    const byEmail = await workspacesOfEmails(supabase, attendeeEmails(attendees));
    return meetingVisibleGroupIds(homeGroupId, [...byEmail, ...known]);
  } catch (e) {
    console.error("visibleGroupIdsForMeeting: только домашнее и известные —", e instanceof Error ? e.message : e);
    return meetingVisibleGroupIds(homeGroupId, known);
  }
}

/**
 * Добавить пространства к признаку уже лежащей встречи (объединение, без потерь). Домашнее и
 * приватность не трогает. Возвращает true, если строка изменилась.
 */
export async function addVisibleGroups(
  supabase: SupabaseClient,
  entry: { id: string; group_id?: string | null; visible_group_ids?: string[] | null },
  groupIds: string[],
): Promise<boolean> {
  const current = entry.visible_group_ids ?? [];
  const next = meetingVisibleGroupIds(entry.group_id, [...current, ...groupIds]);
  if (next.length === 0 || next.every((g) => current.includes(g))) return false;
  const { error } = await supabase.from("entries").update({ visible_group_ids: next }).eq("id", entry.id);
  if (error) throw new Error(`entries visible_group_ids: ${error.message}`);
  return true;
}
