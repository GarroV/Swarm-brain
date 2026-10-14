"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchQuality } from "@/lib/api";
import { buildQuality, type QualityModel } from "@/lib/homeQuality";

// Баллы РС и РКО для главной: оба вида одним заходом при открытии. Не загрузился хоть один —
// показываем ошибку с «Повторить», а не половину картины: РС без РКО выглядел бы как «РКО нет».

export type QualityState = { data: QualityModel | null; loading: boolean; failed: boolean; retry: () => void };

export function useQuality(): QualityState {
  const [data, setData] = useState<QualityModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    Promise.allSettled([fetchQuality("rs"), fetchQuality("rko")]).then(([rs, rko]) => {
      if (!alive) return;
      if (rs.status === "fulfilled" && rko.status === "fulfilled") {
        setData(buildQuality(rs.value, rko.value));
      } else {
        const reason = rs.status === "rejected" ? rs.reason : rko.status === "rejected" ? rko.reason : null;
        console.warn("[home] quality", reason);
        setFailed(true);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, failed, retry };
}
