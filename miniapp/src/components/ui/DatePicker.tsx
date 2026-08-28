"use client";
// Кастомный date-picker «Рой»: тёплая палитра/янтарь, RU-локаль, пресеты, «убрать срок».
// Drop-in замена <input type="date">: value/onChange — ISO-строка "YYYY-MM-DD" ("" = срока нет).
// Поповер рендерится в портал (fixed по триггеру) — не обрезается внутри модалки с overflow.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { propertyRowCls, PropertyLabel, PropertyValue, PropertyChevron } from "@/components/ui/PropertyRow";
import { MONTHS, WEEKDAYS, parseISO, toISO, fmtFull, addMonths, buildGrid } from "@/lib/calendar";

// Подпись даты в триггере: «12 августа 2026» (общий формат — lib/calendar).
const fmtTrigger = fmtFull;

type Props = {
  value: string;                     // ISO "YYYY-MM-DD" или ""
  onChange: (iso: string) => void;   // "" = срок убран
  className?: string;
  placeholder?: string;
  /**
   * Вид триггера:
   *  «field» — поле с рамкой (форма создания задачи);
   *  «compact» — только иконка, для быстрых действий в строке задачи;
   *  «row» — тихая строка свойства «иконка · подпись · значение» (карточка задачи).
   */
  variant?: "field" | "compact" | "row";
  /** Иконка триггера: «cal» — срок (по умолчанию), «bell» — пинг (напоминание). */
  icon?: RoyIconName;
  /** Название свойства: подпись для скринридера, а в виде «row» — ещё и видимая подпись строки. */
  ariaLabel?: string;
  /** Подпись «убрать» в поповере (по умолчанию «Убрать срок»). */
  clearLabel?: string;
};

const POPOVER_W = 264, POPOVER_H = 340;

export function DatePicker({ value, onChange, className = "", placeholder = "Выбрать дату", variant = "field", icon = "cal", ariaLabel = "Срок", clearLabel = "Убрать срок" }: Props) {
  const isCompact = variant === "compact";
  const isRow = variant === "row";
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Date>(() => parseISO(value) ?? new Date());

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
    setView(parseISO(value) ?? new Date());
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
  const label = fmtTrigger(value);

  const pick = (d: Date) => { onChange(toISO(d)); setOpen(false); };
  const preset = (days: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); pick(d); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={variant === "field" ? undefined : ariaLabel}
        // stopPropagation — чтобы клик не «всплыл» как тап по строке задачи (открытие карточки)
        // и не съелся как старт свайпа (SwipeRow на мобайле). См. чекбокс TaskRow.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={isCompact ? className : isRow ? `${propertyRowCls} ${className}` : `${className} flex items-center gap-2 text-left`}
        style={isCompact ? { color: value ? "var(--accent-ink)" : "var(--ink-soft)" } : undefined}
      >
        {isRow ? (
          <>
            <PropertyLabel icon={icon}>{ariaLabel}</PropertyLabel>
            <PropertyValue muted={!label}>{label ?? placeholder}</PropertyValue>
            <PropertyChevron />
          </>
        ) : (
          <>
            <RoyIcon name={icon} size={15} strokeWidth={isCompact ? 1.9 : undefined} />
            {!isCompact && <span className={label ? "text-ink" : "text-ink-soft"}>{label ?? placeholder}</span>}
          </>
        )}
      </button>

      {open && pos && createPortal(
        <div ref={popRef} style={{ position: "fixed", left: pos.left, top: pos.top, width: POPOVER_W }}
          className="z-[100] rounded-xl border border-line bg-card shadow-xl p-2.5 dark:backdrop-blur-lg">
          <div className="flex gap-1.5 mb-2">
            {([["Сегодня", 0], ["Завтра", 1], ["+неделя", 7]] as const).map(([l, n]) => (
              <button key={l} type="button" onClick={() => preset(n)}
                className="flex-1 rounded-lg bg-surface-2 border border-line text-[11px] font-semibold py-1 text-ink-soft hover:text-ink hover:bg-surface">{l}</button>
            ))}
          </div>

          <div className="flex items-center justify-between px-1 mb-1">
            <button type="button" onClick={() => setView(addMonths(view, -1))}
              className="p-1.5 rounded-md hover:bg-surface-2 text-ink-soft" aria-label="Предыдущий месяц"><RoyIcon name="cleft" size={14} /></button>
            <span className="text-sm font-semibold text-ink">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
            <button type="button" onClick={() => setView(addMonths(view, 1))}
              className="p-1.5 rounded-md hover:bg-surface-2 text-ink-soft" aria-label="Следующий месяц"><RoyIcon name="cright" size={14} /></button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w) => <span key={w} className="text-center text-[10px] font-semibold text-ink-soft/70 py-0.5">{w}</span>)}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((d, i) => {
              if (!d) return <span key={i} />;
              const iso = toISO(d);
              const isSel = iso === value;
              const isToday = iso === todayISO;
              return (
                <button key={i} type="button" onClick={() => pick(d)}
                  className={`h-8 rounded-lg text-[13px] font-medium transition-colors ${
                    isSel ? "bg-primary text-primary-foreground"
                      : isToday ? "text-primary font-bold hover:bg-surface-2"
                        : "text-ink hover:bg-surface-2"}`}>{d.getDate()}</button>
              );
            })}
          </div>

          {value && (
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}
              className="w-full mt-2 rounded-lg border border-line text-[12px] py-1.5 text-ink-soft hover:text-destructive hover:border-destructive/40 transition-colors">{clearLabel}</button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
