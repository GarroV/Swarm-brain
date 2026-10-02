"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RoyIcon } from "@/components/roy/icons";

// PDF-редактор окном поверх «Полезностей» (решение владельца 03.10.2026: «надо чтобы открывалось
// контекстное окно», а не новая вкладка). Сам редактор — отдельное приложение (GarroV/swarm-pdf)
// в iframe; его адрес разрешён в frame-src (scripts/gen-csp-headers.mjs).
//
// Правки PDF живут только внутри окна: что не сохранено кнопкой редактора, пропадает при закрытии.
// Состояние iframe другого сайта отсюда не прочитать, поэтому закрытие в два шага — первое
// нажатие (крестик, Esc, клик мимо) только спрашивает, второе закрывает.

type Dt = (ru: string, en: string) => string;

type Props = { url: string; dt: Dt; onClose: () => void };

// `?embed=1` — редактор прячет обвязку своего сайта (шапку, «к инструментам», подвал):
// в окне Swarm она лишняя и уводит из окна (swarm-pdf: src/js/logic/swarm-embed.ts).
const embedUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}embed=1`;

export function PdfEditorModal({ url, dt, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(true);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 max-[640px]:p-0"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirming(true); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dt("PDF-редактор", "PDF editor")}
        className="flex h-full max-h-[920px] w-full max-w-[1400px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.35)] max-[640px]:max-h-none max-[640px]:rounded-none max-[640px]:border-0"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <RoyIcon name="pdf" size={16} className={`text-ink-soft ${confirming ? "max-[640px]:hidden" : ""}`} />
          <span className={`whitespace-nowrap font-semibold text-ink ${confirming ? "max-[640px]:hidden" : ""}`} style={{ fontSize: 14 }}>
            {dt("PDF-редактор", "PDF editor")}
          </span>
          <span className="truncate text-ink-soft max-[640px]:hidden" style={{ fontSize: 12 }}>
            {dt("· файл не покидает браузер · сохраните его перед закрытием", "· the file never leaves your browser · save it before closing")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-ink" style={{ fontSize: 13 }}>{dt("Закрыть? Несохранённое пропадёт", "Close? Unsaved edits will be lost")}</span>
                <button type="button" onClick={onClose} autoFocus
                  className="rounded-[8px] bg-ink px-3 py-1.5 font-semibold text-surface" style={{ fontSize: 13 }}>
                  {dt("Закрыть", "Close")}
                </button>
                <button type="button" onClick={() => setConfirming(false)}
                  className="rounded-[8px] border border-line px-3 py-1.5 text-ink" style={{ fontSize: 13 }}>
                  {dt("Остаться", "Stay")}
                </button>
              </>
            ) : (
              <>
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="rounded-[8px] px-2.5 py-1.5 text-ink-soft hover:text-ink max-[640px]:hidden" style={{ fontSize: 13 }}>
                  {dt("Открыть в новой вкладке", "Open in a new tab")}
                </a>
                <button type="button" onClick={() => setConfirming(true)} aria-label={dt("Закрыть", "Close")}
                  className="rounded-[8px] p-1.5 text-ink-soft hover:text-ink">
                  <RoyIcon name="x" size={18} />
                </button>
              </>
            )}
          </div>
        </div>
        <iframe
          src={embedUrl(url)}
          title={dt("PDF-редактор", "PDF editor")}
          allow="clipboard-read; clipboard-write; local-fonts"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      </div>
    </div>,
    document.body,
  );
}
