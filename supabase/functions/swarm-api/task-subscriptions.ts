import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { isCommentRecipient, type NotifiableTask, type SubscriptionState } from "../_shared/tasks/notify.ts";
import { onlyLive } from "../_shared/tasks/live.ts";
import { setTaskSubscription } from "../_shared/tasks/subscription-store.ts";

// Подписка на уведомления о комментариях к задаче (issue #82).
// Канон решения — docs/decisions/2026-08-24-comment-subscription.md: комментарий подписывает,
// тумблер в карточке отписывает, отказ уважается.
//
// Роуты: GET|PATCH /tasks/:id/subscription. Возвращает null, если путь не про подписку.
//
// Таблица `task_subscriptions` хранит ИСКЛЮЧЕНИЯ, а не весь круг: нет строки = поведение по
// умолчанию (причастные получают, остальные нет). Само правило — в `_shared/tasks/notify.ts`,
// загрузка подписчиков и подписка участием — в `_shared/tasks/comment-fanout.ts` (их зовёт и MCP,
// issue #521), здесь только роуты: рукописных копий правила доступа к задачам в репозитории
// нет намеренно (issue #45 — их было шесть, и они разошлись).

type SubTaskRow = NotifiableTask & { id: string; group_id: string | null };

// Select локальный (свой набор полей). Доступ — воркспейс задачи (решение 2026-10-09).
const TASK_FIELDS = "id, group_id, assignee_telegram_ids, created_by_telegram_id";

type SubscriptionView = {
  /** null — явной строки нет, действует поведение по умолчанию */
  state: SubscriptionState | null;
  reason: "comment" | "manual" | null;
  /** Придут ли уведомления сейчас — то, что показывает тумблер */
  notified: boolean;
};

async function readState(
  supabase: SupabaseClient,
  taskId: string,
  telegramId: number,
): Promise<
  { state: SubscriptionState | null; reason: "comment" | "manual" | null }
> {
  const { data } = await supabase
    .from("task_subscriptions")
    .select("state, reason")
    .eq("task_id", taskId).eq("telegram_id", telegramId).maybeSingle();
  const row = data as
    | { state: SubscriptionState; reason: "comment" | "manual" }
    | null;
  return { state: row?.state ?? null, reason: row?.reason ?? null };
}

function view(
  task: NotifiableTask,
  telegramId: number,
  s: { state: SubscriptionState | null; reason: "comment" | "manual" | null },
): SubscriptionView {
  return {
    state: s.state,
    reason: s.reason,
    notified: isCommentRecipient(task, telegramId, { subscription: s.state }),
  };
}

export async function handleTaskSubscriptionRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  origin: string,
): Promise<Response | null> {
  const m = routePath.match(/^\/tasks\/([^/]+)\/subscription$/);
  if (!m) return null;
  const taskId = m[1];

  const { data, error } = await onlyLive(supabase.from("tasks").select(TASK_FIELDS)).eq(
    "id",
    taskId,
  ).maybeSingle();
  // Сбой чтения — не «задача не найдена» (#537): иначе тумблер молча врёт про подписку.
  if (error) {
    console.error(`[swarm-api] task subscription read: ${error.message}`);
    return json({ error: "Something went wrong. Please try again later." }, 500, origin);
  }
  const task = (data as SubTaskRow | null) ?? null;
  // 404 и на отсутствие, и на чужой воркспейс — не палим существование.
  if (!task || task.group_id !== groupId) {
    return json({ error: "Задача не найдена" }, 404, origin);
  }

  // GET — что показывать в тумблере
  if (req.method === "GET") {
    return json(
      view(
        task,
        telegramId,
        await readState(supabase, taskId, telegramId),
      ),
      200,
      origin,
    );
  }

  // PATCH { notify: boolean } — явный выбор человека (тумблер в карточке)
  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({})) as { notify?: unknown };
    if (typeof body.notify !== "boolean") {
      return json({ error: "notify: ожидается true/false" }, 400, origin);
    }
    const saved = await setTaskSubscription(supabase, taskId, telegramId, body.notify);
    if (!saved.ok) {
      console.error("task_subscriptions patch failed:", saved.cause);
      return json({ error: "Не удалось сохранить подписку" }, 500, origin);
    }
    const state = saved.state;
    return json(
      view(task, telegramId, { state, reason: "manual" }),
      200,
      origin,
    );
  }

  return null;
}
