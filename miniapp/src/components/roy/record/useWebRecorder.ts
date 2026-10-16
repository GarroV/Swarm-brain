"use client";
// Тонкая обвязка движка записи для React: один движок на открытый экран записи.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRoyNav } from "../nav";
import { WebRecorder, type RecorderSnapshot } from "@/lib/webRecorder";

/**
 * Длина куска для ручной проверки: `localStorage["swarm.recSegSeconds"] = "8"` работает только
 * в `next dev` (приложение стирает query из адреса, поэтому не параметр). В боевой сборке
 * NODE_ENV вшит как "production", и ветка выкидывается целиком.
 */
function devSegmentSeconds(): number | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  try {
    const v = Number(localStorage.getItem("swarm.recSegSeconds"));
    return v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function useWebRecorder(): { engine: WebRecorder; snap: RecorderSnapshot } {
  const ownerId = useRoyNav().me?.telegram_id ?? null;
  const [engine] = useState(() => new WebRecorder({ segmentSeconds: devSegmentSeconds(), ownerId }));
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  // Экран закрыт — отпускаем микрофон; недосланное подберёт восстановление при следующем входе.
  useEffect(() => {
    engine.attach();
    return () => engine.dispose();
  }, [engine]);
  return { engine, snap };
}
