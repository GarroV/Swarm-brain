import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { canViewTask } from "../_shared/tasks/access.ts";
import { commentRecipients, isInvolvedInTask, type NotifiableTask } from "../_shared/tasks/notify.ts";
import { loadSubscribers } from "./task-subscriptions.ts";

// Лента уведомлений (колокольчик) + рассылка события «к твоей задаче написали комментарий».
// Роуты: GET /notifications, POST /notifications/read.
// Возвращает null, если путь не про уведомления (index.ts идёт дальше).

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
// Ссылка «открыть задачу» в пуше. Deep-link ?task=<id> разбирается в miniapp (lib/telegram.ts).
const MINIAPP_ORIGIN = Deno.env.get("MINIAPP_ORIGIN") ?? "";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
// Превью комментария в пуше: длинный апдейт не должен разворачиваться в простыню в чате.
const PUSH_PREVIEW_MAX = 300;

type NotificationRow = {
  id: string;
  type: string;
  task_id: string | null;
  comment_id: string | null;
  actor_telegram_id: number | null;
  read_at: string | null;
  created_at: string;
  tasks: { title: string; is_private: boolean; owner_id: number | null } | null;
  task_comments: { content: string } | null;
};

const SELECT_WITH_REFS =
  "id, type, task_id, comment_id, actor_telegram_id, read_at, created_at, " +
  "tasks(title, is_private, owner_id), task_comments(content)";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

async function sendTelegram(chatId: number, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

// ── Рассылка ─────────────────────────────────────────────────────────────────

export type CommentNotificationInput = {
  task: NotifiableTask & { id: string; title: string; group_id: string | null };
  commentId: string;
  content: string;
  actorTelegramId: number;
  actorName: string;
};

// Fan-out по причастным к задаче И подписавшимся (issue #82) + пуш в бота. Best-effort: и вставка, и пуш только
// логируются при сбое — уведомление не должно ронять сам комментарий (он уже сохранён,
// а повторить POST пользователь не может — получился бы дубль в ленте задачи).
export async function notifyTaskComment(
  supabase: SupabaseClient,
  { task, commentId, content, actorTelegramId, actorName }: CommentNotificationInput,
): Promise<void> {
  // Подписки — исключения из круга по умолчанию: добавляют непричастных (обычно админа,
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

  const link = MINIAPP_ORIGIN && MINIAPP_ORIGIN !== "*"
    ? `\n\n<a href="${MINIAPP_ORIGIN}/?task=${task.id}">Открыть задачу</a>`
    : "";
  const text =
    `💬 <b>${escapeHtml(actorName)}</b> — комментарий к задаче «${escapeHtml(task.title)}»\n\n` +
    escapeHtml(truncate(content, PUSH_PREVIEW_MAX)) + link;

  // Пришло ПО ПОДПИСКЕ, а не потому что задача твоя → объясняем, откуда взялось, и куда идти
  // отписываться. Иначе человек получает уведомления о задаче, к которой не причастен, и не
  // понимает почему (решение владельца: подписывать с пометкой).
  const subscribedOnly = new Set(
    subscribers
      .filter((sub) => sub.state === "subscribed" && !isInvolvedInTask(task, sub.telegram_id))
      .map((sub) => sub.telegram_id),
  );
  const hint = "\n\n<i>Вы получаете это, потому что комментировали задачу. Отписаться — тумблером в её карточке.</i>";

  const results = await Promise.allSettled(
    recipients.map((rid) => sendTelegram(rid, subscribedOnly.has(rid) ? text + hint : text)),
  );
  for (const r of results) {
    // Отписался от бота / заблокировал — норма, не ошибка приложения: в колокольчике уведомление уже лежит.
    if (r.status === "rejected") console.error("notification push failed:", r.reason);
  }
}

// ── Роуты ────────────────────────────────────────────────────────────────────

/** Ключ строки `app_settings` с объявлением о раскатке. */
export const DEPLOY_NOTICE_KEY = "deploy_notice";

type DeployNoticeValue = { at?: unknown; until?: unknown; ru?: unknown; en?: unknown };

/**
 * Объявление «скоро обновление» — едет ПРИЦЕПОМ к ленте уведомлений, которую веб и так
 * опрашивает раз в 60 с: отдельный эндпоинт означал бы отдельный поллинг ради одной строки.
 *
 * Истёкшее объявление не отдаём: `until` — страховка от плашки, которую забыли снять (упал
 * скрипт раскатки, оборвалась сессия). Сбой чтения гасит плашку, но НЕ роняет ленту:
 * уведомления важнее объявления.
 */
async function loadDeployNotice(
  supabase: SupabaseClient,
): Promise<{ at: string; until: string; ru?: string; en?: string } | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", DEPLOY_NOTICE_KEY)
    .maybeSingle();
  if (error) {
    console.error("deploy notice read failed:", error);
    return null;
  }
  const v = (data?.value ?? null) as DeployNoticeValue | null;
  if (!v || typeof v.at !== "string" || typeof v.until !== "string") return null;

  const until = new Date(v.until).getTime();
  if (Number.isNaN(until) || Number.isNaN(new Date(v.at).getTime())) return null;
  if (Date.now() >= until) return null;

  return {
    at: v.at,
    until: v.until,
    ...(typeof v.ru === "string" && v.ru ? { ru: v.ru } : {}),
    ...(typeof v.en === "string" && v.en ? { en: v.en } : {}),
  };
}

