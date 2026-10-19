"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchAggregatorRatings, type AggregatorsData } from "@/lib/api";
import { recall, remember } from "@/lib/lastSeen";

const KEY = "home:aggregators";

// Оценки агрегаторов для вкладки «Агрегаторы»: грузятся, только пока вкладка открыта.

export type AggregatorsState = { data: AggregatorsData | null; loading: boolean; failed: boolean; retry: () => void };

export function useAggregators(): AggregatorsState {
  // Повторный заход — сразу с прошлыми оценками, обновление в фоне (#906).
  const [data, setData] = useState<AggregatorsData | null>(() => recall<AggregatorsData>(KEY));
  const [loading, setLoading] = useState(() => recall(KEY) == null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(recall(KEY) == null);
    setFailed(false);
    fetchAggregatorRatings().then((d) => {
      remember(KEY, d);
      if (alive) setData(d);
    }).catch((e) => {
      if (!alive) return;
      console.warn("[home] aggregators", e);
      setFailed(true);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, failed, retry };
}
