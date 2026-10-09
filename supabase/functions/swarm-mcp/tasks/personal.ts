// Личные MCP-инструменты: метки (#520), подписка на задачу (#519), уведомления (#518),
// встречи на сегодня (#517). Логика доступа — общая с вебом из `_shared/`, здесь только
// разбор аргументов и текст ответа агенту.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLabel, deleteLabel, type LabelFailure, updateLabel } from "../../_shared/tasks/labels.ts";
import { setTaskSubscription } from "../../_shared/tasks/subscription-store.ts";
import {
  feedLimit,
  isSystemNotification,
  loadNotificationFeed,
  markNotificationsRead,
} from "../../_shared/notifications/feed.ts";
import { todayCalendarEvents } from "../../_shared/calendar-today.ts";
import { todayMeetings } from "../../_shared/meetings-today.ts";
import { joinLink } from "../../meeting-current/join-link.ts";
import { resolvePersonNames } from "../../_shared/users/display-name.ts";
import { commentTaskGuard, resolveGroupId } from "./tools.ts";
import { type FeedItem, formatCalendarGap, formatNotifications, formatTodayMeetings } from "./personal-format.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Args = Record<string, unknown> & { requesting_user_id: number };
type ToolFn = (args: Args) => Promise<string>;

function labelFailureText(f: LabelFailure, where: string): string {
  if (f.status === 500) {
    console.error(`${where}:`, f.cause);
    return "Ошибка: не удалось сохранить метку.";
  }
  return `Ошибка: ${f.error}.`;
}

async function toolCreateTaskLabel(args: Args): Promise<string> {
  const groupId = await resolveGroupId(args.requesting_user_id);
  const r = await createLabel(supabase, args.requesting_user_id, groupId, { name: args.name });
  if (!r.ok) return labelFailureText(r, "task_labels create failed");
  return `✅ Метка «${r.value.name}» создана (id: ${r.value.id}).`;
}

async function toolRenameTaskLabel(args: Args): Promise<string> {
  const r = await updateLabel(supabase, args.requesting_user_id, String(args.label_id ?? ""), { name: args.name });
  if (!r.ok) return labelFailureText(r, "task_labels rename failed");
  return `✅ Метка переименована: «${r.value.name}».`;
}

async function toolDeleteTaskLabel(args: Args): Promise<string> {
  const r = await deleteLabel(supabase, args.requesting_user_id, String(args.label_id ?? ""));
  if (!r.ok) return labelFailureText(r, "task_labels delete failed");
  return "✅ Метка удалена и снята со всех твоих задач. Сами задачи не тронуты.";
}

async function toolSetTaskSubscription(args: Args): Promise<string> {
  if (typeof args.notify !== "boolean") return "Ошибка: notify должен быть true (следить) или false (не уведомлять).";
  // Тот же гард, что у комментариев: подписаться можно только на видимую тебе задачу.
  const guard = await commentTaskGuard(String(args.task_id ?? ""), args.requesting_user_id);
  if (!guard.ok) return guard.msg;
  const saved = await setTaskSubscription(supabase, guard.task.id, args.requesting_user_id, args.notify);
  if (!saved.ok) {
    console.error("task_subscriptions set failed:", saved.cause);
    return "Ошибка: не удалось сохранить подписку.";
  }
  return args.notify
    ? `✅ Слежу за задачей «${guard.task.title}»: новые комментарии придут уведомлением.`
    : `✅ Уведомления по задаче «${guard.task.title}» выключены.`;
}

async function toolGetNotifications(args: Args): Promise<string> {
  const me = args.requesting_user_id;
  const feed = await loadNotificationFeed(supabase, me, feedLimit(args.limit));
  if (!feed.ok) {
    console.error("notifications list failed:", feed.cause);
    return "Ошибка: не удалось загрузить уведомления.";
  }
  const names = await resolvePersonNames(supabase, feed.rows.map((r) => r.actor_telegram_id));
  const items: FeedItem[] = feed.rows.map((r) => ({
    id: r.id,
    type: r.type,
    task_id: r.task_id,
    task_title: r.tasks?.title ?? "",
    content: r.task_comments?.content ?? "",
    actor_name: r.actor_telegram_id ? (names.get(r.actor_telegram_id) ?? `#${r.actor_telegram_id}`) : "—",
    read_at: r.read_at,
    created_at: r.created_at,
    ...(isSystemNotification(r.type) ? { payload: r.payload ?? {} } : {}),
  }));
  return formatNotifications(items, args.only_unread === true);
}

