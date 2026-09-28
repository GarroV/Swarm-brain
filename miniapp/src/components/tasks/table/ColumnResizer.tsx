"use client";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { COLUMN_LIMITS, type ResizableColumn } from "@/lib/taskColumns";

// Ручка на правой границе ячейки шапки: тянешь — колонка меняет ширину, двойной клик —
// возврат к дефолту. С клавиатуры — стрелки (шаг 16px). Ячейка-родитель обязана быть relative.
const KEY_STEP = 16;

export function ColumnResizer({ col, label, width, onResize, onCommit, onReset }: {
  col: ResizableColumn;
  label: string;
  width: number;
  onResize: (px: number) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Край ячейки — ширина, середина — перестановка колонки: жест ручки до шапки не доходит.
    e.stopPropagation();
    e.preventDefault();
    // Старт — от ФАКТИЧЕСКОЙ ширины ячейки: у резиновой «Задачи» сохранённое число — это нижняя
    // граница, а на экране она шире.
    const cell = e.currentTarget.parentElement;
    drag.current = { x: e.clientX, w: cell ? cell.getBoundingClientRect().width : width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(drag.current.w + e.clientX - drag.current.x);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit();
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    onResize(width + (e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP));
    onCommit();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={COLUMN_LIMITS[col].min}
      aria-valuemax={COLUMN_LIMITS[col].max}
      tabIndex={0}
      data-col-resizer={col}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onReset}
      onKeyDown={(e) => { e.stopPropagation(); key(e); }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        // Внутри ячейки, а не поверх границы: вылезшая ручка последней колонки давала прокрутку вбок.
        "group/rs absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize touch-none select-none justify-end",
        "focus-visible:outline-none",
      )}
    >
      <span className="my-auto h-4 w-[3px] rounded-full bg-line-2 transition-colors group-hover/rs:bg-ink-mute group-focus-visible/rs:bg-primary group-active/rs:bg-primary" />
    </div>
  );
}
