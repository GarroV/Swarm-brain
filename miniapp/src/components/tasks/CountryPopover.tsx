"use client";
// Выбор страны задачи: компактный чип-триггер (текущая страна) + портал-поповер с сеткой
// флагов. Раньше сетка была встроена прямо в форму и разъезжалась — теперь она контекстное меню.
// Механика портала/placement/клик-вне/Escape/репозиции зеркалит QuickPickPopover (модалка
// скроллится — absolute-поповер обрезался бы её overflow-y-auto, поэтому рендерим в body).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon } from "@/components/roy/icons";
import { countryName, countryFlag, countryCode } from "@/lib/countries";

type Props = {
  value: string;                 // id выбранной страны ("" = Global)
  codes: string[];               // коды стран для сетки (рынки воркспейса)
  onChange: (id: string) => void;
  // Триггер: "chip" — чип с текущей страной (форма); "icon" — компактная иконка-глобус
  // (плотная строка задачи). Тело поповера (сетка флагов) одинаково в обоих случаях.
  variant?: "chip" | "icon";
};

const W = 288, H = 300;

export function CountryPopover({ value, codes, onChange, variant = "chip" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
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

  const pick = (id: string) => { onChange(id); setOpen(false); };
  // stopPropagation: в строке задачи клик не должен всплывать в открытие карточки / съедаться свайпом.
  const toggle = (e: { stopPropagation: () => void }) => { e.stopPropagation(); setOpen((o) => !o); };

  return (
    <>
      {variant === "icon" ? (
        // Иконка-триггер (плотная строка задачи): глобус, подсвечен при выбранной стране.
        <button
          ref={btnRef}
          type="button"
          aria-label="Страна"
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggle}
          className="flex items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ width: 26, height: 26, color: value ? "var(--accent-ink)" : "var(--ink-soft)" }}
        >
          {value ? <span style={{ fontSize: 15 }}>{countryFlag(value)}</span> : <RoyIcon name="globe" size={15} strokeWidth={1.9} />}
        </button>
      ) : (
        // Чип-триггер (форма): текущая страна одной строкой; клик открывает сетку.
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
            value
              ? "border-primary bg-accent-soft text-accent-ink"
              : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"
          }`}
          style={{ fontSize: 13 }}
        >
          {value ? (
            <>
              <span style={{ fontSize: 15 }}>{countryFlag(value)}</span>
              <span className="truncate">{countryName(value)}</span>
            </>
          ) : (
            <>
              <RoyIcon name="globe" size={14} strokeWidth={1.9} />
              <span>Global</span>
            </>
          )}
          <RoyIcon
            name="cright"
            size={13}
            strokeWidth={1.9}
            className={`shrink-0 text-ink-mute transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
          />
        </button>
      )}

      {open && pos && createPortal(
        <div
          ref={popRef}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: W, maxHeight: H }}
          className="z-[100] flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl dark:backdrop-blur-lg"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => pick("")}
                title="Global"
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition-colors ${
                  !value
                    ? "border-primary bg-accent-soft text-accent-ink"
                    : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"
                }`}
                style={{ fontSize: 12 }}
              >
                <RoyIcon name="globe" size={13} strokeWidth={1.9} />
                Global
              </button>
              {codes.map((code) => {
                const on = countryCode(value) === countryCode(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => pick(code)}
                    title={countryName(code)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-semibold transition-colors ${
                      on
                        ? "border-primary bg-accent-soft text-accent-ink"
                        : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"
                    }`}
                    style={{ fontSize: 12 }}
                  >
                    <span style={{ fontSize: 12 }}>{countryFlag(code)}</span>
                    {countryCode(code)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
