"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTasks, updateTask } from "@/lib/api";
import type { Task } from "@/types";
import {
  DAY_WIDTH, ROW_HEIGHT, BAR_HEIGHT,
  addDays, parseISO, diffDays, dateToX, todayISO,
  buildDayScale, computeRange, barGeometry, statusColor,
} from "@/lib/timeline";

type DragMode = "move" | "left" | "right";
type DragState = {
  id: string; mode: DragMode; startClientX: number; origStart: string; origDue: string;
};

function initials(names: string[]): string {
  if (!names.length) return "";
  return names[0].split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function TimelineView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const tasksRef = useRef<Task[]>([]);
  const dragRef = useRef<DragState | null>(null);

  tasksRef.current = tasks;

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await fetchTasks());
    } catch {
      /* keep current on error */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const withDates = tasks.filter((t) => t.start_date || t.due_date);
  const noDates = tasks.filter((t) => !t.start_date && !t.due_date);
  const { start: rangeStart, days } = computeRange(withDates);
  const scale = buildDayScale(rangeStart, days);
  const bodyWidth = days * DAY_WIDTH;
  const today = todayISO();
  const todayX = dateToX(today, rangeStart);

  // ── drag/resize через pointer capture ──────────────────────────────────────
  function onPointerDown(e: React.PointerEvent, task: Task, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const start = task.start_date ?? task.due_date!;
    const due = task.due_date ?? task.start_date!;
    dragRef.current = { id: task.id, mode, startClientX: e.clientX, origStart: start, origDue: due };
  }

  function onPointerMove(e: React.PointerEvent) {
    const ds = dragRef.current;
    if (!ds) return;
    const deltaDays = Math.round((e.clientX - ds.startClientX) / DAY_WIDTH);
    setTasks((prev) => prev.map((t) => {
      if (t.id !== ds.id) return t;
      let ns = ds.origStart, nd = ds.origDue;
      if (ds.mode === "move") { ns = addDays(ds.origStart, deltaDays); nd = addDays(ds.origDue, deltaDays); }
      else if (ds.mode === "left") { ns = addDays(ds.origStart, deltaDays); if (parseISO(ns) > parseISO(nd)) ns = nd; }
      else { nd = addDays(ds.origDue, deltaDays); if (parseISO(nd) < parseISO(ns)) nd = ns; }
      return { ...t, start_date: ns, due_date: nd };
    }));
  }

  function onPointerUp() {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    const t = tasksRef.current.find((x) => x.id === ds.id);
    if (!t) return;
    updateTask(t.id, { start_date: t.start_date, due_date: t.due_date }).catch(() => loadTasks());
  }

  if (loading) {
    return <p className="text-center text-muted-foreground py-12 text-sm">Загрузка…</p>;
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-5 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Таймлайн</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {withDates.length} задач с датами · перетаскивай и тяни за края
        </p>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="relative" style={{ width: bodyWidth, minHeight: "100%" }}>
          {/* Шкала дней */}
          <div className="sticky top-0 z-20 flex bg-background/95 backdrop-blur border-b border-border">
            {scale.map((c) => (
              <div
                key={c.iso}
                className={`shrink-0 flex flex-col items-center justify-center py-1.5 text-[10px] leading-tight ${
                  c.isWeekend ? "text-muted-foreground/50" : "text-muted-foreground"
                }`}
                style={{ width: DAY_WIDTH }}
              >
                {c.monthLabel && (
                  <span className="absolute -translate-y-5 left-1 text-[10px] font-semibold text-foreground whitespace-nowrap">
                    {c.monthLabel}
                  </span>
                )}
                <span className={c.isToday ? "font-bold text-foreground" : ""}>{c.dayOfMonth}</span>
              </div>
            ))}
          </div>

          {/* Тело: фон-сетка + полосы выходных + линия "сегодня" + бары */}
          <div className="relative" style={{ minHeight: withDates.length * ROW_HEIGHT + 16 }}>
            {/* выходные */}
            {scale.map((c, i) =>
              c.isWeekend ? (
                <div key={`w${c.iso}`} className="absolute top-0 bottom-0 bg-muted/40"
                  style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }} />
              ) : null
            )}
            {/* вертикальные линии дней */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ backgroundImage: `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${DAY_WIDTH}px)` }} />
            {/* линия "сегодня" */}
            <div className="absolute top-0 bottom-0 z-10 pointer-events-none"
              style={{ left: todayX, width: 2, background: "oklch(0.62 0.19 264)" }} />

            {/* строки задач */}
            {withDates.map((t, row) => {
              const geo = barGeometry(t, rangeStart);
              if (!geo) return null;
              const c = statusColor(t.status);
              const top = row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
              if (geo.isMilestone) {
                return (
                  <div key={t.id} className="absolute z-10 flex items-center"
                    style={{ left: geo.x, top, height: BAR_HEIGHT }}>
                    <button
                      onPointerDown={(e) => onPointerDown(e, t, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      className="size-4 rotate-45 rounded-[3px] shadow-md touch-none cursor-grab active:cursor-grabbing"
                      style={{ background: c.bar }}
                      title={t.title}
                    />
                    <span className="ml-2 text-xs font-medium truncate max-w-[180px]">{t.title}</span>
                  </div>
                );
              }
              return (
                <div
                  key={t.id}
                  className="absolute z-10 rounded-lg shadow-md flex items-center px-2 group touch-none cursor-grab active:cursor-grabbing select-none"
                  style={{ left: geo.x, top, width: geo.width, height: BAR_HEIGHT, background: c.bar }}
                  onPointerDown={(e) => onPointerDown(e, t, "move")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  title={t.title}
                >
                  {/* ручка слева */}
                  <span
                    onPointerDown={(e) => onPointerDown(e, t, "left")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    className="absolute left-0 top-0 bottom-0 w-2 rounded-l-lg cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15"
                  />
                  <span className="text-xs font-semibold truncate" style={{ color: c.text }}>
                    {t.title}
                  </span>
                  {t.assignees.length > 0 && (
                    <span className="ml-auto pl-2 text-[10px] font-bold shrink-0" style={{ color: c.text }}>
                      {initials(t.assignees)}
                    </span>
                  )}
                  {/* ручка справа */}
                  <span
                    onPointerDown={(e) => onPointerDown(e, t, "right")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    className="absolute right-0 top-0 bottom-0 w-2 rounded-r-lg cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15"
                  />
                </div>
              );
            })}

            {withDates.length === 0 && (
              <p className="text-center text-muted-foreground py-12 text-sm">
                Нет задач с датами. Поставь срок задаче — она появится здесь.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Задачи без дат */}
      {noDates.length > 0 && (
        <div className="border-t border-border px-5 py-3 max-h-40 overflow-y-auto">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            Без дат · {noDates.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {noDates.map((t) => (
              <span key={t.id} className="text-xs bg-secondary text-secondary-foreground rounded-full px-3 py-1 truncate max-w-[160px]">
                {t.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
