"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon } from "../icons";

// Стеклянная кнопка «Карта проекта» (над блоком встреч на дашборде) → полноэкранный
// оверлей с интерактивной картой системы (статический /system-map.html в iframe).
// Self-contained: своё состояние open + портал в body, не трогает RoyApp/nav.
export function ProjectMapButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex shrink-0 items-center gap-3 rounded-[18px] border border-line bg-surface px-4 py-3 text-left transition-[transform,background] hover:-translate-y-px hover:bg-surface-2 active:scale-[0.99] dark:backdrop-blur-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-[12px]"
          style={{ width: 38, height: 38, background: "var(--accent-soft)", color: "var(--accent-ink)" }}
        >
          <MapGlyph />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-ink" style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Карта проекта</span>
          <span className="block text-ink-soft" style={{ fontSize: 12 }}>Архитектура и связи системы</span>
        </span>
        <RoyIcon name="cright" size={18} className="shrink-0 text-ink-soft transition-transform group-hover:translate-x-0.5" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: "#0A0C0A" }}>
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
            <span className="flex items-center gap-2 font-bold text-ink" style={{ fontSize: 15 }}>
              <span className="inline-flex items-center justify-center" style={{ color: "var(--accent-ink)" }}><MapGlyph /></span>
              Карта проекта
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть карту"
              className="flex items-center justify-center rounded-[10px] border border-line-2 bg-surface px-2.5 py-1.5 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <RoyIcon name="x" size={18} />
              <span className="ml-1.5 font-semibold" style={{ fontSize: 13 }}>Закрыть</span>
            </button>
          </div>
          <iframe src="/system-map.html" title="Карта проекта" className="min-h-0 w-full flex-1 border-0" />
        </div>,
        document.body,
      )}
    </>
  );
}

// Мини-созвездие узлов — на тему «галактика / граф системы».
function MapGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4" cy="6" r="2" />
      <circle cx="15.5" cy="4.5" r="2" />
      <circle cx="11" cy="15" r="2" />
      <path d="M6 6.4 13.5 4.8 M5.4 7.6 9.8 13.2 M14 6.3 12 13.2" />
    </svg>
  );
}
