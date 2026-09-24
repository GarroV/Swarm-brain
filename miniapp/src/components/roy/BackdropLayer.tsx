"use client";
import { useBackdrop } from "@/lib/useBackdrop";
import { GalaxyBackground } from "./GalaxyBackground";

// Слой задника ПОЗАДИ интерфейса (fixed, -z-10, pointer-events:none). Что рисовать — выбор
// пользователя (`lib/backdrop.ts`); прозрачность body/оболочки под задник — в globals.css
// по атрибуту `data-backdrop` на <html>.
export function BackdropLayer() {
  const id = useBackdrop();
  if (id === "galaxy") return <GalaxyBackground />;
  if (id === "dots" || id === "aurora") {
    return <div aria-hidden className={`roy-backdrop roy-backdrop-${id}`} />;
  }
  return null;
}
