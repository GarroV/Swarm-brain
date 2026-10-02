// Текст ответов личных MCP-инструментов (уведомления, встречи на сегодня) — чистые функции,
// чтобы формат проверялся тестом без базы и без Google.
import type { TodayMeeting } from "../../_shared/meetings-today.ts";
import type { CalendarGap } from "../../_shared/calendar-today.ts";

export type FeedItem = {
  id: string;
  type: string;
  task_id: string | null;
  task_title: string;
  content: string;
  actor_name: string;
  read_at: string | null;
  created_at: string;
  payload?: Record<string, unknown>;
};

const CONTENT_PREVIEW = 200;

function preview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > CONTENT_PREVIEW ? `${t.slice(0, CONTENT_PREVIEW)}…` : t;
}

export function formatNotifications(items: FeedItem[], onlyUnread: boolean): string {
  const shown = onlyUnread ? items.filter((i) => !i.read_at) : items;
  const unread = items.filter((i) => !i.read_at).length;
  if (!shown.length) return onlyUnread ? "Непрочитанных уведомлений нет." : "Уведомлений нет.";
  const lines = shown.map((i) => {
    const mark = i.read_at ? "  " : "🔵";
    const when = i.created_at.slice(0, 16).replace("T", " ");
    if (i.type === "maintenance") {
      const text = typeof i.payload?.ru === "string" ? i.payload.ru : "Плановые работы";
      return `${mark} [${when}] 🛠 ${preview(text)} (id: ${i.id})`;
    }
    const what = i.content ? `: ${preview(i.content)}` : "";
    return `${mark} [${when}] ${i.actor_name} — «${i.task_title}» (задача ${i.task_id})${what} (id: ${i.id})`;
  });
  return `Непрочитанных: ${unread}\n\n${lines.join("\n")}`;
}

const GAP_TEXT: Record<CalendarGap, string> = {
  not_connected: "Календарь не подключён. Подключить можно в Swarm: «Настройки → Интеграции».",
  token_expired: "Доступ к календарю истёк — переподключи календарь в Swarm («Настройки → Интеграции»).",
  calendar_error: "Календарь сейчас не ответил. Попробуй ещё раз через минуту.",
};

export function formatCalendarGap(reason: CalendarGap): string {
  return GAP_TEXT[reason];
}

/** HH:MM в поясе человека: смещение в минутах к востоку от UTC. */
export function localClock(iso: string, tzOffsetMinutes: number): string {
  const d = new Date(Date.parse(iso) + tzOffsetMinutes * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatTodayMeetings(
  meetings: TodayMeeting[],
  attendeesById: Map<string, string[]>,
  tzOffsetMinutes: number,
  tzKnown: boolean,
): string {
  if (!meetings.length) return "На сегодня встреч в календаре нет.";
  const lines = meetings.map((m) => {
    const state = m.is_now ? " — идёт сейчас" : m.is_past ? " — прошла" : "";
    const who = attendeesById.get(m.id) ?? [];
    const people = who.length ? `\n   С кем: ${who.join(", ")}` : m.attendees ? `\n   Участников: ${m.attendees}` : "";
    const link = m.join_url ? `\n   Ссылка: ${m.join_url}` : "";
    const clock = `${localClock(m.starts_at, tzOffsetMinutes)}–${localClock(m.ends_at, tzOffsetMinutes)}`;
    return `• ${clock} ${m.title ?? "(без названия)"}${state}${people}${link}`;
  });
  const tzNote = tzKnown ? "" : "\n\n(Время в UTC: передай tz_offset_minutes, чтобы видеть своё местное.)";
  return lines.join("\n") + tzNote;
}
