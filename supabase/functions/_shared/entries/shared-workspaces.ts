// Кто проставляет признак принадлежности встречи (`entries.visible_group_ids`) — этап 2
// решения docs/decisions/2026-11-05-second-workspace.md.
//
// Правило одно: встреча видна в домашнем пространстве, в пространствах её участников, найденных
// по e-mail в `allowed_users`, и в пространствах людей черновика (записавшие, держатель записи,
// совладельцы — склейка общей встречи между пространствами). Чистая часть —
// `meetingVisibleGroupIds` и `meetingPeopleIds`, ввод-вывод — `visibleGroupIdsForMeeting`. Их зовут
// публикация (`meeting-publish.ts`) и Read.ai.
//
// `shareMeetingsOfPerson` — для переезда человека (этап 3): его прошлые встречи получают новое
// пространство в признак. Пока нигде не вызывается.
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

/** Люди черновика `meetings`: записавшие, держатель записи и совладельцы — без повторов. */
export function meetingPeopleIds(
  meeting:
    | {
      recorders?: Array<{ telegram_id?: unknown } | null> | null;
      claim_owner?: unknown;
      co_owners?: unknown[] | null;
    }
    | null
    | undefined,
): number[] {
  if (!meeting) return [];
  const raw = [
    ...(meeting.recorders ?? []).map((r) => r?.telegram_id),
    meeting.claim_owner,
    ...(meeting.co_owners ?? []),
  ];
  const ids = raw
    .map((v) => (typeof v === "string" ? Number(v) : v))
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n !== 0);
  return [...new Set(ids)];
}

/** Пространства людей SWARM с этими telegram_id (`allowed_users`). Ошибка базы — бросает. */
export async function workspacesOfPeople(
  supabase: SupabaseClient,
  telegramIds: number[],
): Promise<string[]> {
  if (telegramIds.length === 0) return [];
  const { data, error } = await supabase.from("allowed_users").select("group_id").in("telegram_id", telegramIds);
  if (error) throw new Error(`allowed_users by telegram_id: ${error.message}`);
  return ((data ?? []) as Array<{ group_id: string | null }>)
    .map((r) => r.group_id)
    .filter(isWorkspaceId);
}

/**
 * Признак принадлежности для публикуемой встречи: домашнее ∪ пространства участников по e-mail
 * ∪ пространства людей черновика (`peopleIds`: записавшие, держатель записи, совладельцы) ∪
 * `knownGroupIds` — пространства, известные без базы (сессия публикующего).
 *
 * Люди черновика нужны из-за склейки общей встречи: календарный ключ одинаков у всех, и запись
 * человека из пространства B встаёт в строку `meetings` пространства A (meeting-claim). Без них
 * B не увидел бы опубликованную встречу, которую сам записал, если его e-mail нет в календаре.
 *
 * Сбой чтения `allowed_users` не роняет публикацию: остаются домашнее и `knownGroupIds`
 * (fail-closed — недоделанный признак значит «не видно второй команде», а не «видно чужим»).
 */
export async function visibleGroupIdsForMeeting(
  supabase: SupabaseClient,
  homeGroupId: string,
  attendees: unknown,
  extra: { peopleIds?: number[]; knownGroupIds?: string[] } = {},
): Promise<string[]> {
  const known = extra.knownGroupIds ?? [];
  try {
    const [byEmail, byPerson] = await Promise.all([
      workspacesOfEmails(supabase, attendeeEmails(attendees)),
      workspacesOfPeople(supabase, extra.peopleIds ?? []),
    ]);
    return meetingVisibleGroupIds(homeGroupId, [...byEmail, ...byPerson, ...known]);
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

type ShareCandidate = { id: string; group_id: string | null; visible_group_ids: string[] | null };

const SHARE_COLUMNS = "id, group_id, visible_group_ids";

/**
 * Переезд человека (этап 3): его прошлые ОБЩИЕ встречи — где он владелец записи, участник по
 * e-mail или записавший/совладелец черновика — становятся видны в его новом пространстве.
 *
 * Личные встречи не трогаем: их и так видит только владелец/`shared_with`, а расширять круг
 * личной записи этот шаг не должен. Возвращает число изменённых записей.
 */
export async function shareMeetingsOfPerson(
  supabase: SupabaseClient,
  { email, telegramId, toGroupId }: { email: string | null; telegramId: number | null; toGroupId: string },
): Promise<number> {
  if (!isWorkspaceId(toGroupId)) throw new Error(`shareMeetingsOfPerson: недопустимое пространство «${toGroupId}»`);
  const mail = normalizeEmail(email);
  const safeMail = /^[^\s,()"']+@[^\s,()"']+$/.test(mail) ? mail : "";
  const id = typeof telegramId === "number" && Number.isInteger(telegramId) && telegramId !== 0 ? telegramId : null;
  if (!safeMail && id === null) return 0;

  // Записи из черновиков, которые человек записал или совладел (meetings.recorders/co_owners).
  const linked = new Set<string>();
  if (id !== null) {
    const { data, error } = await supabase.from("meetings").select("entry_id")
      .or(`recorders.cs.${JSON.stringify([{ telegram_id: id }])},co_owners.cs.{${id}}`)
      .not("entry_id", "is", null);
    if (error) throw new Error(`meetings by person: ${error.message}`);
    for (const r of (data ?? []) as Array<{ entry_id: string | null }>) if (r.entry_id) linked.add(r.entry_id);
  }

  const conds: string[] = [];
  if (id !== null) conds.push(`owner_id.eq.${id}`);
  if (safeMail) conds.push(`metadata->attendees.cs.[{"email":"${safeMail}"}]`);
  if (linked.size > 0) conds.push(`id.in.(${[...linked].join(",")})`);

  // archive-ok: признак ставится и архивной встрече — иначе после восстановления её снова не видно
  const { data, error } = await supabase.from("entries").select(SHARE_COLUMNS)
    .eq("entry_type", "meeting")
    .eq("is_private", false)
    .or(conds.join(","));
  if (error) throw new Error(`entries of person: ${error.message}`);

  let changed = 0;
  for (const row of (data ?? []) as ShareCandidate[]) {
    if (await addVisibleGroups(supabase, row, [toGroupId])) changed++;
  }
  return changed;
}
