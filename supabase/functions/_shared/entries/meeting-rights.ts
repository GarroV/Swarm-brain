// Права на ВСТРЕЧУ-запись: кто её видит, правит и удаляет. Единственный источник правды для
// swarm-api (`/meetings/:id`) и бота (действия над встречей), чтобы правило не расходилось
// между поверхностями, как это уже было с записями (см. `./access.ts`).
//
// Правило (решение владельца 30.09.2026, docs/decisions/2026-09-30-audit-fixes-scope.md):
//
//   | встреча | видит            | правит                          | удаляет            |
//   |---------|------------------|---------------------------------|--------------------|
//   | общая   | весь воркспейс   | владелец, участник, админ       | владелец, админ    |
//   | личная  | только владелец  | только владелец                 | только владелец    |
//
// Участник = его e-mail есть в `metadata.attendees` встречи — та же причастность, что у
// очереди вычитки (`buildReviewQueueQuery` в swarm-api/entries-guard.ts). Нет e-mail у
// пользователя → он не участник (fail-closed).
//
// ⛔ Личную встречу админ НЕ видит и не трогает — политика приватности (issue #15,
// docs/decisions/2026-08-21-admin-visibility.md). Админ получает права только на ОБЩИЕ встречи.
//
// Воркспейс проверяет вызывающий через `meetingAccessError` (или сам, как entries-guard).
import { canViewEntry, type EntryAccessRow } from "./access.ts";

export type MeetingRightsRow = EntryAccessRow & {
  metadata?: Record<string, unknown> | null;
};

export type MeetingViewer = {
  id: number | null | undefined;
  email?: string | null;
  isAdmin?: boolean;
};

export type MeetingAction = "view" | "edit" | "delete";

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Есть ли e-mail зрителя среди участников встречи (`metadata.attendees[].email`). */
export function isMeetingParticipant(
  entry: MeetingRightsRow,
  email: string | null | undefined,
): boolean {
  const mine = normalizeEmail(email);
  if (!mine) return false;
  const attendees = entry.metadata?.attendees;
  if (!Array.isArray(attendees)) return false;
  return attendees.some((a) =>
    a != null && typeof a === "object" &&
    normalizeEmail((a as { email?: unknown }).email) === mine
  );
}

function isOwner(entry: MeetingRightsRow, viewer: MeetingViewer): boolean {
  return viewer.id != null && entry.owner_id != null && entry.owner_id === viewer.id;
}

/** Можно ли зрителю выполнить действие над встречей (воркспейс не проверяет). */
export function canActOnMeeting(
  entry: MeetingRightsRow,
  viewer: MeetingViewer,
  action: MeetingAction,
): boolean {
  if (!canViewEntry(entry, viewer.id)) return false;
  if (action === "view") return true;
  // Личная: всё только владельцу — ни админу, ни участникам.
  if (entry.is_private) return isOwner(entry, viewer);
  if (isOwner(entry, viewer) || viewer.isAdmin === true) return true;
  if (action === "edit") return isMeetingParticipant(entry, viewer.email);
  return false;
}

/**
 * Сменить видимость встречи (общая ↔ личная) — права удаления, а не правки.
 *
 * Перевод общей встречи в личную прячет её от всей команды, в том числе от админа, — для
 * остальных это то же удаление. Поэтому участнику, который встречу правит, но не удаляет,
 * менять видимость нельзя.
 */
export function canChangeMeetingPrivacy(
  entry: MeetingRightsRow,
  viewer: MeetingViewer,
): boolean {
  return canActOnMeeting(entry, viewer, "delete");
}

/**
 * Текст отказа для поверхностей, отвечающих строкой (бот). `null` — доступ есть.
 *
 * Невидимая встреча и чужой воркспейс неотличимы от «нет такой» — как у записей
 * (`entryAccessError`). Отказ по видимой встрече назван прямо: её существование не секрет.
 */
export function meetingAccessError(
  id: string,
  entry: MeetingRightsRow | null,
  viewer: MeetingViewer,
  viewerGroupId: string | null | undefined,
  action: MeetingAction,
): string | null {
  const notFound = `Встреча ${id} не найдена.`;
  if (!entry || entry.group_id !== viewerGroupId) return notFound;
  if (!canViewEntry(entry, viewer.id)) return notFound;
  if (canActOnMeeting(entry, viewer, action)) return null;
  return action === "delete"
    ? "Запрещено: удалить встречу может только её автор или администратор."
    : "Запрещено: править встречу могут её автор, участники и администратор.";
}
