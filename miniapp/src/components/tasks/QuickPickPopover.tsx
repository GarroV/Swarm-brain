"use client";
// Компактный поповер «быстрый выбор из списка» (исполнитель / страна) — иконка-триггер +
// портал-список. Зеркалит механику DatePicker (портал в body, fixed по триггеру, флип у края
// экрана, клик-вне по trigger+popup, Escape, репозиция на scroll/resize) — чтобы не обрезаться
// внутри прокручиваемого списка задач. stopPropagation на триггере: клик не всплывает в строку
// (открытие карточки) и не съедается свайпом.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";

export type PickOption = { id: string; label: string; sub?: string };

type Props = {
  icon: RoyIconName;
  ariaLabel: string;
  options: PickOption[];
  value?: string;                 // id выбранной опции ("" — не задано)
  onPick: (id: string) => void;   // "" = очистить
  filter?: boolean;               // строка поиска сверху (для длинных списков)
  clearable?: boolean;            // пункт «Убрать»
};

const W = 240, H = 320;

export function QuickPickPopover({ icon, ariaLabel, options, value, onPick, filter, clearable }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

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
    setQ("");
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

  const shown = filter && q.trim()
    ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    : options;
  const pick = (id: string) => { onPick(id); setOpen(false); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        style={{ width: 26, height: 26, color: value ? "var(--accent-ink)" : "var(--ink-soft)" }}
      >
        <RoyIcon name={icon} size={15} strokeWidth={1.9} />
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, maxHeight: H }}
          className="z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          {filter && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск…"
              className="shrink-0 border-b border-line bg-transparent px-3 py-2 text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 13 }}
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {shown.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                className={`flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 ${o.id === value ? "text-accent-ink" : "text-ink"}`}
                style={{ fontSize: 13 }}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.sub && <span className="shrink-0 font-mono text-ink-mute" style={{ fontSize: 11 }}>{o.sub}</span>}
                {o.id === value && <RoyIcon name="check" size={14} strokeWidth={2.2} className="shrink-0" />}
              </button>
            ))}
            {shown.length === 0 && (
              <div className="px-2.5 py-3 text-center text-ink-mute" style={{ fontSize: 12 }}>Ничего не найдено</div>
            )}
          </div>
          {clearable && value && (
            <button
              type="button"
              onClick={() => pick("")}
              className="shrink-0 border-t border-line py-1.5 text-center text-ink-soft transition-colors hover:text-destructive"
              style={{ fontSize: 12 }}
            >
              Убрать
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
