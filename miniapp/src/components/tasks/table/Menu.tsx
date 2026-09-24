"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RoyIcon } from "@/components/roy/icons";

// Кнопка-меню панели задач (стенд: `.drop` + `.dmenu`). Подсвечена, когда фильтр в ней
// что-то сузил: суженный молча список человек ищет глазами и не находит.

export type MenuItem = {
  key: string;
  label: ReactNode;
  on?: boolean;
  onPick: () => void;
  // Пункт-действие (не фильтр): закрывает меню и не несёт галочки.
  action?: boolean;
};

export function ToolbarButton({ on, children, onClick, title, disabled }: {
  on?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
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

export function Menu({ label, on, items, footer }: {
  label: ReactNode;
  on?: boolean;
  items: MenuItem[];
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

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
      <ToolbarButton on={on} onClick={() => setOpen((v) => !v)}>
        {label}
        <RoyIcon name="cright" size={11} strokeWidth={2.2} className="rotate-90 opacity-60" />
      </ToolbarButton>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 flex max-h-[60vh] min-w-[200px] flex-col overflow-y-auto rounded-[9px] border border-line bg-[var(--popover)] p-1 shadow-[0_14px_36px_-12px_rgba(0,0,0,.35)]"
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
