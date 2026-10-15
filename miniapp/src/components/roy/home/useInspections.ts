"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchInspection, fetchInspections, type InspectionDetail, type InspectionsData } from "@/lib/api";
import { recall, remember } from "@/lib/lastSeen";

// Проверки Децимуса для виджета «Проверки»: список грузится, только пока виджет на главной;
// деталь — когда открыта панель проверки.

type Load<T> = { data: T | null; loading: boolean; failed: boolean; retry: () => void };

function useLoad<T>(load: () => Promise<T>, key: string, tag: string): Load<T> {
  // Повторный заход — сразу с прошлым ответом по этому ключу, обновление в фоне (#906).
  const memo = `home:${tag}:${key}`;
  const [data, setData] = useState<T | null>(() => recall<T>(memo));
  const [loading, setLoading] = useState(() => recall(memo) == null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(recall<T>(memo));
    setLoading(recall(memo) == null);
    setFailed(false);
    load().then((d) => {
      remember(memo, d);
      if (alive) setData(d);
    }).catch((e) => {
      if (!alive) return;
      console.warn(`[home] ${tag}`, e);
      setFailed(true);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
    // load меняется на каждом рендере; перезапуск — по ключу и по «Повторить».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, failed, retry };
}

export const useInspections = (): Load<InspectionsData> => useLoad(fetchInspections, "list", "inspections");
export const useInspection = (id: string): Load<InspectionDetail> => useLoad(() => fetchInspection(id), id, "inspection");
