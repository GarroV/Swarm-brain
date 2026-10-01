// Кто может спросить по встрече (`POST /meetings/:id/ask`, `/agent-meetings/:id/ask`).
// Отдельным модулем без базы — это правило доступа, и его держат тесты и порча
// (scripts/core-paths.txt).
import { canViewEntry, type EntryAccessRow } from "../_shared/entries/access.ts";
import { canAccessDraftMeeting, type DraftMeetingRow } from "../_shared/meeting-access.ts";

/**
 * Можно ли спросить по встрече. `entry` — опубликованная запись (null для черновика), `meeting` —
 * строка meetings с владельцами черновика.
 *
 * Владельцы черновика спрашивают всегда. Кроме них — тот, кому видна ЛИЧНАЯ запись этой встречи
 * (тем же правилом `canViewEntry`, что и сама видимость): у личной записи круг видящих и есть
 * круг участников — владелец и второй участник встречи 1-1. По общей записи остальные не
 * спрашивают: они видят тезисы, но не сырую запись.
 */
export function canAskAboutMeeting(
  entry: EntryAccessRow | null,
  meeting: DraftMeetingRow | null,
  viewerId: number,
  viewerGroupId: string,
): boolean {
  if (!meeting) return false;
  if (canAccessDraftMeeting(meeting, viewerId, false, viewerGroupId)) return true;
  if (!entry || meeting.group_id !== viewerGroupId) return false;
  return entry.is_private && canViewEntry(entry, viewerId);
}
