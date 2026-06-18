"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTasks, updateTask } from "@/lib/api";
import type { Task } from "@/types";
import { TaskModal } from "@/components/TaskModal";
import { STATUS_META, SectionLabel } from "@/components/roy/ui";
import {
  DAY_WIDTH, ROW_HEIGHT, BAR_HEIGHT,
  addDays, parseISO, dateToX, todayISO,
  buildDayScale, computeRange, barGeometry,
} from "@/lib/timeline";

type DragMode = "move" | "left" | "right";
type DragState = {
  id: string; mode: DragMode; startClientX: number; origStart: string; origDue: string; moved: boolean;
};

// Клик vs перетаскивание: меньше этого сдвига в px считаем кликом (→ открыть задачу).
const CLICK_SLOP = 4;

// Цвет бара по статусу — из семантических токенов «Рой» (адаптируется к dark).
const STATUS_BAR: Record<string, string> = {
  open: "var(--status-open)",
  in_progress: "var(--status-prog)",
  progress: "var(--status-prog)",
  done: "var(--status-done)",
  cancelled: "var(--ink-mute)",
};
const barBg = (status: string) => STATUS_BAR[status] ?? "var(--status-open)";
const statusDot = (status: string) => STATUS_META[status]?.color ?? "var(--status-open)";

const PRI_COLOR: Record<string, string> = { high: "var(--pri-high)", med: "var(--pri-med)", low: "var(--pri-low)" };

