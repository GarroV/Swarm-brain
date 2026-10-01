import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { canViewTask } from "../_shared/tasks/access.ts";

// Лента уведомлений (колокольчик). Рассылку события «к твоей задаче написали комментарий» делает
// `_shared/tasks/comment-fanout.ts` — одна реализация для веба и MCP (issue #521).
// Роуты: GET /notifications, POST /notifications/read.
// Возвращает null, если путь не про уведомления (index.ts идёт дальше).

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

type NotificationRow = {
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

// ── Роуты ────────────────────────────────────────────────────────────────────

/** Типы без задачи: содержимое события лежит в `payload`. Рассылает их SQL-функция
 *  `public.maintenance_announce()` (миграция 20260928200000), а не этот модуль. */
const SYSTEM_TYPES = new Set(["maintenance"]);
function isSystemNotification(type: string): boolean {
  return SYSTEM_TYPES.has(type);
}

/** Ключ строки `app_settings` с объявлением о раскатке. */
export const DEPLOY_NOTICE_KEY = "deploy_notice";

type DeployNoticeValue = {
  kind?: unknown;
  at?: unknown;
  until?: unknown;
  ru?: unknown;
  en?: unknown;
};

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
): Promise<
  | { at: string; until: string; ru?: string; en?: string; kind?: "freeze" }
  | null
> {
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
  if (!v || typeof v.at !== "string" || typeof v.until !== "string") {
    return null;
  }

  const until = new Date(v.until).getTime();
  if (Number.isNaN(until) || Number.isNaN(new Date(v.at).getTime())) {
    return null;
  }
  if (Date.now() >= until) return null;

  return {
    at: v.at,
    until: v.until,
    ...(typeof v.ru === "string" && v.ru ? { ru: v.ru } : {}),
    ...(typeof v.en === "string" && v.en ? { en: v.en } : {}),
    // Плашка перед заморозкой (issue #609): веб подписывает её временем работ, а не «обновлением».
    ...(v.kind === "freeze" ? { kind: "freeze" as const } : {}),
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
  if (routePath !== "/notifications" && routePath !== "/notifications/read") {
    return null;
  }

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
    // Системные события (заморозка, issue #609) задачи не имеют — их видит адресат, и только.
    const visible = rows.filter((r) =>
      isSystemNotification(r.type) ||
      (r.tasks && canViewTask(r.tasks, telegramId, isAdmin))
    );

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
      actor_name: r.actor_telegram_id ? (names.get(r.actor_telegram_id) ?? String(r.actor_telegram_id)) : "—",
      read_at: r.read_at,
      created_at: r.created_at,
      ...(isSystemNotification(r.type) ? { payload: r.payload ?? {} } : {}),
    }));
    // Счётчик — по видимым в этом же окне, чтобы бейдж не показывал то, чего в ленте нет.
    const notice = await loadDeployNotice(supabase);
    return json(
      {
        items,
        unread: items.filter((i) => !i.read_at).length,
        notice,
      },
      200,
      origin,
    );
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
