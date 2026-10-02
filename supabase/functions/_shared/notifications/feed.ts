// Лента уведомлений человека — одна выборка для колокольчика веба (swarm-api/notifications.ts)
// и MCP (issue #518). Строго свои: фильтр по recipient_telegram_id.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canViewTask } from "../tasks/access.ts";

type Db = Pick<SupabaseClient, "from">;

export const DEFAULT_FEED_LIMIT = 30;
export const MAX_FEED_LIMIT = 100;

export type NotificationRow = {
  id: string;
  type: string;
  task_id: string | null;
  comment_id: string | null;
  actor_telegram_id: number | null;
  read_at: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
  tasks: { title: string; is_private: boolean; owner_id: number | null } | null;
  task_comments: { content: string } | null;
};

const SELECT_WITH_REFS = "id, type, task_id, comment_id, actor_telegram_id, read_at, created_at, payload, " +
  "tasks(title, is_private, owner_id), task_comments(content)";

/** Типы без задачи: содержимое события лежит в `payload`. Рассылает их SQL-функция
 *  `public.maintenance_announce()` (миграция 20260928200000). */
const SYSTEM_TYPES = new Set(["maintenance"]);

export function isSystemNotification(type: string): boolean {
  return SYSTEM_TYPES.has(type);
}

/** Лимит из запроса: число в [1, MAX], иначе дефолт. */
export function feedLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_FEED_LIMIT) : DEFAULT_FEED_LIMIT;
}

/**
 * Видимые строки ленты, новые сверху. Задачу могли сделать приватной ПОСЛЕ уведомления —
 * тогда строка выпадает (иначе заголовок утечёт задним числом). Оверсайт админа здесь
 * учитываем: см. docs/decisions/2026-08-24-comment-subscription.md.
 */
export async function loadNotificationFeed(
  db: Db,
  telegramId: number,
  isAdmin: boolean,
  limit: number,
): Promise<{ ok: true; rows: NotificationRow[] } | { ok: false; cause: unknown }> {
  const { data, error } = await db
    .from("notifications")
    .select(SELECT_WITH_REFS)
    .eq("recipient_telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, cause: error };
  const rows = (data ?? []) as unknown as NotificationRow[];
  return {
    ok: true,
    rows: rows.filter((r) => isSystemNotification(r.type) || (r.tasks && canViewTask(r.tasks, telegramId, isAdmin))),
  };
}

/** Пометить прочитанным: ids=null — всё. Чужие уведомления не пометить даже по точному id. */
export async function markNotificationsRead(
  db: Db,
  telegramId: number,
  ids: string[] | null,
): Promise<{ ok: true } | { ok: false; cause: unknown }> {
  if (ids && ids.length === 0) return { ok: true };
  let q = db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_telegram_id", telegramId)
    .is("read_at", null);
  if (ids) q = q.in("id", ids);
  const { error } = await q;
  if (error) return { ok: false, cause: error };
  return { ok: true };
}
