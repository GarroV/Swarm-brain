"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchTasks, fetchTasksDelta } from "@/lib/api";
import { countMyOverdue } from "@/lib/navBadges";
import { createOverdueTaskSource } from "@/lib/overdueTasks";
import type { Me } from "@/types";

// Число моих просроченных задач для кружка на «Задачи» (issue #903). Первый GET /tasks,
// далее прежние триггеры догружают дельту; усечённая дельта — полный снимок (#492, часть).
// Запросы склеивает существующий request-cache, отдельного эндпоинта нет. Считает на
// клиенте через matchesLens/isOverdue — одно правило с доской. Обновляется по `refreshKey`
// (смена таба, правка задачи) и при возврате на вкладку. Ошибку глотаем: бейдж — фон,
// не повод ронять каркас (та же деградация, что у счётчика вычитки).
export function useOverdueCount(me: Me | null, refreshKey: unknown): number {
  const [count, setCount] = useState(0);
  const source = useMemo(() => createOverdueTaskSource({ full: fetchTasks, delta: fetchTasksDelta }), [me]);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const load = () => {
      source.refresh()
        .then((tasks) => {
          if (alive && tasks) setCount(countMyOverdue(tasks, me));
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
      source.cancelPending();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me, refreshKey, source]);
  return count;
}
