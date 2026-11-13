"use client";
// Поле «Спринт» карточки задачи (владелец 06.11.2026: «возможность выбирания спринта внутри самой
// задачи»). Показывает, где задача живёт сейчас (незакрытые спринты её пространства), и по клику
// даёт выбрать другой. Правил здесь НЕТ — каждое действие зовёт уже существующий вызов сервера:
//   нет спринта → запланированный: setSprintTaskSpan (план), идущий: addTasksToSprintCycle;
//   запланированный → запланированный: setSprintTaskSpan; → идущий: shiftBetweenDrafts;
//   идущий → запланированный: окно переноса MoveDialog (причина обязательна);
//   несколько спринтов: окно SpanDialog; убрать: removeTaskFromSprintCycle.
// Отказ сервера «Нужна причина…» (409) — поле причины тут же и повтор. Срок задачи выбор не меняет.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SprintCycle, SprintCycleItem } from "@/types";
import {
  addTasksToSprintCycle,
  fetchSprintCycle,
  fetchSprintCycles,
  fetchSprintJourney,
  fetchSprints,
  removeTaskFromSprintCycle,
  setSprintTaskSpan,
} from "@/lib/api";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { propertyPillCls } from "@/components/ui/PropertyPill";
import { cn } from "@/lib/utils";
import { cycleDates, cycleShort, dueCycleOf } from "@/lib/sprintLabels";
import { MoveDialog } from "@/components/tasks/sprints/MoveDialog";
import { SpanDialog } from "@/components/tasks/sprints/SpanDialog";
import { shiftBetweenDrafts } from "@/components/tasks/sprints/shiftTask";

const W = 280, H = 340;
const ROW =
  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50";

type TaskLite = { id: string; title: string; due_date: string | null; status: string; archived_at?: string | null };

