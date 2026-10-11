"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchMapsRatings, type MapsData } from "@/lib/api";

// Рейтинги карт для виджета «Карты и отзывы»: грузятся, только пока виджет на главной.

export type MapsState = { data: MapsData | null; loading: boolean; failed: boolean; retry: () => void };

export function useMaps(): MapsState {
  const [data, setData] = useState<MapsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetchMapsRatings().then((d) => {
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
