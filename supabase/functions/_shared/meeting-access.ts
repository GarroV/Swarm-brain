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
// Приглядеть, у кого копится вычитка, админ может агрегатом БЕЗ контента:
// GET /admin/review-counts (имя + число).

export type DraftMeetingRow = {
  group_id?: string | null;
  recorders?: Array<{ telegram_id: number }> | null;
};

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
  const recorders = meeting.recorders ?? [];
  return recorders.some((r) => r?.telegram_id === viewerId);
}

/**
 * Фильтр очереди вычитки для запроса к БД: всегда только свои записи.
 * Возвращает значение для jsonb-containment по `recorders` (см. вызов .contains в swarm-api).
 * Параметра «показать все» нет сознательно — раньше `?all=true` у админа отдавал весь воркспейс.
 */
export function draftMeetingsOwnScoped(viewerId: number): Array<{ telegram_id: number }> {
  return [{ telegram_id: viewerId }];
}
