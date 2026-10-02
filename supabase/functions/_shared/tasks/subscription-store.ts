// Явная подписка человека на задачу — одна запись для тумблера веба и MCP (issue #519).
// Проверку «видит ли он задачу» делает вызывающий: здесь только запись выбора.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SubscriptionState } from "./notify.ts";

type Db = Pick<SupabaseClient, "from">;

export async function setTaskSubscription(
  db: Db,
  taskId: string,
  telegramId: number,
  notify: boolean,
): Promise<{ ok: true; state: SubscriptionState } | { ok: false; cause: unknown }> {
  const state: SubscriptionState = notify ? "subscribed" : "muted";
  const { error } = await db.from("task_subscriptions").upsert(
    {
      task_id: taskId,
      telegram_id: telegramId,
      state,
      reason: "manual",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "task_id,telegram_id" },
  );
  if (error) return { ok: false, cause: error };
  return { ok: true, state };
}
