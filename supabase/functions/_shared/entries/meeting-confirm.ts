// Согласование встречи — единый патч для swarm-api (PATCH /meetings/:id {confirmed:true}) и бота
// (кнопка «mc_»). Правило: согласование никогда не трогает `shared_with`; `is_private` меняет
// только по явной просьбе вызывающего (publishPrivate, бот) и только владельцу; владельца
// назначает лишь при ПЕРВОМ согласовании встречи без владельца.
//
// Владелец — решение 2026-08-22 («ничьих записей быть не должно, вся информация принадлежит
// кому-то»; хозяин = согласовавший, «сохранит тот, кто успеет»), сужено: owner_id получает тот,
// кто согласует, только при ПЕРВОМ согласовании — когда `metadata.confirmed` не true и нет
// серверной отметки `metadata.confirmed_at`, а владельца нет. Отметку пишет только этот патч
// (клиент metadata целиком не присылает), и она переживает `confirmed:false`, поэтому
// «снять и поставить согласование» владельца не сбрасывает. Запись владельца — условная
// (`claimOwnerIfFree`: `owner_id IS NULL`), существующего владельца гонка не перепишет. Права на само согласование (правка встречи) проверяет
// вызывающий до патча.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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
  const patch: MeetingConfirmPatch = {
    metadata: {
      ...(entry.metadata ?? {}),
      confirmed: true,
      confirmed_at: entry.metadata?.confirmed_at ?? new Date().toISOString(),
    },
  };
  const firstConfirm = entry.metadata?.confirmed !== true && !entry.metadata?.confirmed_at;
  if (firstConfirm && entry.owner_id == null && viewer.id != null) patch.owner_id = viewer.id;
  if (
    opts?.publishPrivate && entry.is_private && !(entry.shared_with?.length) &&
    canChangeMeetingPrivacy(entry, viewer)
  ) {
    patch.is_private = false;
  }
  return patch;
}

/**
 * Записать владельца безвладельной встрече — условно (`owner_id IS NULL`): существующий
 * владелец не перезаписывается даже при гонке двух согласований.
 */
export async function claimOwnerIfFree(
  supabase: SupabaseClient,
  entryId: string,
  ownerId: number,
): Promise<void> {
  const { error } = await supabase.from("entries").update({ owner_id: ownerId }).eq("id", entryId).is("owner_id", null);
  if (error) throw new Error(`claim owner: ${error.message}`);
}
