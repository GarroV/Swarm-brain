/**
 * Куда класть встречу, приехавшую вебхуком Read.ai.
 *
 * До 16.09.2026 воркспейс был зашит строкой `group_id: "cee"` в двух местах (issue #56) — при
 * том что CLAUDE.md приводит ИМЕННО этот файл как пример запрещённого. Ошибка тихая: `workspaces.id`
 * — опаковый слаг, оторванный от названия (в проде `id=cee`, `name="IMF BD"`), поэтому появление
 * второго воркспейса или смена слага ничего не уронят, а просто перемешают данные двух команд —
 * вместе со стенограммами.
 *
 * Решение вынесено чистой функцией, чтобы его можно было проверить без базы и вебхука.
 * Вебхук приходит от сервиса, конкретного зрителя у него нет, поэтому личность берём от
 * участников встречи: их e-mail'ы ищутся в `allowed_users`, а сюда приходят найденные `group_id`.
 */
export type GroupResolution =
  | { ok: true; groupId: string; via: "participants" | "config" }
  | { ok: false; reason: string };

/**
 * — участники однозначно указывают на ОДИН воркспейс → он;
 * — участники указывают на РАЗНЫЕ → отказ: чья это встреча, угадывать нельзя;
 * — участников не нашли, но воркспейс задан `READAI_DEFAULT_GROUP_ID` → он (осознанно
 *   выставленное значение, а не догадка кода);
 * — нет ни того, ни другого → отказ.
 *
 * Отказ здесь важнее удобства: уехавшая не туда встреча не падает и никем не замечается,
 * а лежит в чужой команде. Потерянную встречу видно сразу, чужую — нет.
 */
export function resolveWebhookGroupId(
  memberGroupIds: Array<string | null | undefined>,
  configured: string | null | undefined,
): GroupResolution {
  const distinct = [...new Set(
    memberGroupIds.filter((g): g is string => typeof g === "string" && g.trim().length > 0).map((g) => g.trim()),
  )];
  if (distinct.length === 1) return { ok: true, groupId: distinct[0], via: "participants" };
  if (distinct.length > 1) {
    return {
      ok: false,
      reason: `участники встречи из разных воркспейсов (${distinct.join(", ")}) — какой из них её, неизвестно`,
    };
  }
  const fallback = (configured ?? "").trim();
  if (fallback) return { ok: true, groupId: fallback, via: "config" };
  return {
    ok: false,
    reason: "ни один участник встречи не найден в allowed_users, а READAI_DEFAULT_GROUP_ID не задан",
  };
}