async function toolMarkNotificationsRead(args: Args): Promise<string> {
  const raw = args.ids;
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : null;
  if (raw !== undefined && !Array.isArray(raw)) {
    return "Ошибка: ids — список id уведомлений (или не передавай, чтобы отметить все).";
  }
  const marked = await markNotificationsRead(supabase, args.requesting_user_id, ids);
  if (!marked.ok) {
    console.error("notifications read failed:", marked.cause);
    return "Ошибка: не удалось отметить прочитанным.";
  }
  return ids ? `✅ Отмечено прочитанными: ${ids.length}.` : "✅ Все уведомления отмечены прочитанными.";
}

async function toolGetTodayMeetings(args: Args): Promise<string> {
  const tzKnown = typeof args.tz_offset_minutes === "number" && Number.isFinite(args.tz_offset_minutes);
  const tz = tzKnown ? args.tz_offset_minutes as number : 0;
  const now = new Date();
  const cal = await todayCalendarEvents(supabase, args.requesting_user_id, tz, now);
  if (!cal.ok) return formatCalendarGap(cal.reason);
  const meetings = todayMeetings(cal.events, now, joinLink);
  // «С кем» — имена из приглашения, без себя: по ним агент ищет в базе прошлые встречи.
  const attendeesById = new Map(cal.events.map((e) => [
    e.id,
    (e.attendees ?? []).filter((a) => !a.self).map((a) => a.displayName || a.email || "").filter(Boolean),
  ]));
  return formatTodayMeetings(meetings, attendeesById, tz, tzKnown);
}

export const PERSONAL_TOOLS: Record<string, ToolFn> = {
  create_task_label: toolCreateTaskLabel,
  rename_task_label: toolRenameTaskLabel,
  delete_task_label: toolDeleteTaskLabel,
  set_task_subscription: toolSetTaskSubscription,
  get_notifications: toolGetNotifications,
  mark_notifications_read: toolMarkNotificationsRead,
  get_today_meetings: toolGetTodayMeetings,
};

const ME = { type: "number", description: "Твой Telegram user ID" };

export const PERSONAL_TOOL_DEFINITIONS = [
  {
    name: "create_task_label",
    description: "Создать личную смарт-метку (папку) задач. Метки видишь только ты.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Название метки" }, requesting_user_id: ME },
      required: ["name", "requesting_user_id"],
    },
  },
  {
    name: "rename_task_label",
    description: "Переименовать свою метку. id — из list_task_labels.",
    inputSchema: {
      type: "object",
      properties: {
        label_id: { type: "string", description: "id метки" },
        name: { type: "string", description: "Новое название" },
        requesting_user_id: ME,
      },
      required: ["label_id", "name", "requesting_user_id"],
    },
  },
  {
    name: "delete_task_label",
    description: "Удалить свою метку. Она снимается со всех твоих задач, сами задачи остаются.",
    inputSchema: {
      type: "object",
      properties: { label_id: { type: "string", description: "id метки" }, requesting_user_id: ME },
      required: ["label_id", "requesting_user_id"],
    },
  },
  {
    name: "set_task_subscription",
    description:
      "Следить за задачей (notify=true): новые комментарии к ней придут уведомлением. notify=false — выключить уведомления по задаче.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "id задачи" },
        notify: { type: "boolean", description: "true — следить, false — не уведомлять" },
        requesting_user_id: ME,
      },
      required: ["task_id", "notify", "requesting_user_id"],
    },
  },
  {
    name: "get_notifications",
    description:
      "Твои уведомления (колокольчик Swarm): кто и что написал в задачах, плановые работы. Новые сверху, у каждого id.",
    inputSchema: {
      type: "object",
      properties: {
        only_unread: { type: "boolean", description: "Только непрочитанные" },
        limit: { type: "number", description: "Сколько последних, по умолчанию 30, максимум 100" },
        requesting_user_id: ME,
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "mark_notifications_read",
    description: "Отметить уведомления прочитанными. Без ids — все сразу.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "id уведомлений из get_notifications" },
        requesting_user_id: ME,
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "get_today_meetings",
    description:
      "Встречи на сегодня из твоего Google-календаря: время, название, с кем, ссылка на звонок. Для утреннего брифинга — дальше ищи этих людей через search_knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        tz_offset_minutes: {
          type: "number",
          description:
            "Смещение твоего пояса от UTC в минутах к востоку (Белград летом 120, зимой 60). Без него сутки и время — в UTC.",
        },
        requesting_user_id: ME,
      },
      required: ["requesting_user_id"],
    },
  },
];