export async function handleNotificationRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  isAdmin: boolean,
  origin: string,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<Response | null> {
  if (routePath !== "/notifications" && routePath !== "/notifications/read") return null;

  // GET /notifications?limit=30 — лента (новые сверху) + счётчик непрочитанных.
  if (routePath === "/notifications" && req.method === "GET") {
    const raw = parseInt(new URL(req.url).searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    const { data, error } = await supabase
      .from("notifications")
      .select(SELECT_WITH_REFS)
      .eq("recipient_telegram_id", telegramId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("notifications list failed:", error);
      return json({ error: "Не удалось загрузить уведомления" }, 500, origin);
    }

    // Задачу могли сделать приватной ПОСЛЕ уведомления — тогда её из ленты убираем
    // (иначе заголовок утечёт задним числом). Оверсайт админа здесь УЧИТЫВАЕМ: доставку
    // решает `commentRecipients` при отправке, и если строка уже есть, значит человек
    // имел право её получить; прятать её потом от админа, который эту задачу и так видит
    // на доске, смысла нет (решение владельца 2026-08-24,
    // docs/decisions/2026-08-24-comment-subscription.md).
    const rows = (data ?? []) as unknown as NotificationRow[];
    const visible = rows.filter((r) => r.tasks && canViewTask(r.tasks, telegramId, isAdmin));

    const names = await resolveNames(
      visible.map((r) => r.actor_telegram_id).filter((x): x is number => !!x),
    );
    const items = visible.map((r) => ({
      id: r.id,
      type: r.type,
      task_id: r.task_id,
      task_title: r.tasks?.title ?? "",
      comment_id: r.comment_id,
      content: r.task_comments?.content ?? "",
      actor_telegram_id: r.actor_telegram_id,
      actor_name: r.actor_telegram_id
        ? (names.get(r.actor_telegram_id) ?? String(r.actor_telegram_id))
        : "—",
      read_at: r.read_at,
      created_at: r.created_at,
    }));
    // Счётчик — по видимым в этом же окне, чтобы бейдж не показывал то, чего в ленте нет.
    const notice = await loadDeployNotice(supabase);
    return json({ items, unread: items.filter((i) => !i.read_at).length, notice }, 200, origin);
  }

  // POST /notifications/read { ids?: string[] } — без ids помечает прочитанным всё.
  if (routePath === "/notifications/read" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null;
    if (ids && ids.length === 0) return json({ ok: true }, 200, origin);

    // Фильтр по recipient_telegram_id — чужие уведомления пометить нельзя даже по точному id.
    let q = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_telegram_id", telegramId)
      .is("read_at", null);
    if (ids) q = q.in("id", ids);
    const { error } = await q;
    if (error) {
      console.error("notifications read failed:", error);
      return json({ error: "Не удалось отметить прочитанным" }, 500, origin);
    }
    return json({ ok: true }, 200, origin);
  }

  return null;
}
