// Согласование встречи — единый патч для swarm-api (PATCH /meetings/:id {confirmed:true}) и бота
// (кнопка «mc_»). Правило: согласование меняет ТОЛЬКО признак metadata.confirmed. Видимость
// (is_private), круг «разделено с» (shared_with) и владелец (owner_id) остаются как были:
// видимость меняется только явным и охраняемым путём (canChangeMeetingPrivacy), владелец
// не назначается тем, кто согласовал.

/** Патч записи для согласования: прежняя metadata + confirmed=true, больше ничего. */
export function meetingConfirmPatch(
  metadata: Record<string, unknown> | null | undefined,
): { metadata: Record<string, unknown> } {
  return { metadata: { ...(metadata ?? {}), confirmed: true } };
}
