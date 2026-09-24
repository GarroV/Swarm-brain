"use client";
import { useEffect, useState } from "react";

// Граница «десктоп / мобайл». Десктопная раскладка (рейка, таблицы, панель справа) тянется вниз
// до узкого окна, мобильный вид — только на сверхузкой ширине (решение владельца 2026-09-25:
// «при сужении рамки браузера … адаптивную верстку. на мобилку переходим уже при сверх узкой
// рамке»). Та же граница — `--breakpoint-lg` в app/globals.css: `lg:`-классы и этот хук обязаны
// переключаться на одной ширине, иначе между ними появляется полоса «полу-мобайла».
export const DESKTOP_MIN_PX = 720;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_PX}px)`;

// На первом рендере/SSR — false (мобайл), после монтирования синхронизируется с реальной шириной.
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}
