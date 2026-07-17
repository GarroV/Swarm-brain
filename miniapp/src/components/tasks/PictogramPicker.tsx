"use client";
// Пиктограммный пикер: иконка-триггер + портал с сеткой пиктограмм (метки/флаги), тап = вкл/выкл.
// Портал-механику (fixed по триггеру, флип у края, клик-вне, Escape, репозиция) зеркалим у QuickPickPopover.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";

export type PictoOption = { id: string; label: string; icon?: RoyIconName; flag?: string };

type Props = {
  triggerIcon: RoyIconName;
  ariaLabel: string;
  options: PictoOption[];
  selected: string[];
  multi: boolean;
  onToggle: (id: string) => void;
  footer?: ReactNode;
};

const W = 248, H = 320;

export function PictogramPicker({ triggerIcon, ariaLabel, options, selected, multi, onToggle, footer }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const has = (id: string) => selected.includes(id);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - W - 8);
    const below = r.bottom + 6;
    const top = below + H > window.innerHeight - 8 && r.top > H ? r.top - H - 6 : below;
    setPos({ left: Math.max(8, left), top });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, place]);

  const pick = (id: string) => { onToggle(id); if (!multi) setOpen(false); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        style={{ width: 26, height: 26, color: selected.length ? "var(--accent-ink)" : "var(--ink-soft)" }}
      >
        <RoyIcon name={triggerIcon} size={15} strokeWidth={1.9} />
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, maxHeight: H }}
          className="z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 ${has(o.id) ? "text-accent-ink" : "text-ink"}`}
                style={{ fontSize: 13 }}
              >
                <span className="flex size-[18px] shrink-0 items-center justify-center">
                  {o.flag ? <span style={{ fontSize: 15 }}>{o.flag}</span> : o.icon ? <RoyIcon name={o.icon} size={15} strokeWidth={1.9} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {has(o.id) && <RoyIcon name="check" size={14} strokeWidth={2.2} className="shrink-0" />}
              </button>
            ))}
            {options.length === 0 && (
              <div className="px-2.5 py-3 text-center text-ink-mute" style={{ fontSize: 12 }}>Пусто</div>
            )}
          </div>
          {footer && <div className="shrink-0 border-t border-line p-1">{footer}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
