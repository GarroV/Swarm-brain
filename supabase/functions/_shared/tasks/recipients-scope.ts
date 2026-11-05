// Границы круга получателей: уведомление о задаче уходит только тем, кто на момент отправки
// состоит в воркспейсе ЭТОЙ задачи. Люди переезжают между воркспейсами, а поля задачи
// (исполнители, создатель, подписчики) хранят telegram_id и сами не обновляются.
// Правило «кому» — чистые функции в ./notify.ts; членство проверяется здесь, на границе ввода-вывода.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Db = Pick<SupabaseClient, "from">;

/**
 * Оставляет из `ids` тех, кто сейчас в воркспейсе `groupId` (allowed_users.group_id), одним запросом.
 * Порядок и дубли входа сохраняются. Задача без воркспейса (`groupId` пуст) границы не имеет —
 * список возвращается как есть. Сбой чтения выбрасывается: «не знаю, кто свой» не должно
 * превращаться ни в рассылку всем, ни в тихое молчание.
 */
export async function onlyWorkspaceMembers(
  db: Db,
  groupId: string | null | undefined,
  ids: ReadonlyArray<number | null | undefined>,
): Promise<number[]> {
  const wanted = ids.filter((id): id is number => typeof id === "number" && id !== 0);
  if (!groupId || wanted.length === 0) return wanted;
  const { data, error } = await db
    .from("allowed_users")
    .select("telegram_id")
    .eq("group_id", groupId)
    .in("telegram_id", [...new Set(wanted)]);
  if (error) throw new Error(`workspace members load failed: ${error.message}`);
  const members = new Set((data ?? []).map((r: { telegram_id: number }) => r.telegram_id));
  return wanted.filter((id) => members.has(id));
}

/** «Состоит ли человек в воркспейсе» для набора задач разных воркспейсов (пачка крона). */
export type MembershipIndex = (groupId: string | null | undefined, telegramId: number) => boolean;

/**
 * Один запрос на воркспейс (в пачке их единицы), а не на задачу. Задача без воркспейса
 * границы не имеет — для неё индекс отвечает «да» (см. onlyWorkspaceMembers).
 */
export async function loadMembershipIndex(
  db: Db,
  items: ReadonlyArray<{ groupId: string | null | undefined; ids: ReadonlyArray<number | null | undefined> }>,
): Promise<MembershipIndex> {
  const idsByGroup = new Map<string, number[]>();
  for (const { groupId, ids } of items) {
    if (!groupId) continue;
    const bucket = idsByGroup.get(groupId) ?? [];
    for (const id of ids) if (typeof id === "number" && id !== 0) bucket.push(id);
    idsByGroup.set(groupId, bucket);
  }
  const members = new Map<string, Set<number>>();
  for (const [groupId, ids] of idsByGroup) {
    members.set(groupId, new Set(await onlyWorkspaceMembers(db, groupId, ids)));
  }
  return (groupId, telegramId) => !groupId || (members.get(groupId)?.has(telegramId) ?? false);
}
