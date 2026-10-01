"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDt } from "./nav";

// Панель справа (десктоп) — одна на весь продукт: карточки задач и встреч (DetailPanel в RoyApp)
// и пояснения экранов вроде «Настроек» (решение владельца 2026-09-30: «при нажатии на элементы
// я ожидаю что справа будет появляться пояснение»). Esc и клик мимо закрывают её, но не когда
// поверх открыто окно (у него свой Esc) и не во время правки текста ([data-panel-edit]).

/** Контейнер, у правого края которого стоит панель; задаёт RoyApp. */
export const PanelHostContext = createContext<HTMLElement | null>(null);

export function SidePanelFrame({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const dt = useDt();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")) return;
      // Идёт правка текста (TezisyEditor и поля с data-panel-edit) — Esc отменяет её, а не закрывает панель.
      if (document.activeElement?.closest("[data-panel-edit]")) return;
      onClose();
    };
    // capture: проверяем до того, как окно поверх обработает Esc и исчезнет из DOM.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <>
      <button type="button" aria-label={dt("Закрыть панель", "Close the panel")} onClick={onClose}
        className="absolute inset-0 z-40 cursor-default bg-[rgba(10,13,17,.12)]" />
      <aside aria-label={label}
        className="roy-pop absolute inset-y-0 right-0 z-40 flex w-[560px] max-w-[96vw] flex-col overflow-hidden border-l border-line bg-background shadow-[-12px_0_40px_rgba(10,13,17,.12)] min-[1560px]:w-[640px]">
        {children}
      </aside>
    </>
  );
}

/** Панель справа с заголовком для экранов, которые не маршруты: рендерится порталом в хост RoyApp. */
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dt = useDt();
  const host = useContext(PanelHostContext);
  if (!host) return null;
  return createPortal(
    <SidePanelFrame label={title} onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="font-semibold text-ink" style={{ fontSize: 15 }}>{title}</h2>
        <button type="button" onClick={onClose} title="Esc"
          className="rounded-full border border-line px-2.5 py-1 font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
          style={{ fontSize: 12 }}>
          {dt("Закрыть", "Close")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </SidePanelFrame>,
    host,
  );
}
