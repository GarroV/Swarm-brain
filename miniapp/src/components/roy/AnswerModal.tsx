"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRoyNav } from "./nav";
import { AnswerBody } from "./screens/AnswerScreen";
import { RoyIcon } from "./icons";

// Контекстное окно ответа (десктоп) — поверх дашборда, как другие модалки. На мобайле
// показывается на весь экран (push идёт мимо — там AnswerScreen). Уточнения переспрашивают
// внутри окна, источник — закрывает окно и открывает запись.
export function AnswerModal({ query, onClose }: { query: string; onClose: () => void }) {
  const { push } = useRoyNav();
  const [q, setQ] = useState(query);

  useEffect(() => { setQ(query); }, [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 sm:items-start sm:p-6 sm:pt-[6vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Ответ"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full flex-col overflow-hidden border border-line bg-[var(--popover)] shadow-[0_24px_64px_-18px_rgba(0,0,0,.5)] dark:backdrop-blur-xl sm:max-w-[760px] sm:rounded-[20px]"
        style={{ maxHeight: "88vh" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <span className="flex items-center gap-2 font-bold text-ink" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
            <RoyIcon name="spark" size={17} className="text-primary" /> Ответ
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex items-center justify-center rounded-[10px] p-1.5 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <RoyIcon name="x" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <AnswerBody query={q} onFollowup={setQ} onOpenRecord={(id) => { onClose(); push({ view: "record", params: { id } }); }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
