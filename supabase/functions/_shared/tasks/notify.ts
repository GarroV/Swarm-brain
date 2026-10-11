// Кого уведомлять о событиях задачи. Чистая функция без базы — единственный источник
// правды о круге получателей (та же логика нужна и в swarm-api, и в MCP).

export type NotifiableTask = {
  assignee_telegram_ids: number[] | null;
  created_by_telegram_id: number | null;
};

// Тип уведомления. Расширяется вместе с check-ограничением в таблице `notifications`
// (назначения, смены статуса — см. беклог).
export type NotificationType = "task_comment";

/** Явное состояние подписки человека на задачу (строка в `task_subscriptions`). */
export type SubscriptionState = "subscribed" | "muted";

export type TaskSubscriber = {
  telegram_id: number;
  state: SubscriptionState;
  /** 'comment' — подписался участием, 'manual' — щёлкнул тумблер. Нужно для пометки в пуше. */
  reason?: "comment" | "manual";
};

// Причастные к задаче: исполнители и создатель (владелец 2026-08-24:
// «есть задачи которые я создал = мои задачи»).
export function isInvolvedInTask(
  task: NotifiableTask,
  userId: number,
): boolean {
  return (task.assignee_telegram_ids ?? []).includes(userId) ||
    task.created_by_telegram_id === userId;
}

/**
 * Получит ли человек уведомление о комментарии к этой задаче.
 *
 * Два слоя, в порядке силы:
 * 1. `muted` — явный отказ человека. Сильнее всего: гасит уведомления, даже если он
 *    исполнитель. Иначе кнопка «отписаться» была бы бесполезной (решение владельца).
 * 2. `subscribed` — явное участие (написал комментарий) или тумблер
 *    (docs/decisions/2026-08-24-comment-subscription.md).
 * По умолчанию — причастные к задаче. Проверки видимости здесь нет: задачу воркспейса видит
 * любой его участник (решение 2026-10-09, «личных» задач нет), а подписаться можно только на
 * задачу своего воркспейса.
 */
export function isCommentRecipient(
  task: NotifiableTask,
  userId: number,
  opts: { subscription?: SubscriptionState | null } = {},
): boolean {
  if (opts.subscription === "muted") return false;
  if (opts.subscription === "subscribed") return true;
  return isInvolvedInTask(task, userId);
}

/**
 * Круг получателей уведомления о комментарии: причастные ∪ подписавшиеся − отписавшиеся,
 * минус автор события (себе не уведомляем). Порядок детерминированный: сперва причастные
 * в порядке полей задачи, затем подписчики.
 */
export function commentRecipients(
  task: NotifiableTask,
  actorTelegramId: number,
  subscribers: TaskSubscriber[] = [],
): number[] {
  const byId = new Map<number, TaskSubscriber>();
  for (const s of subscribers) if (s.telegram_id) byId.set(s.telegram_id, s);

  const candidates = [
    ...(task.assignee_telegram_ids ?? []),
    task.created_by_telegram_id,
    ...subscribers.map((s) => s.telegram_id),
  ];

  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of candidates) {
    if (!id || id === actorTelegramId || seen.has(id)) continue;
    seen.add(id);
    const sub = byId.get(id);
    if (!isCommentRecipient(task, id, { subscription: sub?.state ?? null })) continue;
    out.push(id);
  }
  return out;
}
