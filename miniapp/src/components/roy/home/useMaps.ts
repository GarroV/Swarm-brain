"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchMapsRatings, type MapsData } from "@/lib/api";
import { recall, remember } from "@/lib/lastSeen";

const KEY = "home:maps";

// Рейтинги карт для виджета «Карты и отзывы»: грузятся, только пока виджет на главной.

export type MapsState = { data: MapsData | null; loading: boolean; failed: boolean; retry: () => void };

export function useMaps(): MapsState {
  // Повторный заход — сразу с прошлыми рейтингами, обновление в фоне (#906).
  const [data, setData] = useState<MapsData | null>(() => recall<MapsData>(KEY));
  const [loading, setLoading] = useState(() => recall(KEY) == null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(recall(KEY) == null);
    setFailed(false);
    fetchMapsRatings().then((d) => {
      remember(KEY, d);
      if (alive) setData(d);
    }).catch((e) => {
      if (!alive) return;
      console.warn("[home] maps", e);
      setFailed(true);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, failed, retry };
}
