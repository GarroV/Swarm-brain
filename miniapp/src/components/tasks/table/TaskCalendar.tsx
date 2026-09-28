"use client";
import { useEffect, useMemo, useState } from "react";
import { cn, displayName } from "@/lib/utils";
import type { Task, User } from "@/types";
import type { DateRange } from "@/lib/dateRange";
import { isDone } from "@/lib/smartLists";
import { toISO } from "@/lib/calendar";
import {
  CAL_MAX_DAYS, CELL_MAX, calendarDays, calendarLayout, calendarMode, dueDay, monthGrid, weekOf,
  type CalendarLayout, type WhatsNext,
} from "@/lib/taskCalendar";
import { Avatar } from "@/components/roy/ui";
import { initials } from "@/components/roy/dash/shared";
import { useDt } from "@/components/roy/nav";

// Календарный вид задач (стенд: screens-tasks.js → calendarView). Период — из фильтра «Период»,
// без него — текущая неделя. До 7 дней — колонка на день во всю ширину, карточки «кружок
// исполнителя + название»; период длиннее — месячная сетка, из дня проваливаемся в его неделю.
// Всё, что не влезло в показанные дни, называется числом в подписи.

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
  // День, в который провалились из сетки: показываем его неделю колонками.
  const [drill, setDrill] = useState<string | null>(null);
  useEffect(() => setDrill(null), [cal.from, cal.to]);
  const mode = drill ? "week" : calendarMode(cal.days);
  const days = useMemo(() => (drill ? weekOf(drill) : cal.days), [drill, cal.days]);
  const layout = useMemo(() => calendarLayout(tasks, days), [tasks, days]);
  const today = toISO(now);
  const locale = dt("ru-RU", "en-GB");
  const fmt = (iso: string) => dayOf(iso).toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(".", "");
  const who = (t: Task) => users.find((u) => u.telegram_id === t.assignee_telegram_ids?.[0]);

  const note = drill ? "" : [
    cal.defaulted ? dt("период не выбран — показана текущая неделя", "no period chosen — showing this week") : "",
    cal.cut ? dt(`показаны первые ${CAL_MAX_DAYS} дней периода`, `showing the first ${CAL_MAX_DAYS} days`) : "",
    layout.outside ? dt(`вне показанных дней ещё ${layout.outside}`, `${layout.outside} more outside these days`) : "",
  ].filter(Boolean).join(" · ");

  const card = (t: Task, compact = false) => {
    const u = who(t);
    return (
      <button key={t.id} type="button" onClick={() => onOpen(t)}
        title={`${t.title}${u ? ` · ${displayName(u.name)}` : ""}`}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-1.5 text-left transition-colors hover:border-line-2 hover:bg-surface-2",
          compact ? "py-0.5" : "py-1",
          isDone(t) && "opacity-55 line-through",
        )}
        style={{ fontSize: compact ? 11.5 : 12 }}>
        <Avatar size={compact ? 16 : 18}>{u ? initials(u.name) : "·"}</Avatar>
        <span className={cn("min-w-0 text-ink", compact ? "truncate" : "line-clamp-2")}>{t.title}</span>
      </button>
    );
  };
  const dayHead = (d: string) => {
    const wd = dayOf(d).getDay();
    return <b className={cn(d === today ? "text-primary" : "text-ink")}>{dt(DOW[wd][0], DOW[wd][1])} {dayOf(d).getDate()}</b>;
  };
  const column = (key: string, head: React.ReactNode, items: Task[], cls?: string) => (
    <div key={key} className={cn("flex min-w-0 flex-1 flex-col border-r border-line last:border-r-0", cls)}>
      <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-line px-2.5" style={{ fontSize: 12 }}>
        {head}
        {items.length > 0 && <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{items.length}</span>}
      </div>
      <div className="flex flex-col gap-1 p-1.5">{items.map((t) => card(t))}</div>
    </div>
  );
  const nodueCol = layout.nodue.length > 0 && column("nodue", <b className="text-ink-soft">{dt("без срока", "no due date")}</b>, layout.nodue, "bg-surface-2");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 border-b border-line px-4 py-2 text-ink" style={{ fontSize: 13 }}>
        {drill && (
          <button type="button" onClick={() => setDrill(null)}
            className="mr-1 inline-flex h-[26px] items-center rounded-[7px] border border-line-2 bg-surface px-2 font-medium text-ink transition-colors hover:bg-surface-2"
            style={{ fontSize: 12 }}>
            ← {dt("К сетке", "Back to grid")}
          </button>
        )}
        <b className="font-semibold">{dt("Загрузка по срокам", "Workload by due date")}</b>
        <span className="text-ink-soft">{fmt(days[0] ?? cal.from)} — {fmt(days[days.length - 1] ?? cal.to)}</span>
        {note && <span className="text-ink-mute" style={{ fontSize: 12 }}>· {note}</span>}
      </div>
      {mode === "week" ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          {nodueCol}
          {days.map((d) => {
            const wd = dayOf(d).getDay();
            return column(d, dayHead(d), layout.byDay.get(d) ?? [],
              cn((wd === 0 || wd === 6) && "bg-surface-2/60", d === today && "bg-accent-soft/40", d === drill && "ring-1 ring-inset ring-primary/50"));
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {nodueCol && <div className="flex w-[200px] shrink-0 overflow-y-auto border-r border-line">{nodueCol}</div>}
          <MonthGrid days={cal.days} layout={layout} today={today} card={card} onDrill={setDrill} />
        </div>
      )}
    </div>
  );
}

