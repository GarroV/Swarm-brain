"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RoyIcon } from "@/components/roy/icons";

// Кнопка-меню панели задач (стенд: `.drop` + `.dmenu`). Подсвечена, когда фильтр в ней
// что-то сузил: суженный молча список человек ищет глазами и не находит.

const EDGE = 8;
const MENU_MIN_H = 120;

export type MenuItem = {
  key: string;
  label: ReactNode;
  on?: boolean;
  onPick: () => void;
  // Пункт-действие (не фильтр): закрывает меню и не несёт галочки.
  action?: boolean;
};

export function ToolbarButton({ on, children, onClick, title, disabled, popup }: {
  on?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  /** Кнопка открывает меню: состояние для экранного диктора (aria-haspopup/aria-expanded). */
  popup?: { open: boolean };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-haspopup={popup ? "menu" : undefined}
      aria-expanded={popup ? popup.open : undefined}
      className={cn(
        // Кнопка панели по .btn стенда: 30px, рамка line-control, выбранная — акцентная рамка.
        "inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-45",
        on
          ? "border-primary bg-accent-soft font-semibold text-accent-ink"
          : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink",
      )}
      style={{ fontSize: 12.5 }}
    >
      {children}
    </button>
  );
}

export function Menu({ label, on, items, footer, trigger, title }: {
  label: ReactNode;
  on?: boolean;
  items: MenuItem[];
  footer?: ReactNode;
  /** Свой вид кнопки (выбор прямо в ячейке таблицы, стенд `cpick`); по умолчанию — кнопка панели. */
  trigger?: (p: { open: boolean; toggle: () => void }) => ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Куда раскрываться: у правого края таблицы — влево, у нижнего — вверх; высота — по месту.
  const [place, setPlace] = useState<{ right: boolean; up: boolean; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    const trig = ref.current?.getBoundingClientRect();
    const pop = popRef.current?.getBoundingClientRect();
    if (!trig || !pop) return;
    const below = innerHeight - trig.bottom - EDGE;
    const above = trig.top - EDGE;
    const up = pop.height > below && above > below;
    setPlace({
      right: trig.left + pop.width > innerWidth - EDGE,
      up,
      maxH: Math.max(MENU_MIN_H, Math.min(innerHeight * 0.6, up ? above : below)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative">
      {trigger ? trigger({ open, toggle: () => setOpen((v) => !v) }) : (
        <ToolbarButton on={on} popup={{ open }} title={title} onClick={() => setOpen((v) => !v)}>
          {label}
          <RoyIcon name="cright" size={11} strokeWidth={2.2} className="rotate-90 opacity-60" />
        </ToolbarButton>
      )}
      {open && (
        <div
          ref={popRef}
          role="menu"
          className={cn(
            "absolute z-50 flex max-h-[60vh] min-w-[200px] flex-col overflow-y-auto rounded-[10px] border border-line bg-[var(--popover)] p-1 shadow-[0_14px_36px_-12px_rgba(0,0,0,.35)]",
            place?.right ? "right-0" : "left-0",
            place?.up ? "bottom-full mb-1" : "top-full mt-1",
            !place && "invisible",
          )}
          style={place ? { maxHeight: place.maxH } : undefined}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => {
                it.onPick();
                if (it.action) setOpen(false);
              }}
              className={cn(
                "flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2",
                it.on ? "font-semibold text-accent-ink" : "text-ink",
              )}
              style={{ fontSize: 13 }}
            >
              <span className="w-3.5 shrink-0">
                {it.on && <RoyIcon name="check" size={13} strokeWidth={2.4} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </button>
          ))}
          {footer}
        </div>
      )}
    </span>
  );
}
