import { flushSync } from "react-dom";

/**
 * Обновление состояния с анимацией «стикер раскрывается в карточку» — нативный View Transitions
 * API, без зависимостей. Браузер сам рисует морфинг между элементами с одинаковым
 * `viewTransitionName`. Нет API (Firefox до 144, старый Safari) или у человека включено
 * «уменьшить движение» — состояние просто меняется без анимации.
 *
 * `flushSync`: снимок «после» браузер делает по завершении колбэка, поэтому DOM обязан обновиться
 * до выхода из него, а не в следующем тике React.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof doc.startViewTransition === "function" && !reduce) {
    doc.startViewTransition(() => flushSync(update));
  } else {
    update();
  }
}
