// Владельцы черновика встречи на вычитке (решение владельца 2026-09-25, п. 26–27 журнала
// cards-in-panel): записавшие (`recorders`) плюс совладельцы (`co_owners` — участники встречи
// с аккаунтом SWARM). Сервер правило держит сам (`_shared/meeting-access.ts`); здесь — только
// чтобы не показывать кнопку, которая получит отказ.

type Draft = { recorders?: Array<{ telegram_id: number }> | null; co_owners?: number[] | null };

/** Больше одного владельца — публикуется только в общую базу. */
export function hasSeveralOwners(m: Draft): boolean {
  return new Set([...(m.recorders ?? []).map((r) => r.telegram_id), ...(m.co_owners ?? [])]).size > 1;
}

/** Удалить черновик может только записавший, совладелец по приглашению — нет. */
export function canDeleteDraft(m: Draft, viewerId: number | null | undefined): boolean {
  return viewerId != null && (m.recorders ?? []).some((r) => r.telegram_id === viewerId);
}
