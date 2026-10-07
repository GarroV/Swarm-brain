import { useEffect, useState } from "react";

/**
 * Флажок экрана спринтов, который помнится между заходами («План» открыт, «Скрыть готовые»,
 * «Мои задачи»). Хранилище недоступно (приватное окно) — флажок просто живёт до перезагрузки.
 * Чтение — в эффекте: на сервере и в первом рендере localStorage нет.
 */
export function useStoredFlag(
  key: string,
  initial: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "1" || saved === "0") setValue(saved === "1");
    } catch { /* приватное окно: остаётся значение по умолчанию */ }
  }, [key]);

  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch { /* не запомнили — не беда */ }
  };

  return [value, set];
}