function initials(names: string[]): string {
  if (!names.length) return "";
  return names[0].split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

const LEGEND = [
  { id: "open", label: "Открыто" },
  { id: "in_progress", label: "В работе" },
  { id: "done", label: "Готово" },
];

export function TimelineView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalTask, setModalTask] = useState<Task | null>(null);
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

  // Сегменты месяцев для верхней строки шкалы — явное разделение по месяцам.
  const monthSegs: { key: string; label: string; left: number; width: number }[] = [];
  scale.forEach((c, i) => {
    if (c.monthLabel || monthSegs.length === 0) {
      monthSegs.push({ key: c.iso, label: c.monthLabel ?? "", left: i * DAY_WIDTH, width: DAY_WIDTH });
    } else {
      monthSegs[monthSegs.length - 1].width += DAY_WIDTH;
    }
  });

  // ── drag/resize через pointer capture; без сдвига → клик (открыть задачу) ────
  function onPointerDown(e: React.PointerEvent, task: Task, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const start = task.start_date ?? task.due_date!;
    const due = task.due_date ?? task.start_date!;
    dragRef.current = { id: task.id, mode, startClientX: e.clientX, origStart: start, origDue: due, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const ds = dragRef.current;
    if (!ds) return;
    if (Math.abs(e.clientX - ds.startClientX) > CLICK_SLOP) ds.moved = true;
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
    // Клик без сдвига — открыть задачу, дату не трогаем.
    if (!ds.moved) { setModalTask(t); return; }
    updateTask(t.id, { start_date: t.start_date, due_date: t.due_date }).catch(() => loadTasks());
  }

  if (loading) {
    return (
      <div className="space-y-2.5 px-5 pt-5">
        {[0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: BAR_HEIGHT, borderRadius: 10 }} />)}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-end justify-between gap-3 px-5 pt-3 pb-3">
        <div>
          <h1 className="font-bold leading-[1.1] text-ink" style={{ fontSize: 28, letterSpacing: "-0.02em" }}>Таймлайн</h1>
          <p className="text-ink-soft mt-1" style={{ fontSize: 13 }}>
            {withDates.length} {plural(withDates.length, ["задача", "задачи", "задач"])} с датами · перетаскивай и тяни за края
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3.5 pb-0.5">
          {LEGEND.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 text-ink-soft" style={{ fontSize: 11.5 }}>
              <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: statusDot(s.id) }} />
              {s.label}
            </span>
          ))}
        </div>
      </header>

      <div className="mx-5 overflow-auto rounded-2xl border border-line bg-surface shadow-sm" style={{ maxHeight: "58vh" }}>
        <div className="relative" style={{ width: bodyWidth }}>
          {/* Шкала: верхняя строка — месяцы, нижняя — дни */}
          <div className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-line">
            <div className="flex">
              {monthSegs.map((m) => (
                <div
                  key={m.key}
                  className="shrink-0 overflow-hidden whitespace-nowrap border-l border-line px-2.5 py-1.5 font-bold uppercase text-ink first:border-l-0"
                  style={{ width: m.width, fontSize: 11, letterSpacing: "0.05em" }}
                >
                  {m.label}
                </div>
              ))}
            </div>
            <div className="flex border-t border-line/60">
              {scale.map((c) => (
                <div
                  key={c.iso}
                  className={`shrink-0 flex items-center justify-center py-1 ${c.monthLabel ? "border-l border-line" : ""}`}
                  style={{ width: DAY_WIDTH }}
                >
                  {c.isToday ? (
                    <span
                      className="inline-flex items-center justify-center rounded-full bg-primary font-bold text-white"
                      style={{ minWidth: 18, height: 18, fontSize: 10.5, padding: "0 5px" }}
                    >
                      {c.dayOfMonth}
                    </span>
                  ) : (
                    <span style={{ fontSize: 10.5 }} className={c.isWeekend ? "text-ink-mute" : "text-ink-soft"}>
                      {c.dayOfMonth}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Тело: фон-сетка + полосы выходных + линия "сегодня" + бары */}
          <div className="relative" style={{ minHeight: withDates.length * ROW_HEIGHT + 24 }}>
            {/* выходные */}
            {scale.map((c, i) =>
              c.isWeekend ? (
                <div key={`w${c.iso}`} className="absolute top-0 bottom-0 bg-surface-2" style={{ left: i * DAY_WIDTH, width: DAY_WIDTH, opacity: 0.6 }} />
              ) : null
            )}
            {/* вертикальные линии дней */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ backgroundImage: `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${DAY_WIDTH}px)` }} />
            {/* горизонтальные дорожки строк */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${ROW_HEIGHT - 1}px, var(--line) ${ROW_HEIGHT - 1}px ${ROW_HEIGHT}px)`, opacity: 0.5 }} />
            {/* границы месяцев — жирнее, чем дни */}
            {monthSegs.slice(1).map((m) => (
              <div key={`mb${m.key}`} className="absolute top-0 bottom-0 pointer-events-none"
                style={{ left: m.left, width: 1, background: "var(--line-2)" }} />
            ))}
            {/* линия "сегодня" */}
            <div className="absolute top-0 bottom-0 z-10 pointer-events-none"
              style={{ left: todayX, width: 2, background: "var(--primary)", opacity: 0.85 }} />

            {/* строки задач */}
            {withDates.map((t, row) => {
              const geo = barGeometry(t, rangeStart);
              if (!geo) return null;
              const bg = barBg(t.status);
              const pri = (t.priority as "high" | "med" | "low" | null) ?? null;
              const top = row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
              if (geo.isMilestone) {
                return (
                  <div key={t.id} className="absolute z-10 flex items-center" style={{ left: geo.x + DAY_WIDTH / 2 - BAR_HEIGHT / 2, top, height: BAR_HEIGHT }}>
                    <button
                      onPointerDown={(e) => onPointerDown(e, t, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      className="size-[18px] rotate-45 rounded-[5px] shadow-md ring-2 ring-surface touch-none cursor-grab active:cursor-grabbing transition-transform hover:scale-110"
                      style={{ background: bg }}
                      title={t.title}
                      aria-label={t.title}
                    />
                    <button
                      onClick={() => setModalTask(t)}
                      className="ml-2.5 inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-left shadow-sm transition-colors hover:border-accent-line"
                    >
                      {pri && <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: PRI_COLOR[pri] }} />}
                      <span className="truncate text-ink" style={{ fontSize: 12.5, fontWeight: 600 }}>{t.title}</span>
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={t.id}
                  className="group absolute z-10 flex select-none items-center gap-1.5 rounded-[10px] px-2.5 shadow-md ring-1 ring-black/5 touch-none cursor-grab active:cursor-grabbing transition-shadow hover:shadow-lg"
                  style={{ left: geo.x, top, width: geo.width, height: BAR_HEIGHT, background: bg }}
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
                    className="absolute left-0 top-0 bottom-0 w-2 rounded-l-[10px] cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15"
                  />
                  {pri && <span className="shrink-0 rounded-full ring-2 ring-white/70" style={{ width: 8, height: 8, background: PRI_COLOR[pri] }} />}
                  <span className="truncate font-semibold text-white" style={{ fontSize: 12.5 }}>{t.title}</span>
                  {t.assignees.length > 0 && (
                    <span className="ml-auto inline-flex shrink-0 items-center justify-center rounded-full bg-white/25 font-bold text-white"
                      style={{ width: 20, height: 20, fontSize: 9.5 }}>
                      {initials(t.assignees)}
                    </span>
                  )}
                  {/* ручка справа */}
                  <span
                    onPointerDown={(e) => onPointerDown(e, t, "right")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    className="absolute right-0 top-0 bottom-0 w-2 rounded-r-[10px] cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/15"
                  />
                </div>
              );
            })}

            {withDates.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-16 text-center">
                <p className="font-semibold text-ink" style={{ fontSize: 14 }}>Нет задач с датами</p>
                <p className="text-ink-soft" style={{ fontSize: 12.5 }}>Открой задачу ниже и поставь срок — она появится на таймлайне.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Задачи без дат */}
      {noDates.length > 0 && (
        <div className="px-5 pt-4 pb-5">
          <SectionLabel className="!mx-0 !mb-1">Без срока · {noDates.length}</SectionLabel>
          <p className="text-ink-soft mb-2.5" style={{ fontSize: 11.5 }}>
            Не на таймлайне — нажми, чтобы открыть и поставить срок.
          </p>
          <div className="flex flex-wrap gap-2">
            {noDates.map((t) => (
              <button
                key={t.id}
                onClick={() => setModalTask(t)}
                className="inline-flex max-w-[200px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-left shadow-sm transition-all hover:-translate-y-px hover:border-accent-line hover:shadow-md"
              >
                <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: statusDot(t.status) }} />
                <span className="truncate text-ink" style={{ fontSize: 12.5, fontWeight: 500 }}>{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <TaskModal
        task={modalTask ?? undefined}
        open={modalTask !== null}
        onClose={() => setModalTask(null)}
        onSaved={loadTasks}
      />
    </div>
  );
}
