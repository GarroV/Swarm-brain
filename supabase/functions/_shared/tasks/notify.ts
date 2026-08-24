import { canViewTask } from "./access.ts";

// Кого уведомлять о событиях задачи. Чистая функция без базы — единственный источник
// правды о круге получателей (та же логика нужна и в swarm-api, и в MCP).

export type NotifiableTask = {
  assignee_telegram_ids: number[] | null;
  created_by_telegram_id: number | null;
  owner_id: number | null;
  is_private: boolean;
};

// Тип уведомления. Расширяется вместе с check-ограничением в таблице `notifications`
// (назначения, смены статуса — см. беклог).
export type NotificationType = "task_comment";

/** Явное состояние подписки человека на задачу (строка в `task_subscriptions`). */
export type SubscriptionState = "subscribed" | "muted";

export type TaskSubscriber = {
  telegram_id: number;
  state: SubscriptionState;
  /** Признак админа ЭТОГО человека: у админа есть оверсайт над задачами (см. ниже). */
  is_admin: boolean;
  /** 'comment' — подписался участием, 'manual' — щёлкнул тумблер. Нужно для пометки в пуше. */
  reason?: "comment" | "manual";
};

// Причастные к задаче: исполнители, создатель, владелец (владелец 2026-08-24:
// «есть задачи которые я создал = мои задачи»).
export function isInvolvedInTask(task: NotifiableTask, userId: number): boolean {
  return (task.assignee_telegram_ids ?? []).includes(userId)
    || task.created_by_telegram_id === userId
    || task.owner_id === userId;
}

/**
 * Получит ли человек уведомление о комментарии к этой задаче.
 *
 * Три слоя, в порядке силы:
 * 1. `muted` — явный отказ человека. Сильнее всего: гасит уведомления, даже если он
 *    исполнитель. Иначе кнопка «отписаться» была бы бесполезной (решение владельца).
 * 2. `subscribed` — явное участие (написал комментарий) или тумблер. Видимость проверяем
 *    С УЧЁТОМ его оверсайта: админ ведёт 4-5 человек, не может обходить карточки руками, а
 *    доступ к этим задачам у него уже есть — уведомление ничего нового не открывает
 *    (решение владельца 2026-08-24, docs/decisions/2026-08-24-comment-subscription.md).
 *    Подписка возникает только из комментария, а комментарий требует доступа.
 * 3. По умолчанию — причастные к задаче, БЕЗ оверсайта (`isAdmin=false`): оверсайт про
 *    осознанный просмотр доски, а не про поток уведомлений о чужих личных задачах. Здесь
 *    ничего не поменялось — решение расширило только явные подписки.
 */
export function isCommentRecipient(
  task: NotifiableTask,
  userId: number,
  opts: { isAdmin?: boolean; subscription?: SubscriptionState | null } = {},
): boolean {
  if (opts.subscription === "muted") return false;
  if (opts.subscription === "subscribed") return canViewTask(task, userId, opts.isAdmin === true);
  return isInvolvedInTask(task, userId) && canViewTask(task, userId, false);
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
    task.owner_id,
    ...subscribers.map((s) => s.telegram_id),
  ];

  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of candidates) {
    if (!id || id === actorTelegramId || seen.has(id)) continue;
    seen.add(id);
    const sub = byId.get(id);
    if (!isCommentRecipient(task, id, { isAdmin: sub?.is_admin, subscription: sub?.state ?? null })) continue;
    out.push(id);
  }
  return out;
}
