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
// (назначения, смены статуса, подписки — см. беклог).
export type NotificationType = "task_comment";

// Причастные к задаче: исполнители, создатель, владелец (владелец 2026-08-24:
// «есть задачи которые я создал = мои задачи»). Автор события себе не уведомляется.
//
// ⚠️ Приватная задача отфильтрована через `canViewTask`: исполнитель, который не владелец,
// открыть её не может, и уведомление показало бы ему заголовок — это утечка. Админский
// оверсайт здесь НЕ применяем (isAdmin=false): он про осознанный просмотр доски, а не про
// поток уведомлений о чужих личных задачах.
export function commentRecipients(task: NotifiableTask, actorTelegramId: number): number[] {
  const candidates = [
    ...(task.assignee_telegram_ids ?? []),
    task.created_by_telegram_id,
    task.owner_id,
  ];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of candidates) {
    if (!id || id === actorTelegramId || seen.has(id)) continue;
    if (!canViewTask(task, id, false)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
