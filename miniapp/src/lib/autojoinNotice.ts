// Плашка у переключателя бота: что показала живая проверка календаря (решение 01.10.2026,
// docs/decisions/2026-10-01-autojoin-calendar-check.md). Чистая функция — тексты и тон проверяются
// без экрана. Статусы — _shared/autojoin-calendar.ts.
export type AutojoinCalendarStatus = "not_connected" | "no_access" | "unavailable" | "no_meetings" | "ok";
export interface AutojoinCalendarCheck {
  status: AutojoinCalendarStatus;
  meetings: number;
  events: number;
  next: { title: string | null; starts_at: string; platform: string } | null;
}

export type NoticeTone = "warn" | "soft" | "ok";

export interface AutojoinNotice {
  tone: NoticeTone;
  text: string;
  /** Кнопка «Подключить календарь» — только когда доступа нет. */
  connect: boolean;
}

function meetingsWord(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return "встречу";
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return "встречи";
  return "встреч";
}

function when(iso: string, lang: "ru" | "en", nowMs: number): string {
  const d = new Date(iso);
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  const sameDay = new Date(nowMs).toDateString() === d.toDateString();
  if (sameDay) return lang === "ru" ? `сегодня в ${time}` : `today at ${time}`;
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(d);
  return lang === "ru" ? `${day} в ${time}` : `${day} at ${time}`;
}

export function autojoinNotice(check: AutojoinCalendarCheck, lang: "ru" | "en", nowMs = Date.now()): AutojoinNotice {
  const ru = lang === "ru";
  switch (check.status) {
    case "not_connected":
      return {
        tone: "warn",
        connect: true,
        text: ru
          ? "Календарь не подключён — бот не узнает о ваших встречах."
          : "Calendar is not connected — the bot will not know about your meetings.",
      };
    case "no_access":
      return {
        tone: "warn",
        connect: true,
        text: ru
          ? "Календарь не подключён — доступ к нему пропал, бот не узнает о ваших встречах."
          : "Calendar is not connected — access was lost, so the bot will not know about your meetings.",
      };
    case "unavailable":
      return {
        tone: "soft",
        connect: false,
        text: ru
          ? "Не удалось проверить календарь: Google не ответил. Загляните позже."
          : "Could not check the calendar: Google did not respond. Check back later.",
      };
    case "no_meetings":
      return {
        tone: "soft",
        connect: false,
        text: ru
          ? "Доступ к календарю есть, но в ближайшую неделю нет встреч со ссылкой на звонок, которые вы приняли."
          : "Calendar access is fine, but there are no accepted meetings with a call link in the next week.",
      };
    case "ok": {
      const next = check.next ? when(check.next.starts_at, lang, nowMs) : null;
      const title = check.next?.title ? `«${check.next.title}»` : null;
      const n = check.meetings;
      const head = ru ? `Бот видит ${n} ${meetingsWord(n)} на неделю` : `The bot sees ${n} meeting${n === 1 ? "" : "s"} this week`;
      const tail = next
        ? ru ? `, ближайшая — ${[title, next].filter(Boolean).join(" ")}.` : `, next — ${[title?.replace(/[«»]/g, '"'), next].filter(Boolean).join(" ")}.`
        : ".";
      return { tone: "ok", connect: false, text: head + tail };
    }
  }
}
