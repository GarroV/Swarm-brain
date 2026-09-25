// Доступ к ЧЕРНОВИКУ встречи на вычитке (таблица `meetings`, status=awaiting_review).
//
// Правило (решение владельца 2026-08-20): черновик видит ТОЛЬКО тот, кто его записал.
// Админ — НЕ исключение. Это сырая запись чужого разговора: полный транскрипт, ещё не вычитанный
// и не опубликованный автором. До этого админ мог открыть чужой черновик целиком и даже
// опубликовать его за автора; проверено на проде — открывались 834 сегмента живого разговора
// коллеги.
//
// Согласуется с политикой приватных записей/встреч (`entries`, is_private) — там admin-байпаса
// тоже нет (решение владельца 2026-08-07). Отличие от ЗАДАЧ: у задач оверсайт админа сохранён
// намеренно, см. `_shared/tasks/access.ts`.
//
// Совладельцы (решение владельца 2026-09-25, п. 26–27 журнала cards-in-panel): участники встречи,
// у которых есть SWARM, тоже владельцы черновика — `co_owners`, считаются при claim
// (`_shared/meeting-owners.ts`). Видят и вычитывают; удалить черновик может только записавший.
// Встречу с несколькими владельцами публикуют только в общую базу.
//
// Приглядеть, у кого копится вычитка, админ может агрегатом БЕЗ контента:
// GET /admin/review-counts (имя + число).

export type DraftMeetingRow = {
  group_id?: string | null;
  recorders?: Array<{ telegram_id: number }> | null;
  co_owners?: number[] | null;
};

const recorderIds = (m: DraftMeetingRow): number[] =>
  (m.recorders ?? []).map((r) => r?.telegram_id).filter((id): id is number => typeof id === "number");

/**
 * Может ли `viewerId` открыть черновик. `isAdmin` принимается, чтобы вызывающему не приходилось
 * гадать, нужен ли он, — и намеренно НЕ влияет на результат: так видно, что оверсайт здесь
 * рассмотрен и отклонён, а не забыт.
 */
export function canAccessDraftMeeting(
  meeting: DraftMeetingRow | null | undefined,
  viewerId: number,
  _isAdmin: boolean,
  viewerGroupId: string | null | undefined,
): boolean {
  if (!meeting) return false;
  if (!viewerGroupId || meeting.group_id !== viewerGroupId) return false;
  return recorderIds(meeting).includes(viewerId) || (meeting.co_owners ?? []).includes(viewerId);
}

/** Удалить черновик может только записавший (запустил бота или рекордер), не совладелец. */
export function canDeleteDraftMeeting(meeting: DraftMeetingRow | null | undefined, viewerId: number): boolean {
  return !!meeting && recorderIds(meeting).includes(viewerId);
}

/** Больше одного владельца — тогда публикация только в общую базу. */
export function hasCoOwners(meeting: DraftMeetingRow): boolean {
  return new Set([...recorderIds(meeting), ...(meeting.co_owners ?? [])]).size > 1;
}

/**
 * Фильтр очереди вычитки для запроса к БД (`.or(...)`): только черновики, где смотрящий записывал
 * или стал совладельцем. Параметра «показать все» нет сознательно — раньше `?all=true` у админа
 * отдавал весь воркспейс. viewerId — число из токена, в фильтр не попадает ничего чужого.
 */
export function draftMeetingsOwnScopedFilter(viewerId: number): string {
  const id = Math.trunc(viewerId);
  return `recorders.cs.[{"telegram_id":${id}}],co_owners.cs.{${id}}`;
}
