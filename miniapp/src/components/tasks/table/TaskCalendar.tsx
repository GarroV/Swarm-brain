"use client";
import { useMemo } from "react";
import { cn, displayName } from "@/lib/utils";
import type { Task, User } from "@/types";
import type { DateRange } from "@/lib/dateRange";
import { isDone } from "@/lib/smartLists";
import { toISO } from "@/lib/calendar";
import { CAL_MAX_DAYS, calendarDays, calendarLayout, dueDay, type WhatsNext } from "@/lib/taskCalendar";
import { Avatar } from "@/components/roy/ui";
import { initials } from "@/components/roy/dash/shared";
import { useDt } from "@/components/roy/nav";

// Календарный вид задач (стенд: screens-tasks.js → calendarView): колонка на день, в ней
// карточки «кружок исполнителя + название». Период — из фильтра «Период», без него — текущая
// неделя. Всё, что не влезло в показанные дни, называется числом в подписи.

const DOW: [string, string][] = [["вс", "Sun"], ["пн", "Mon"], ["вт", "Tue"], ["ср", "Wed"], ["чт", "Thu"], ["пт", "Fri"], ["сб", "Sat"]];

function dayOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function TaskCalendar({ tasks, range, now, users, onOpen }: {
  tasks: Task[]; range: DateRange | null; now: Date; users: User[]; onOpen: (t: Task) => void;
}) {
  const dt = useDt();
  const cal = useMemo(() => calendarDays(range, now), [range, now]);
  const layout = useMemo(() => calendarLayout(tasks, cal.days), [tasks, cal.days]);
  const today = toISO(now);
  const locale = dt("ru-RU", "en-GB");
  const fmt = (iso: string) => dayOf(iso).toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
  const who = (t: Task) => users.find((u) => u.telegram_id === t.assignee_telegram_ids?.[0]);

  const note = [
    cal.defaulted ? dt("период не выбран — показана текущая неделя", "no period chosen — showing this week") : "",
    cal.cut ? dt(`показаны первые ${CAL_MAX_DAYS} дней периода`, `showing the first ${CAL_MAX_DAYS} days`) : "",
    layout.outside ? dt(`вне показанных дней ещё ${layout.outside}`, `${layout.outside} more outside these days`) : "",
  ].filter(Boolean).join(" · ");

  const card = (t: Task) => {
    const u = who(t);
    return (
      <button key={t.id} type="button" onClick={() => onOpen(t)}
        title={`${t.title}${u ? ` · ${displayName(u.name)}` : ""}`}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-[7px] border border-line bg-surface px-1.5 py-1 text-left transition-colors hover:border-line-2 hover:bg-surface-2",
          isDone(t) && "opacity-55 line-through",
        )}
        style={{ fontSize: 12 }}>
        <Avatar size={18}>{u ? initials(u.name) : "·"}</Avatar>
        <span className="line-clamp-2 min-w-0 text-ink">{t.title}</span>
      </button>
    );
  };
  const column = (key: string, head: React.ReactNode, items: Task[], cls?: string) => (
    <div key={key} className={cn("flex w-[168px] shrink-0 flex-col border-r border-line", cls)}>
      <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-line px-2.5" style={{ fontSize: 12 }}>
        {head}
        {items.length > 0 && <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{items.length}</span>}
      </div>
      <div className="flex flex-col gap-1 p-1.5">{items.map(card)}</div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-2 text-ink" style={{ fontSize: 13 }}>
        <b className="font-semibold">{dt("Загрузка по срокам", "Workload by due date")}</b>
        <span className="text-ink-soft">{fmt(cal.days[0] ?? cal.from)} — {fmt(cal.days[cal.days.length - 1] ?? cal.to)}</span>
        {note && <span className="text-ink-mute" style={{ fontSize: 12 }}>· {note}</span>}
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto">
        {layout.nodue.length > 0 && column("nodue", <b className="text-ink-soft">{dt("без срока", "no due date")}</b>, layout.nodue, "bg-surface-2")}
        {cal.days.map((d) => {
          const wd = dayOf(d).getDay();
          return column(d,
            <b className={cn(d === today ? "text-primary" : "text-ink")}>{dt(DOW[wd][0], DOW[wd][1])} {dayOf(d).getDate()}</b>,
            layout.byDay.get(d) ?? [],
            cn((wd === 0 || wd === 6) && "bg-surface-2/60", d === today && "bg-accent-soft/40"));
        })}
      </div>
    </div>
  );
}

// «Дальше по сроку» / «Недавно закрытые» под коротким списком (стенд: whatsNext): человек
// видит три строки и не знает, это всё или он сам сузил фильтр — экран отвечает, что дальше.
export function WhatsNextBlock({ next, onOpen }: { next: WhatsNext; onOpen: (t: Task) => void }) {
  const dt = useDt();
  if (!next.soon.length && !next.done.length) return null;
  const locale = dt("ru-RU", "en-GB");
  const line = (t: Task) => {
    const d = dueDay(t);
    return (
      <button key={t.id} type="button" onClick={() => onOpen(t)}
        className="flex min-h-[32px] w-full items-center gap-3 border-b border-line px-1 text-left text-ink transition-colors last:border-b-0 hover:text-primary"
        style={{ fontSize: 13 }}>
        <span className="min-w-0 flex-1 truncate">{t.title}</span>
        <span className="shrink-0 font-mono text-ink-mute" style={{ fontSize: 12 }}>
          {isDone(t) ? dt("закрыта", "closed") : d ? dayOf(d).toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "") : ""}
        </span>
      </button>
    );
  };
  const block = (title: string, list: Task[]) => list.length > 0 && (
    <div className="min-w-0">
      <div className="mb-1 font-semibold uppercase text-ink-soft" style={{ fontSize: 10.5, letterSpacing: "0.07em" }}>{title}</div>
      {list.map(line)}
    </div>
  );
  return (
    <div className="grid gap-6 px-4 py-5 md:grid-cols-2" style={{ maxWidth: 960 }}>
      {block(dt("Дальше по сроку", "Coming up"), next.soon)}
      {block(dt("Недавно закрытые", "Recently closed"), next.done)}
    </div>
  );
}
