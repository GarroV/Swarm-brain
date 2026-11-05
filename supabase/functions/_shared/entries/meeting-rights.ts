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
//   | 1-1     | владелец + второй| владелец и второй участник      | только владелец    |
//
// «1-1» — личная встреча, разделённая со вторым участником (`shared_with`, #641): одна запись
// на двоих. Второй участник такой же участник разговора и правит её, но удалить запись и
// сменить её видимость может только владелец (опубликовавший).
//
// Участник = его e-mail есть в `metadata.attendees` встречи — та же причастность, что у
// очереди вычитки (`buildReviewQueueQuery` в swarm-api/entries-guard.ts). Нет e-mail у
// пользователя → он не участник (fail-closed).
//
// ⛔ Личную встречу админ НЕ видит и не трогает — политика приватности (issue #15,
// docs/decisions/2026-08-21-admin-visibility.md). Админ получает права только на ОБЩИЕ встречи.
//
// Воркспейс проверяет вызывающий через `meetingAccessError` (или сам, как entries-guard).
// Видна встреча в пространствах `visible_group_ids` (общая встреча двух команд), но права
// админа — только в ДОМАШНЕМ (`group_id`): админ другой команды общую встречу видит, а
// править и удалять не может (`MeetingViewer.groupId`).
import { canViewEntry, type EntryAccessRow } from "./access.ts";
import { isEntryVisibleInWorkspace } from "./workspace.ts";

export type MeetingRightsRow = EntryAccessRow & {
  metadata?: Record<string, unknown> | null;
};

export type MeetingViewer = {
  id: number | null | undefined;
  email?: string | null;
  isAdmin?: boolean;
  /**
   * Пространство зрителя. Права админа действуют только на встречи, ДОМАШНЕЕ пространство
   * которых — это (`entry.group_id`): общая встреча другой команды видна админу, но править и
   * удалять её он не может. Не передан — админских прав нет (fail-closed).
   */
  groupId?: string | null;
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

/** Админ ДОМАШНЕГО пространства встречи (не того, где она видна как общая). */
function isHomeAdmin(entry: MeetingRightsRow, viewer: MeetingViewer): boolean {
  return viewer.isAdmin === true && !!viewer.groupId && entry.group_id === viewer.groupId;
}

/** Можно ли зрителю выполнить действие над встречей (воркспейс не проверяет). */
export function canActOnMeeting(
  entry: MeetingRightsRow,
  viewer: MeetingViewer,
  action: MeetingAction,
): boolean {
  if (!canViewEntry(entry, viewer.id)) return false;
  if (action === "view") return true;
  // Личная: всё владельцу. Тот, с кем она разделена (1-1), — смотрит и правит, не удаляет.
  // Ни админу, ни участникам по календарю — ничего: их отсеял canViewEntry выше.
  if (entry.is_private) return isOwner(entry, viewer) || action === "edit";
  if (isOwner(entry, viewer) || isHomeAdmin(entry, viewer)) return true;
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
  if (!entry || !isEntryVisibleInWorkspace(entry, viewerGroupId)) return notFound;
  // Права админа — только в домашнем пространстве встречи; пространство берём из аргумента,
  // чтобы вызывающий не мог забыть передать его в viewer.
  const scoped: MeetingViewer = { ...viewer, groupId: viewerGroupId };
  if (!canViewEntry(entry, scoped.id)) return notFound;
  if (canActOnMeeting(entry, scoped, action)) return null;
  return action === "delete"
    ? "Запрещено: удалить встречу может только её автор или администратор."
    : "Запрещено: править встречу могут её автор, участники и администратор.";
}