// Месячная сетка: неделя строкой, в ячейке первые CELL_MAX задач и «+N». Клик по числу или
// по «+N» проваливает в неделю этого дня — там колонки, и задачи видны целиком.
function MonthGrid({ days, layout, today, card, onDrill }: {
  days: string[]; layout: CalendarLayout; today: string;
  card: (t: Task, compact?: boolean) => React.ReactNode; onDrill: (iso: string) => void;
}) {
  const dt = useDt();
  const weeks = useMemo(() => monthGrid(days), [days]);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="sticky top-0 z-[1] grid shrink-0 grid-cols-7 border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft"
        style={{ fontSize: 10.5, letterSpacing: "0.07em" }}>
        {order.map((wd) => <span key={wd} className="px-2 py-1.5">{dt(DOW[wd][0], DOW[wd][1])}</span>)}
      </div>
      {weeks.map((week) => (
        <div key={week[0].iso} className="grid grid-cols-7 border-b border-line" style={{ minHeight: 112 }}>
          {week.map(({ iso, inRange }) => {
            const items = inRange ? layout.byDay.get(iso) ?? [] : [];
            const more = items.length - CELL_MAX;
            const wd = dayOf(iso).getDay();
            return (
              <div key={iso} className={cn(
                "flex min-w-0 flex-col gap-1 border-r border-line p-1.5 last:border-r-0",
                !inRange && "bg-surface-2/40 opacity-50",
                inRange && (wd === 0 || wd === 6) && "bg-surface-2/60",
                iso === today && "bg-accent-soft/40",
              )}>
                <button type="button" disabled={!inRange} onClick={() => onDrill(iso)}
                  aria-label={dt(`Открыть неделю ${iso}`, `Open the week of ${iso}`)}
                  className="flex items-center justify-between rounded-[5px] px-1 text-left transition-colors enabled:hover:bg-surface-2"
                  style={{ fontSize: 12 }}>
                  <b className={cn(iso === today ? "text-primary" : "text-ink")}>{dayOf(iso).getDate()}</b>
                  {items.length > 0 && <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{items.length}</span>}
                </button>
                {items.slice(0, CELL_MAX).map((t) => card(t, true))}
                {more > 0 && (
                  <button type="button" onClick={() => onDrill(iso)}
                    className="rounded-[5px] px-1 text-left font-medium text-primary transition-colors hover:bg-accent-soft"
                    style={{ fontSize: 11.5 }}>
                    {dt(`+${more} ещё`, `+${more} more`)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
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
