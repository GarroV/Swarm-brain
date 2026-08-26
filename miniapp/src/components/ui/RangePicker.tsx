"use client";
// Выбор ПЕРИОДА (диапазона дат) для списка задач: пресеты «Эта неделя»/«Этот месяц»/… + сетка
// месяца с выбором диапазона в два клика (начало → конец, порядок не важен). Механика поповера
// зеркалит DatePicker/QuickPickPopover: портал в body, fixed по триггеру, флип у нижнего края,
// клик-вне по trigger+popup, Escape, репозиция на scroll/resize — иначе обрезается в рельсе.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon } from "@/components/roy/icons";
import { cn } from "@/lib/utils";
import { MONTHS, WEEKDAYS, parseISO, toISO, addMonths, buildGrid } from "@/lib/calendar";
import { RANGE_PRESETS, presetRange, customRange, rangeLabel, type DateRange } from "@/lib/dateRange";

type Props = {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  /** «rail» — строка в вертикальном рельсе (десктоп); «chip» — чип в ленте (мобайл). */
  variant?: "rail" | "chip";
};

const POPOVER_W = 272, POPOVER_H = 400;

export function RangePicker({ value, onChange, variant = "rail" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Первый клик по сетке: «якорь» диапазона. Пока он стоит, hover рисует превью будущего периода.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<Date>(() => (value ? parseISO(value.from) : null) ?? new Date());
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - POPOVER_W - 8);
    const below = r.bottom + 6;
    const top = below + POPOVER_H > window.innerHeight - 8 && r.top > POPOVER_H ? r.top - POPOVER_H - 6 : below;
    setPos({ left: Math.max(8, left), top });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    setAnchor(null);
    setHover(null);
    setView((value ? parseISO(value.from) : null) ?? new Date());
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const grid = useMemo(() => buildGrid(view), [view]);
  const todayISO = toISO(new Date());
  const active = value != null;
  const label = rangeLabel(value);

  // Что подсвечено в сетке: пока идёт выбор — превью «якорь → курсор», иначе выбранный период.
  const shown: DateRange | null = anchor ? customRange(anchor, hover ?? anchor) : value;

  const pickDay = (iso: string) => {
    if (!anchor) { setAnchor(iso); setHover(iso); return; }
    onChange(customRange(anchor, iso));
    setAnchor(null);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Период"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          variant === "chip"
            ? "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 font-semibold transition-colors"
            : "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold transition-colors",
          variant === "chip"
            ? (active ? "bg-primary text-white" : "bg-secondary text-secondary-foreground hover:bg-secondary/70")
            : (active ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-surface"),
        )}
        style={{ fontSize: variant === "chip" ? 12.5 : 13.5 }}
      >
        <RoyIcon name="cal" size={variant === "chip" ? 13 : 16} strokeWidth={active ? 2.1 : 1.8} />
        <span className={variant === "chip" ? undefined : "flex-1 truncate text-left"}>{label}</span>
        {active && variant === "rail" && (
          // Крестик очистки — прямо в строке рельса: снять период на один клик, не открывая поповер.
          <span
            role="button"
            tabIndex={0}
            aria-label="Сбросить период"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(null); } }}
            className="shrink-0 rounded p-0.5 text-accent-ink/70 hover:text-accent-ink"
          >
            <RoyIcon name="x" size={12} strokeWidth={2} />
          </span>
        )}
      </button>

      {open && pos && createPortal(
        <div ref={popRef} style={{ position: "fixed", left: pos.left, top: pos.top, width: POPOVER_W }}
          className="z-[100] rounded-xl border border-line bg-card shadow-xl p-2.5 dark:backdrop-blur-lg">
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            {RANGE_PRESETS.map(({ id, label: l }) => {
              const on = value?.preset === id;
              return (
                <button key={id} type="button"
                  onClick={() => { onChange(presetRange(id)); setOpen(false); }}
                  className={cn(
                    "rounded-lg border py-1 text-[11px] font-semibold transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground"
                       : "border-line bg-surface-2 text-ink-soft hover:bg-surface hover:text-ink",
                  )}>{l}</button>
              );
            })}
          </div>

          <div className="mb-1 flex items-center justify-between px-1">
            <button type="button" onClick={() => setView(addMonths(view, -1))}
              className="rounded-md p-1.5 text-ink-soft hover:bg-surface-2" aria-label="Предыдущий месяц"><RoyIcon name="cleft" size={14} /></button>
            <span className="text-sm font-semibold text-ink">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
            <button type="button" onClick={() => setView(addMonths(view, 1))}
              className="rounded-md p-1.5 text-ink-soft hover:bg-surface-2" aria-label="Следующий месяц"><RoyIcon name="cright" size={14} /></button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {WEEKDAYS.map((w) => <span key={w} className="py-0.5 text-center text-[10px] font-semibold text-ink-soft/70">{w}</span>)}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(anchor)}>
            {grid.map((d, i) => {
              if (!d) return <span key={i} />;
              const iso = toISO(d);
              const isEdge = shown != null && (iso === shown.from || iso === shown.to);
              const isInside = shown != null && iso > shown.from && iso < shown.to;
              const isToday = iso === todayISO;
              return (
                <button key={i} type="button"
                  onClick={() => pickDay(iso)}
                  onMouseEnter={() => setHover(iso)}
                  className={cn(
                    "h-8 text-[13px] font-medium transition-colors",
                    // Скругления только по краям диапазона — середина смыкается в сплошную ленту.
                    isEdge ? "bg-primary text-primary-foreground rounded-lg"
                      : isInside ? "bg-accent-soft text-accent-ink"
                        : isToday ? "rounded-lg font-bold text-primary hover:bg-surface-2"
                          : "rounded-lg text-ink hover:bg-surface-2",
                  )}>{d.getDate()}</button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            {anchor && (
              <span className="flex-1 px-1 text-[11px] text-ink-soft">Выберите конец периода</span>
            )}
            {!anchor && value && (
              <button type="button" onClick={() => { onChange(null); setOpen(false); }}
                className="flex-1 rounded-lg border border-line py-1.5 text-[12px] text-ink-soft transition-colors hover:border-destructive/40 hover:text-destructive">Сбросить период</button>
            )}
            {!anchor && !value && (
              <span className="flex-1 px-1 text-[11px] text-ink-soft">Или выберите период в календаре</span>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
