"use client";
import { useEffect, useState } from "react";

// lg-брейкпоинт Tailwind (1024px). На первом рендере/SSR — false (мобайл),
// после монтирования синхронизируется с реальной шириной.
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}
