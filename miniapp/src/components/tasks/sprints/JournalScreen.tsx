"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JournalEvent, JournalKind } from "@/types";
import { fetchSpaceJournal } from "@/lib/api";
import { uiLocale } from "./format";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// Журнал пространства: что происходило, по дням. Лента нужна не для отчёта, а для вопроса
// «что изменилось, пока меня не было» — поэтому свежее сверху и период переключается одним
// нажатием, а не фильтром с датами.
//
// Приватные задачи в ленту не попадают. Это правило сервера, и клиент его не повторяет:
// повторённое, оно создало бы иллюзию, что за фильтр отвечает экран.

const PERIODS = ["1", "3", "7", "all"] as const;
type Period = typeof PERIODS[number];

const ICONS: Record<JournalKind, RoyIconName> = {
  task_change: "repeat",
  comment: "note",
  item_added: "plus",
  check: "check",
  carry: "arrow",
  removed: "trash",
  cycle_started: "spark",
  cycle_accepted: "flag",
};

/** «Сегодня» / «Вчера» / дата: человек думает днями, а не отметками времени. */
function dayLabel(iso: string, dt: (ru: string, en: string) => string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return dt("Сегодня", "Today");
  if (diff === 1) return dt("Вчера", "Yesterday");
  return d.toLocaleDateString(uiLocale(), { day: "numeric", month: "long" });
}

function time(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit" });
}

export function JournalScreen({ space }: { space: string | null }) {
  const dt = useDt();
  const [days, setDays] = useState<Period>("7");
  const [events, setEvents] = useState<JournalEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // ⚠️ `dt` — НОВАЯ функция на каждый рендер: в зависимостях эффекта она даёт
  // «Maximum update depth exceeded» (загрузка → рендер → новая dt → загрузка).
  // Поймано живым прогоном 19.09, ровно как раньше в AcceptDialog.
  const dtRef = useRef(dt);
  dtRef.current = dt;

  useEffect(() => {
    if (space === null) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setEvents(null);
    fetchSpaceJournal(space, days)
      .then((rows) => {
        if (!cancelled) {
          setEvents(rows);
          setErr(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setEvents([]);
        setErr(
          e instanceof Error
            ? e.message
            : dt("Не удалось загрузить журнал", "Failed to load the journal"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [space, days]);

  // Группировка по дням: лента без разделителей читается как сплошной поток.
  const byDay = useMemo(() => {
    const map = new Map<string, JournalEvent[]>();
    for (const e of events ?? []) {
      const key = e.at.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [events]);

  const labels: Record<Period, string> = {
    "1": dt("День", "Day"),
    "3": dt("3 дня", "3 days"),
    "7": dt("Неделя", "Week"),
    all: dt("Всё", "All"),
  };

  return (
    <div className="flex-1 min-w-0 space-y-3 overflow-y-auto">
      <div className="flex items-center gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDays(p)}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
              days === p
                ? "bg-ink text-background"
                : "border border-line bg-surface text-ink-soft hover:bg-surface-2"
            }`}
          >
            {labels[p]}
          </button>
        ))}
      </div>

      {err && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {err}
        </p>
      )}

      {space === null && (
        <p className="py-10 text-center text-sm text-ink-soft/70">
          {dt(
            "У «Без пространства» журнала нет: события считаются по вкладке.",
            "“No space” has no journal: events are counted per board tab.",
          )}
        </p>
      )}

      {/* Загрузка отличается от пустоты: иначе медленная сеть читается как «ничего не было». */}
      {events === null && space !== null && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-xl border border-line bg-surface/40"
            />
          ))}
        </div>
      )}

      {events !== null && events.length === 0 && space !== null && !err && (
        <p className="py-10 text-center text-sm text-ink-soft/70">
          {dt(
            "За этот период ничего не происходило.",
            "Nothing happened in this period.",
          )}
        </p>
      )}

      {byDay.map(([day, rows]) => (
        <section key={day} className="space-y-1">
          <h3 className="px-0.5 text-xs font-bold text-ink-soft">
            {dayLabel(rows[0].at, dt)}
          </h3>
          <div className="rounded-xl border border-line bg-surface-2">
            {rows.map((e, i) => (
              <div
                key={`${e.at}-${i}`}
                className="flex items-start gap-2 border-b border-line/30 px-2.5 py-1.5 last:border-0"
              >
                <RoyIcon
                  name={ICONS[e.kind] ?? "dots"}
                  size={12}
                  className="mt-0.5 shrink-0 text-ink-soft"
                />
                <span className="w-10 shrink-0 text-[10px] tabular-nums text-ink-soft/70">
                  {time(e.at)}
                </span>
                <p className="min-w-0 flex-1 text-xs text-ink">
                  {e.actor && (
                    <span className="font-semibold">{`${e.actor} `}</span>
                  )}
                  <span className="text-ink-soft">{e.text}</span>
                  {e.task_title && (
                    <span className="text-ink">{` · ${e.task_title}`}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
