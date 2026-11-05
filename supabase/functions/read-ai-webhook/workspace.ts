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
  | {
    ok: true;
    /** Домашнее пространство встречи. */
    groupId: string;
    /** Где встреча видна: домашнее + пространства остальных участников (`visible_group_ids`). */
    visibleGroupIds: string[];
    via: "participants" | "owner" | "majority" | "config";
  }
  | { ok: false; reason: string };

/** Найденный в `allowed_users` участник: его e-mail и пространство. */
export type WebhookMember = { email?: string | null; group_id?: string | null };

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * — участники однозначно указывают на ОДИН воркспейс → он;
 * — участники из РАЗНЫХ воркспейсов (общая встреча двух команд, этап 2 решения
 *   docs/decisions/2026-11-05-second-workspace.md) → встреча сохраняется, а не отклоняется:
 *   домашнее — пространство владельца встречи в Read.ai (`ownerEmail`), если он среди найденных;
 *   иначе — пространство, где больше всего участников (ничья — меньший id, детерминированно).
 *   Остальные пространства уходят в признак принадлежности, встреча видна обеим командам;
 * — участников не нашли, но воркспейс задан `READAI_DEFAULT_GROUP_ID` → он (осознанно
 *   выставленное значение, а не догадка кода);
 * — нет ни того, ни другого → отказ.
 *
 * Отказ здесь важнее удобства: уехавшая не туда встреча не падает и никем не замечается,
 * а лежит в чужой команде. Потерянную встречу видно сразу, чужую — нет. Смешанный состав —
 * не «не туда»: каждая команда видит встречу, где были её люди.
 */
export function resolveWebhookGroupId(
  members: ReadonlyArray<WebhookMember>,
  configured: string | null | undefined,
  ownerEmail?: string | null,
): GroupResolution {
  // Голосует каждый человек один раз: e-mail → пространство.
  const byPerson = new Map<string, string>();
  members.forEach((m, i) => {
    const g = clean(m?.group_id);
    if (!g) return;
    const key = clean(m?.email).toLowerCase() || `#${i}`;
    byPerson.set(key, g);
  });
  const votes = new Map<string, number>();
  for (const g of byPerson.values()) votes.set(g, (votes.get(g) ?? 0) + 1);
  const distinct = [...votes.keys()].sort();

  if (distinct.length === 1) {
    return { ok: true, groupId: distinct[0], visibleGroupIds: distinct, via: "participants" };
  }
  if (distinct.length > 1) {
    const owner = byPerson.get(clean(ownerEmail).toLowerCase());
    if (owner) return { ok: true, groupId: owner, visibleGroupIds: distinct, via: "owner" };
    const top = distinct.reduce((best, g) => ((votes.get(g) ?? 0) > (votes.get(best) ?? 0) ? g : best), distinct[0]);
    return { ok: true, groupId: top, visibleGroupIds: distinct, via: "majority" };
  }
  const fallback = clean(configured);
  if (fallback) return { ok: true, groupId: fallback, visibleGroupIds: [fallback], via: "config" };
  return {
    ok: false,
    reason: "ни один участник встречи не найден в allowed_users, а READAI_DEFAULT_GROUP_ID не задан",
  };
}
