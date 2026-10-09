import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  commentRecipients,
  isInvolvedInTask,
  type NotifiableTask,
  type SubscriptionState,
  type TaskSubscriber,
} from "./notify.ts";
import { externalFetch, VIA_TELEGRAM } from "../external-fetch.ts";

// Что происходит ПОСЛЕ сохранения комментария к задаче: автор подписывается на задачу, а
// причастные и подписчики получают уведомление (колокольчик + пуш в бота).
//
// Одна реализация на все поверхности (issue #521): веб (`swarm-api/task-comments.ts`) и MCP
// (`swarm-mcp/tasks/tools.ts` → `add_task_comment`). До выноса код жил в swarm-api, и
// комментарий агента через MCP не будил ни исполнителя, ни подписчиков.
//
// Правило «кому» — чистая функция `commentRecipients` в `./notify.ts`; здесь только загрузка
// подписок, запись в `notifications` и пуш. Канон решения о подписках —
// docs/decisions/2026-08-24-comment-subscription.md.

// Превью комментария в пуше: длинный апдейт не должен разворачиваться в простыню в чате.
const PUSH_PREVIEW_MAX = 300;

const SUBSCRIPTION_HINT =
  "\n\n<i>Вы получаете это, потому что комментировали задачу. Отписаться — тумблером в её карточке.</i>";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// Окружение читается в момент вызова, а не при импорте модуля: так модуль одинаково работает в
// любой функции, куда его подключили, и проверяется тестом без перезагрузки.
async function sendTelegram(chatId: number, text: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  await externalFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }, VIA_TELEGRAM);
}

/** Подписчики задачи: кто подписан явно и кто отписался. */
export async function loadSubscribers(
  supabase: SupabaseClient,
  taskId: string,
): Promise<TaskSubscriber[]> {
  const { data, error } = await supabase
    .from("task_subscriptions")
    .select("telegram_id, state, reason")
    .eq("task_id", taskId);
  if (error) {
    console.error("task_subscriptions load failed:", error);
    return []; // мягко: без подписок круг получателей = поведение по умолчанию
  }
  const rows = (data ?? []) as Array<
    { telegram_id: number; state: SubscriptionState; reason: "comment" | "manual" }
  >;
  return rows.map((r) => ({
    telegram_id: r.telegram_id,
    state: r.state,
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

export type CommentNotificationInput = {
  task: NotifiableTask & { id: string; title: string; group_id: string | null };
  commentId: string;
  content: string;
  actorTelegramId: number;
  actorName: string;
};

// Fan-out по причастным к задаче И подписавшимся (issue #82) + пуш в бота. Best-effort: и вставка, и пуш только
// логируются при сбое — уведомление не должно ронять сам комментарий (он уже сохранён,
// а повторить запрос пользователь не может — получился бы дубль в ленте задачи).
export async function notifyTaskComment(
  supabase: SupabaseClient,
  { task, commentId, content, actorTelegramId, actorName }: CommentNotificationInput,
): Promise<void> {
  // Подписки — исключения из круга по умолчанию: добавляют непричастных (например, админа,
  // который ведёт людей и не может обходить карточки руками) и убирают отписавшихся.
  const subscribers = await loadSubscribers(supabase, task.id);
  const recipients = commentRecipients(task, actorTelegramId, subscribers);
  if (recipients.length === 0) return;

  const { error } = await supabase.from("notifications").insert(
    recipients.map((rid) => ({
      recipient_telegram_id: rid,
      group_id: task.group_id,
      type: "task_comment",
      task_id: task.id,
      comment_id: commentId,
      actor_telegram_id: actorTelegramId,
    })),
  );
  if (error) console.error("notifications insert failed:", error);

  // Ссылка «открыть задачу» в пуше. Deep-link ?task=<id> разбирается в miniapp (lib/telegram.ts).
  const origin = Deno.env.get("MINIAPP_ORIGIN") ?? "";
  const link = origin && origin !== "*" ? `\n\n<a href="${origin}/?task=${task.id}">Открыть задачу</a>` : "";
  const text = `💬 <b>${escapeHtml(actorName)}</b> — комментарий к задаче «${escapeHtml(task.title)}»\n\n` +
    escapeHtml(truncate(content, PUSH_PREVIEW_MAX)) + link;

  // Пришло ПО ПОДПИСКЕ, а не потому что задача твоя → объясняем, откуда взялось, и куда идти
  // отписываться. Иначе человек получает уведомления о задаче, к которой не причастен, и не
  // понимает почему (решение владельца: подписывать с пометкой).
  const subscribedOnly = new Set(
    subscribers
      .filter((sub) => sub.state === "subscribed" && !isInvolvedInTask(task, sub.telegram_id))
      .map((sub) => sub.telegram_id),
  );

  const results = await Promise.allSettled(
    recipients.map((rid) => sendTelegram(rid, subscribedOnly.has(rid) ? text + SUBSCRIPTION_HINT : text)),
  );
  for (const r of results) {
    // Отписался от бота / заблокировал — норма, не ошибка приложения: в колокольчике уведомление уже лежит.
    if (r.status === "rejected") console.error("notification push failed:", r.reason);
  }
}

/**
 * Всё, что следует за сохранённым комментарием, в одном вызове: подписать автора и разослать.
 * Порядок как в вебе с #82: сперва подписка, затем рассылка (автор себе не шлёт в любом случае).
 */
export async function afterTaskComment(
  supabase: SupabaseClient,
  input: CommentNotificationInput,
): Promise<void> {
  await ensureCommentSubscription(supabase, input.task.id, input.actorTelegramId);
  await notifyTaskComment(supabase, input);
}
