// Видимость кандидата на дедуп при публикации черновика (issue #579). Отдельным модулем, чтобы
// правило было ядром под порчей само по себе, а не одним из сравнений большого meeting-dedup.ts.

/**
 * Кандидат той же видимости, что публикация? Личная — только личная запись самого публикующего
 * (владелец или соавтор), командная — только командная. Без `publishPrivate` — любой видимый.
 */
export function matchesPublishVisibility(
  c: { is_private: boolean | null; owner_id: number | null; shared_with: number[] | null },
  publishPrivate: boolean | undefined,
  viewerId: number | null | undefined,
): boolean {
  if (publishPrivate === undefined) return true;
  const candPrivate = c.is_private ?? false;
  if (!publishPrivate) return !candPrivate;
  if (!candPrivate || viewerId == null) return false;
  return c.owner_id === viewerId || (c.shared_with ?? []).includes(viewerId);
}
