"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchQuality } from "@/lib/api";
import { buildQuality, type QualityModel } from "@/lib/homeQuality";
import { recall, remember } from "@/lib/lastSeen";

// Баллы РС и РКО для главной: оба вида одним заходом при открытии. Не загрузился хоть один —
// показываем ошибку с «Повторить», а не половину картины: РС без РКО выглядел бы как «РКО нет».

const KEY = "home:quality";

export type QualityState = { data: QualityModel | null; loading: boolean; failed: boolean; retry: () => void };

export function useQuality(): QualityState {
  // Повторный заход — сразу с прошлыми баллами, обновление в фоне (#906).
  const [data, setData] = useState<QualityModel | null>(() => recall<QualityModel>(KEY));
  const [loading, setLoading] = useState(() => recall(KEY) == null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(recall(KEY) == null);
    setFailed(false);
    Promise.allSettled([fetchQuality("rs"), fetchQuality("rko")]).then(([rs, rko]) => {
      if (!alive) return;
      if (rs.status === "fulfilled" && rko.status === "fulfilled") {
        setData(remember(KEY, buildQuality(rs.value, rko.value)));
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
