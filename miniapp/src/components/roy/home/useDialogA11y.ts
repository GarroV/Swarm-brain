"use client";
import { type RefObject, useEffect } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Доступность модального окна: фокус уходит внутрь, Esc закрывает, Tab не выпускает за пределы,
 * по закрытию фокус возвращается туда, откуда окно открыли (на стикер, а не в начало страницы).
 * Клик по подложке закрывает сам компонент — у него есть подложка.
 */
export function useDialogA11y(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (node.querySelector<HTMLElement>("[data-autofocus]") ?? node).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // onClose меняется на каждом рендере родителя; подписка нужна один раз на жизнь окна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}
