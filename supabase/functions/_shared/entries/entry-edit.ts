// Права на правку и удаление записи там, где запись может оказаться и встречей, и заметкой
// (ИИ-инструмент бота `update_entry`, управление записями из чата `handlers/manage.ts`).
//
//   встреча → права встречи (`./meeting-rights.ts`, действие edit; смена видимости — права
//             удаления: владелец и админ);
//   иначе   → только автор, как у `/entries/:id` (`./access.ts`, requireOwner).
//
// Воркспейс обязателен: неизвестный воркспейс зрителя = отказ (fail-closed), в отличие от
// `entryAccessError`, который без воркспейса его не проверяет.
import { canViewEntry, entryAccessError } from "./access.ts";
import {
  canChangeMeetingPrivacy,
  meetingAccessError,
  type MeetingRightsRow,
  type MeetingViewer,
} from "./meeting-rights.ts";

export type EditableEntryRow = MeetingRightsRow & {
  entry_type?: string | null;
  source?: string | null;
};

// Те же признаки встречи, что у списков встреч в боте (`rai_saved`, `get_recent_meetings`).
const MEETING_TYPES = new Set(["meeting", "transcript"]);
const MEETING_SOURCES = new Set(["read_ai", "voice", "desktop-agent"]);

export function isMeetingEntry(entry: EditableEntryRow): boolean {
  return MEETING_TYPES.has(entry.entry_type ?? "") || MEETING_SOURCES.has(entry.source ?? "");
}

/**
 * Текст отказа или `null`, если действие разрешено.
 *
 * Встреча — права встречи (`edit`/`delete`); остальное — только автор, как у `/entries/:id`.
 * `changesPrivacy` (только для правки) — смена видимости встречи, право удаления.
 */
export function entryActionError(
  id: string,
  entry: EditableEntryRow | null,
  viewer: MeetingViewer,
  viewerGroupId: string | null | undefined,
  action: "edit" | "delete",
  opts?: { changesPrivacy?: boolean },
): string | null {
  const notFound = `Запись ${id} не найдена.`;
  if (!entry || !viewerGroupId || entry.group_id !== viewerGroupId) return notFound;
  // Невидимая запись неотличима от несуществующей — одним и тем же текстом.
  if (!canViewEntry(entry, viewer.id)) return notFound;

  if (!isMeetingEntry(entry)) {
    return entryAccessError(id, entry, viewer.id, viewerGroupId, { requireOwner: true });
  }
  const denied = meetingAccessError(id, entry, viewer, viewerGroupId, action);
  if (denied) return denied;
  if (action === "edit" && opts?.changesPrivacy && !canChangeMeetingPrivacy(entry, viewer)) {
    return "Запрещено: переносить встречу между личным и общим могут только её автор и администратор.";
  }
  return null;
}

/** Текст отказа или `null`, если править можно (см. entryActionError). */
export function entryEditError(
  id: string,
  entry: EditableEntryRow | null,
  viewer: MeetingViewer,
  viewerGroupId: string | null | undefined,
  opts?: { changesPrivacy?: boolean },
): string | null {
  return entryActionError(id, entry, viewer, viewerGroupId, "edit", opts);
}
