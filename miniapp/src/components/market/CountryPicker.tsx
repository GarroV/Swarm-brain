"use client";
// Выбор страны одним выпадающим списком: стран много, ряд кнопок-чипов в шапке не читается.
// Кнопка — флаг, название, отметка «готово» точкой; список — все страны, у готовых метка «готово».
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useDt } from "@/components/roy/nav";

export function CountryPicker({ countries, value, ready, label, onPick }: {
  countries: string[];
  value: string | null;
  ready: string[];
  label: (c: string) => string;
  onPick: (c: string) => void;
}) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const hint = dt(
    "Страница проработана: все разделы заполнены, данные обновляются сами",
    "Page complete: all sections filled, data updates automatically",
  );
  const readyText = dt("готово", "ready");

  const options = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // Фокус на выбранной стране (или первой), чтобы стрелки работали сразу.
    const opts = options();
    (opts.find((o) => o.getAttribute("aria-selected") === "true") ?? opts[0])?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    const opts = options();
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      opts[(n + opts.length) % opts.length]?.focus();
    };
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(opts.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  const current = value ?? countries[0] ?? "";
  const currentReady = ready.includes(current);
  return (
    <div className="cpick" ref={root} data-export="skip">
      <button
        ref={btn}
        type="button"
        className="cpick-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={dt("Страна", "Country")}
        title={currentReady ? hint : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="cpick-name">{label(current)}</span>
        {currentReady && <span className="cpick-dot" aria-label={readyText} />}
        <ChevronDown size={16} aria-hidden="true" className="cpick-chev" />
      </button>
      {open && (
        <div className="cpick-pop" role="presentation">
          <div ref={list} role="listbox" aria-label={dt("Страна", "Country")} className="cpick-list" onKeyDown={onListKey}>
            {countries.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={c === current}
                tabIndex={-1}
                className="cpick-opt"
                onClick={() => {
                  onPick(c);
                  close(true);
                }}
              >
                <span className="cpick-name">{label(c)}</span>
                {ready.includes(c) && <span className="cpick-ready">{readyText}</span>}
                {c === current && <Check size={14} aria-hidden="true" className="cpick-check" />}
              </button>
            ))}
          </div>
          {ready.length > 0 && <p className="cpick-hint">{`● ${readyText} — ${hint.charAt(0).toLowerCase()}${hint.slice(1)}`}</p>}
        </div>
      )}
    </div>
  );
}
