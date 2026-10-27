// Согласование встречи — единый патч для swarm-api (PATCH /meetings/:id {confirmed:true}) и бота
// (кнопка «mc_»). Правило: согласование никогда не трогает `shared_with`; `is_private` меняет
// только по явной просьбе вызывающего (publishPrivate, бот) и только владельцу; владельца
// назначает лишь при ПЕРВОМ согласовании встречи без владельца.
//
// Владелец — решение 2026-08-22 («ничьих записей быть не должно, вся информация принадлежит
// кому-то»; хозяин = согласовавший, «сохранит тот, кто успеет»), сужено: owner_id получает тот,
// кто согласует, только пока `metadata.confirmed` ещё не true и владельца нет; повторное
// согласование владельца не меняет. Права на само согласование (правка встречи) проверяет
// вызывающий до патча.
import { canChangeMeetingPrivacy, type MeetingRightsRow, type MeetingViewer } from "./meeting-rights.ts";

export type ConfirmableEntry = MeetingRightsRow & { shared_with?: number[] | null };

export type MeetingConfirmPatch = {
  metadata: Record<string, unknown>;
  owner_id?: number;
  is_private?: false;
};

/**
 * Патч записи для согласования: metadata.confirmed=true; владелец — только при первом
 * согласовании безвладельной встречи; `is_private=false` — только если `publishPrivate`, запись
 * личная без «разделено с» и зритель вправе менять видимость (`canChangeMeetingPrivacy`).
 */
export function meetingConfirmPatch(
  entry: ConfirmableEntry,
  viewer: MeetingViewer,
  opts?: { publishPrivate?: boolean },
): MeetingConfirmPatch {
  const patch: MeetingConfirmPatch = { metadata: { ...(entry.metadata ?? {}), confirmed: true } };
  const firstConfirm = entry.metadata?.confirmed !== true;
  if (firstConfirm && entry.owner_id == null && viewer.id != null) patch.owner_id = viewer.id;
  if (
    opts?.publishPrivate && entry.is_private && !(entry.shared_with?.length) &&
    canChangeMeetingPrivacy(entry, viewer)
  ) {
    patch.is_private = false;
  }
  return patch;
}
