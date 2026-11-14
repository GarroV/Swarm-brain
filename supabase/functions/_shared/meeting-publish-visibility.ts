import { type DraftMeetingRow, hasCoOwners, oneOnOnePartner } from "./meeting-access.ts";

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

export type PublishVisibility =
  | { ok: true; isPrivate: boolean; sharedWith: number[] }
  | { ok: false };

/**
 * Кому будет видна публикуемая запись. Решает СЕРВЕР по составу встречи; клиент присылает
 * только «в команду» или «в личное».
 *
 * Встречу нескольких владельцев в личное не публикуем: остальные потеряли бы к ней доступ
 * (решение владельца 2026-09-25, PR #508). Исключение — 1-1 (#641, решение 30.09.2026):
 * ровно два человека, оба в SWARM. Тогда запись одна, владелец — опубликовавший, второй
 * участник — в `shared_with`, и видят её только они двое.
 */
export function resolvePublishVisibility(
  meeting: DraftMeetingRow,
  viewerId: number,
  wantsPrivate: boolean,
): PublishVisibility {
  if (!wantsPrivate) return { ok: true, isPrivate: false, sharedWith: [] };
  if (!hasCoOwners(meeting)) return { ok: true, isPrivate: true, sharedWith: [] };
  const partner = oneOnOnePartner(meeting, viewerId);
  return partner === null ? { ok: false } : { ok: true, isPrivate: true, sharedWith: [partner] };
}