export function TaskSprintField(
  { task, onChanged }: { task: TaskLite; onChanged: () => void },
) {
  const dt = useDt();
  const [cycles, setCycles] = useState<SprintCycle[] | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [spaceNames, setSpaceNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Выбранная цель, на которую сервер потребовал причину.
  const [needReason, setNeedReason] = useState<SprintCycle | null>(null);
  const [reason, setReason] = useState("");
  const [moveItem, setMoveItem] = useState<{ item: SprintCycleItem; cycleId: string; target: string } | null>(null);
  const [spanOpen, setSpanOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const hidden = task.status === "done" || task.status === "cancelled" || !!task.archived_at;
  const taskId = task.id;

  const load = useCallback(async () => {
    const [all, journey, spaces] = await Promise.all([
      fetchSprintCycles(),
      fetchSprintJourney(taskId),
      fetchSprints().catch(() => []),
    ]);
    setCycles(all.filter((c) => c.status !== "accepted"));
    setLive(
      journey.steps.filter((s) =>
        s.cycle.status !== "accepted" && s.outcome.kind !== "moved" && s.outcome.kind !== "withdrawn"
      ).map((s) => s.cycle.id),
    );
    setSpaceNames(Object.fromEntries(spaces.map((s) => [s.id, s.name])));
  }, [taskId]);

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    load().catch(() => {
      if (alive) setCycles(null);
    });
    return () => {
      alive = false;
    };
  }, [load, hidden]);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - W - 8);
    const below = r.bottom + 6;
    const top = below + H > window.innerHeight - 8 && r.top > H ? r.top - H - 6 : below;
    setPos({ left: Math.max(8, left), top });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  const close = useCallback(() => {
    setOpen(false);
    setNeedReason(null);
    setReason("");
    setErr(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place, close]);

  const sorted = useMemo(
    () => [...(cycles ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [cycles],
  );
  const mine = sorted.filter((c) => live.includes(c.id));
  // Задача уже живёт в пространстве — другое ей сервер не даст («Спринт другого пространства»).
  const spaceOfTask = mine.length > 0 ? mine[0].tab_id : undefined;
  const options = spaceOfTask === undefined ? sorted : sorted.filter((c) => c.tab_id === spaceOfTask);
  const groups = useMemo(() => {
    const m = new Map<string | null, SprintCycle[]>();
    for (const c of options) m.set(c.tab_id, [...(m.get(c.tab_id) ?? []), c]);
    return [...m.entries()];
  }, [options]);

  if (hidden || cycles === null || sorted.length === 0) return null;

  const flagId = dueCycleOf(options, task.due_date)?.id;
  const label = mine.length === 0
    ? dt("Не в спринте", "No sprint")
    : mine.length === 1
    ? cycleShort(mine[0].name)
    : `${cycleShort(mine[0].name)}–${cycleShort(mine[mine.length - 1].name)}`;
  const title = `${dt("Спринт", "Sprint")}: ${label}`;

  async function done() {
    await load();
    onChanged();
  }

  async function run(fn: () => Promise<void>, target?: SprintCycle) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await done();
      close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (target && msg.startsWith("Нужна причина")) setNeedReason(target);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  const spanTo = (target: SprintCycle, why?: string) =>
    run(async () => {
      await setSprintTaskSpan(taskId, {
        from_cycle_id: target.id,
        to_cycle_id: target.id,
        reason: why?.trim() || null,
      });
    }, target);

  async function pick(target: SprintCycle) {
    if (busy) return;
    if (mine.length > 1) {
      close();
      setSpanOpen(true);
      return;
    }
    const src = mine[0];
    if (src?.id === target.id) return close();
    if (!src) {
      if (target.status === "draft") return void spanTo(target);
      return void run(async () => {
        const added = await addTasksToSprintCycle(target.id, [taskId]);
        if (added < 1) throw new Error(dt("Не удалось добавить в спринт", "Could not add to the sprint"));
      });
    }
    if (src.status === "active") {
      // Из идущего — только переносом с причиной: открываем то самое окно с доски.
      setBusy(true);
      try {
        const detail = await fetchSprintCycle(src.id);
        const item = detail.items.find((i) => i.task_id === taskId);
        if (!item) throw new Error(dt("Задача не найдена в идущем спринте", "The task is not in the running sprint"));
        close();
        setMoveItem({ item, cycleId: src.id, target: target.id });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (target.status === "draft") return void spanTo(target);
    return void run(() =>
      shiftBetweenDrafts(taskId, src.id, target.id, dt("Не удалось перенести", "Could not move the task"))
    );
  }

  const spaceTitle = (id: string | null) =>
    id === null ? dt("Без вкладки", "No tab") : spaceNames[id] ?? dt("Пространство", "Space");

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        data-testid="task-sprint-field"
        onClick={() => (open ? close() : setOpen(true))}
        className={propertyPillCls(mine.length > 0)}
      >
        <RoyIcon name="repeat" size={14} strokeWidth={1.9} className="shrink-0 text-ink-mute" />
        <span className="sr-only">{dt("Спринт", "Sprint")}: </span>
        <span className="min-w-0 max-w-[200px] truncate" style={{ fontSize: 12.5 }}>{label}</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          data-escape-layer=""
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, maxHeight: H }}
          className="z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {groups.map(([tab, list]) => (
              <div key={tab ?? "none"}>
                {groups.length > 1 && (
                  <p className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    {spaceTitle(tab)}
                  </p>
                )}
                {list.map((c) => {
                  const on = live.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      title={c.name}
                      disabled={busy}
                      onClick={() => void pick(c)}
                      className={cn(ROW, on && "bg-accent-soft text-accent-ink")}
                    >
                      <span className="w-3.5 shrink-0">{on && <RoyIcon name="check" size={13} strokeWidth={2.2} />}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {c.id === flagId ? "🏁 " : ""}
                        {cycleShort(c.name)}
                        <span className="ml-1.5 font-mono text-[11px] opacity-70">{cycleDates(c)}</span>
                      </span>
                      {c.status === "active" && (
                        <span className="shrink-0 rounded-full bg-primary/12 px-1.5 text-[10.5px] font-semibold text-primary">
                          {dt("идёт", "active")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                role="menuitem"
                className={ROW}
                onClick={() => {
                  close();
                  setSpanOpen(true);
                }}
              >
                <span className="w-3.5 shrink-0" />
                {dt("Несколько спринтов…", "Several sprints…")}
              </button>
              {mine.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  className={ROW}
                  onClick={() =>
                    void run(async () => {
                      for (const c of mine) await removeTaskFromSprintCycle(c.id, taskId);
                    })}
                >
                  <span className="w-3.5 shrink-0" />
                  {dt("Убрать из спринта", "Remove from sprint")}
                </button>
              )}
            </div>
          </div>

          {needReason && (
            <div className="flex flex-col gap-1.5 border-t border-line p-2">
              <span className="text-[12px] font-semibold text-pri-high">
                {dt("Нужна причина", "A reason is required")}
              </span>
              <textarea
                autoFocus
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label={dt("Причина", "Reason")}
                placeholder={dt("Например: ждём подрядчика", "For example: waiting for the contractor")}
                className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent-line"
              />
              <button
                type="button"
                disabled={busy || reason.trim().length === 0}
                onClick={() => void spanTo(needReason, reason)}
                className="self-end rounded-full border border-primary/50 bg-primary px-3 py-1 text-[12.5px] font-medium text-primary-foreground disabled:opacity-50"
              >
                {dt("Сохранить", "Save")}
              </button>
            </div>
          )}
          {err && <p className="border-t border-line px-3 py-1.5 text-[12px] text-pri-high">{err}</p>}
        </div>,
        document.body,
      )}

      <MoveDialog
        item={moveItem?.item ?? null}
        cycleId={moveItem?.cycleId ?? ""}
        cycles={sorted.filter((c) => c.status === "draft" && c.tab_id === (spaceOfTask ?? null))}
        initialTargetId={moveItem?.target ?? null}
        onClose={() => setMoveItem(null)}
        onDone={done}
      />
      <SpanDialog
        task={spanOpen ? { id: taskId, title: task.title, due: task.due_date } : null}
        cycles={options}
        current={live}
        onClose={() => setSpanOpen(false)}
        onDone={done}
      />
    </>
  );
}
