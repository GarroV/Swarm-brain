import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { canViewTask } from "../_shared/tasks/access.ts";
import { isCommentRecipient, type NotifiableTask, type SubscriptionState, type TaskSubscriber } from "../_shared/tasks/notify.ts";

// Подписка на уведомления о комментариях к задаче (issue #82).
// Канон решения — docs/decisions/2026-08-24-comment-subscription.md: комментарий подписывает,
// тумблер в карточке отписывает, отказ уважается.
//
// Роуты: GET|PATCH /tasks/:id/subscription. Возвращает null, если путь не про подписку.
//
// Таблица `task_subscriptions` хранит ИСКЛЮЧЕНИЯ, а не весь круг: нет строки = поведение по
// умолчанию (причастные получают, остальные нет). Само правило — в `_shared/tasks/notify.ts`,
// здесь только загрузка и роуты: рукописных копий правила доступа к задачам в репозитории
// нет намеренно (issue #45 — их было шесть, и они разошлись).

type SubTaskRow = NotifiableTask & { id: string; group_id: string | null };

// Select локальный (свой набор полей), а ПРАВИЛО доступа общее — `canViewTask`.
const TASK_FIELDS = "id, group_id, is_private, owner_id, assignee_telegram_ids, created_by_telegram_id";

/**
 * Подписчики задачи с признаком админа каждого.
 *
 * Админство берём из `allowed_users.is_admin` — на проде флаг стоит и у суперадмина
 * (744230399), поэтому второй критерий (хардкод id) здесь не нужен и третья копия
 * константы в репозитории не появляется. Если флаг у суперадмина когда-нибудь снимут,
 * он потеряет подписочный оверсайт — заметно будет как «не приходят уведомления».
 */
export async function loadSubscribers(supabase: SupabaseClient, taskId: string): Promise<TaskSubscriber[]> {
  const { data, error } = await supabase
    .from("task_subscriptions")
    .select("telegram_id, state, reason")
    .eq("task_id", taskId);
  if (error) {
    console.error("task_subscriptions load failed:", error);
    return []; // мягко: без подписок круг получателей = поведение по умолчанию
  }
  const rows = (data ?? []) as Array<{ telegram_id: number; state: SubscriptionState; reason: "comment" | "manual" }>;
  if (rows.length === 0) return [];

  const { data: users } = await supabase
    .from("allowed_users")
    .select("telegram_id, is_admin")
    .in("telegram_id", rows.map((r) => r.telegram_id));
  const admins = new Set(
    ((users ?? []) as Array<{ telegram_id: number; is_admin: boolean | null }>)
      .filter((u) => u.is_admin === true).map((u) => u.telegram_id),
  );

  return rows.map((r) => ({
    telegram_id: r.telegram_id,
    state: r.state,
    is_admin: admins.has(r.telegram_id),
    reason: r.reason,
  }));
}

/**
 * Участие подписывает: написал комментарий — попал в подписчики.
 *
 * ignoreDuplicates → ON CONFLICT DO NOTHING: если человек ранее ОТПИСАЛСЯ, новый комментарий
 * его НЕ переподписывает. Иначе кнопка «не уведомлять» держалась бы до первой же реплики
 * (решение владельца: отказ уважаем).
 */
export async function ensureCommentSubscription(
  supabase: SupabaseClient,
  taskId: string,
  telegramId: number,
): Promise<void> {
  const { error } = await supabase
    .from("task_subscriptions")
    .upsert(
      { task_id: taskId, telegram_id: telegramId, state: "subscribed", reason: "comment" },
      { onConflict: "task_id,telegram_id", ignoreDuplicates: true },
    );
  // Best-effort: подписка не должна ронять уже сохранённый комментарий.
  if (error) console.error("task_subscriptions upsert failed:", error);
}

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
): Promise<{ state: SubscriptionState | null; reason: "comment" | "manual" | null }> {
  const { data } = await supabase
    .from("task_subscriptions")
    .select("state, reason")
    .eq("task_id", taskId).eq("telegram_id", telegramId).maybeSingle();
  const row = data as { state: SubscriptionState; reason: "comment" | "manual" } | null;
  return { state: row?.state ?? null, reason: row?.reason ?? null };
}

function view(task: NotifiableTask, telegramId: number, isAdmin: boolean,
             s: { state: SubscriptionState | null; reason: "comment" | "manual" | null }): SubscriptionView {
  return {
    state: s.state,
    reason: s.reason,
    notified: isCommentRecipient(task, telegramId, { isAdmin, subscription: s.state }),
  };
}

export async function handleTaskSubscriptionRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
): Promise<Response | null> {
  const m = routePath.match(/^\/tasks\/([^/]+)\/subscription$/);
  if (!m) return null;
  const taskId = m[1];

  const { data } = await supabase.from("tasks").select(TASK_FIELDS).eq("id", taskId).maybeSingle();
  const task = (data as SubTaskRow | null) ?? null;
  // 404 и на отсутствие, и на чужой воркспейс/приватность — не палим существование.
  if (!task || task.group_id !== groupId || !canViewTask(task, telegramId, isAdmin)) {
    return json({ error: "Задача не найдена" }, 404, origin);
  }

  // GET — что показывать в тумблере
  if (req.method === "GET") {
    return json(view(task, telegramId, isAdmin, await readState(supabase, taskId, telegramId)), 200, origin);
  }

  // PATCH { notify: boolean } — явный выбор человека (тумблер в карточке)
  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({})) as { notify?: unknown };
    if (typeof body.notify !== "boolean") return json({ error: "notify: ожидается true/false" }, 400, origin);
    const state: SubscriptionState = body.notify ? "subscribed" : "muted";
    const { error } = await supabase
      .from("task_subscriptions")
      .upsert(
        { task_id: taskId, telegram_id: telegramId, state, reason: "manual", updated_at: new Date().toISOString() },
        { onConflict: "task_id,telegram_id" },
      );
    if (error) {
      console.error("task_subscriptions patch failed:", error);
      return json({ error: "Не удалось сохранить подписку" }, 500, origin);
    }
    return json(view(task, telegramId, isAdmin, { state, reason: "manual" }), 200, origin);
  }

  return null;
}
