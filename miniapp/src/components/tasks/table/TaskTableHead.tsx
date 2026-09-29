"use client";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDt } from "@/components/roy/nav";
import type { ColumnLayout, MovableColumn, ResizableColumn, TaskColumn } from "@/lib/taskColumns";
import { ColumnResizer } from "./ColumnResizer";
import { NARROW_HIDDEN, TASK_GRID } from "./TaskTableRow";

// Шапка таблицы задач. Два жеста на одной ячейке (владелец 28.09.2026: «давай сделаем
// перетаскивание»): за край — ширина (ColumnResizer), за середину — порядок колонки. «Задача»
// всегда первая и не переезжает. С клавиатуры: фокус на ячейке, Alt+←/→ — сдвиг на одну позицию.

// Сдвиг меньше порога — это клик, а не перетаскивание.
const DRAG_THRESHOLD = 4;

const LABELS: Record<TaskColumn, [string, string]> = {
  task: ["Задача", "Task"],
  due: ["Срок", "Due"],
  actions: ["", ""],
  market: ["Рынок", "Market"],
  project: ["Проект", "Project"],
  assignee: ["Исполнитель", "Assignee"],
  lists: ["Списки", "Lists"],
};
const RESIZABLE = new Set<TaskColumn>(["task", "project", "assignee", "lists"]);
const NARROW = new Set<TaskColumn>(["project", "lists"]);

export function TaskTableHead({ layout, onResize, onCommit, onResetWidth, onMove }: {
  layout: ColumnLayout;
  onResize: (col: ResizableColumn, px: number) => void;
  onCommit: () => void;
  onResetWidth: (col: ResizableColumn) => void;
  onMove: (col: MovableColumn, target: MovableColumn) => void;
}) {
  const dt = useDt();
  const rowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ col: MovableColumn; x: number; active: boolean } | null>(null);
  const [dragCol, setDragCol] = useState<MovableColumn | null>(null);
  const [overCol, setOverCol] = useState<MovableColumn | null>(null);

  // Колонка под курсором — по видимым ячейкам шапки (скрытые на узкой раскладке шириной 0).
  const colAt = (x: number): MovableColumn | null => {
    const cells = rowRef.current?.querySelectorAll<HTMLElement>("[data-movable]") ?? [];
    for (const el of cells) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x < r.right) return el.dataset.col as MovableColumn;
    }
    return null;
  };

  const down = (col: MovableColumn) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    drag.current = { col, x: e.clientX, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active && Math.abs(e.clientX - d.x) < DRAG_THRESHOLD) return;
    if (!d.active) {
      d.active = true;
      setDragCol(d.col);
    }
    setOverCol(colAt(e.clientX));
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const target = d?.active ? colAt(e.clientX) : null;
    setDragCol(null);
    setOverCol(null);
    if (d && target && target !== d.col) onMove(d.col, target);
  };
  const key = (col: MovableColumn) => (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const i = layout.order.indexOf(col);
    const target = layout.order[i + (e.key === "ArrowRight" ? 1 : -1)];
    if (target) onMove(col, target);
  };

  const cell = (col: TaskColumn): ReactNode => {
    const [ru, en] = LABELS[col];
    const label = dt(ru, en);
    const movable = col !== "task";
    const name = label || dt("Быстрые действия", "Quick actions");
    return (
      <span
        key={col}
        data-col={col}
        data-movable={movable || undefined}
        tabIndex={movable ? 0 : undefined}
        title={movable ? dt("Перетащите, чтобы переставить колонку", "Drag to reorder the column") : undefined}
        aria-label={movable ? dt(`${name}: Alt+←/→ — переставить`, `${name}: Alt+←/→ to reorder`) : undefined}
        onPointerDown={movable ? down(col) : undefined}
        onPointerMove={movable ? move : undefined}
        onPointerUp={movable ? up : undefined}
        onPointerCancel={movable ? up : undefined}
        onKeyDown={movable ? key(col) : undefined}
        className={cn(
          "relative flex h-full min-w-0 select-none items-center transition-colors",
          col === "task" ? "px-3" : "px-2",
          movable && "cursor-grab touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
          dragCol === col && "cursor-grabbing bg-surface opacity-60",
          overCol === col && dragCol !== col && "bg-accent-soft text-accent-ink",
          NARROW.has(col) && NARROW_HIDDEN,
        )}
      >
        <span className="truncate">{label}</span>
        {RESIZABLE.has(col) && (
          <ColumnResizer
            col={col as ResizableColumn}
            label={dt(`Ширина колонки «${name}»`, `Resize column “${name}”`)}
            width={layout.widths[col as ResizableColumn]}
            onResize={(px) => onResize(col as ResizableColumn, px)}
            onCommit={onCommit}
            onReset={() => onResetWidth(col as ResizableColumn)}
          />
        )}
      </span>
    );
  };

  return (
    <div
      ref={rowRef}
      role="row"
      data-task-head
      // Шапка по стенду (.th): капс, разрядка, серая подложка — визуальный шаг В2.
      className={cn("sticky top-0 z-10 grid border-b border-line bg-surface-2 font-semibold uppercase text-ink-soft", TASK_GRID)}
      style={{ fontSize: 10.5, letterSpacing: "0.07em", height: 32, alignItems: "center" }}
    >
      {cell("task")}
      {layout.order.map(cell)}
    </div>
  );
}
