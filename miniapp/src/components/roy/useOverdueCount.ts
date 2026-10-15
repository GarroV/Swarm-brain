"use client";
import { useEffect, useState } from "react";
import { fetchTasks } from "@/lib/api";
import { countMyOverdue } from "@/lib/navBadges";
import type { Me } from "@/types";

// Число моих просроченных задач для кружка на «Задачи» (issue #903). Берёт тот же GET /tasks,
// что и экраны задач (запросы склеивает request-cache, отдельного эндпоинта нет), и считает на
// клиенте через matchesLens/isOverdue — одно правило с доской. Обновляется по `refreshKey`
// (смена таба, правка задачи) и при возврате на вкладку. Ошибку глотаем: бейдж — фон,
// не повод ронять каркас (та же деградация, что у счётчика вычитки).
export function useOverdueCount(me: Me | null, refreshKey: unknown): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const load = () => {
      fetchTasks()
        .then((tasks) => {
          if (alive) setCount(countMyOverdue(tasks, me));
        })
        .catch((e) => console.warn("[useOverdueCount]", e));
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me, refreshKey]);
  return count;
}
