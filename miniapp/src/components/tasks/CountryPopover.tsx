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
};

const W = 288, H = 300;

export function CountryPopover({ value, codes, onChange }: Props) {
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

  return (
    <>
      {/* Чип-триггер: текущая страна одной строкой; клик открывает сетку */}
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
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

      {open && pos && createPortal(
        <div
          ref={popRef}
          role="menu"
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
