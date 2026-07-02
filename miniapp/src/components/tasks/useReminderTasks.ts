"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMe, fetchTasks, updateTask, deleteTask, createTask } from "@/lib/api";
import type { Me, Task } from "@/types";
import {
  filterTasks, countLists, groupByMarket, groupByAssignee, isDone,
  type SmartListId, type Lens, type MarketGroup, type StaffGroup,
} from "@/lib/smartLists";
import { useRoyNav } from "@/components/roy/nav";

function todayISO(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Общее состояние Reminders-списка для десктопа и мобайла: загрузка, линза, активный
// смарт-список, локальный поиск, оптимистичные мутации (toggle/удаление/быстрое добавление).
export function useReminderTasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [activeList, setActiveList] = useState<SmartListId>("today");
  const [lens, setLens] = useState<Lens>("mine");
  const [query, setQuery] = useState("");
  const { taskView } = useRoyNav();

  // Стартовая линза от входа с дашборда (Мои/Команда) — применяем один раз при монтировании.
  useEffect(() => {
    if (taskView) {
      setLens(taskView.lens);
      if (taskView.list) setActiveList(taskView.list);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([fetchTasks(), fetchMe()]);
      setTasks(t);
      setMe(m);
    } catch {
      /* сохраняем текущее при ошибке поллинга */
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    const onVisibility = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const now = new Date();
  const list = tasks ?? [];
  const counts = useMemo(() => countLists(list, lens, me, now), [list, lens, me, now]);

  const matchesQuery = useCallback(
    (t: Task) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()),
    [query],
  );

  const visible: Task[] = useMemo(
    () => filterTasks(list, activeList, lens, me, now).filter(matchesQuery),
    [list, activeList, lens, me, now, matchesQuery],
  );

  // Линза «По рынкам» накладывается на активный смарт-список: группируем его задачи по странам.
  const marketGroups: MarketGroup[] = useMemo(
    () =>
      lens === "market"
        ? groupByMarket(list, activeList, me, now)
            .map((g) => ({ ...g, tasks: g.tasks.filter(matchesQuery) }))
            .filter((g) => g.tasks.length > 0)
        : [],
    [lens, activeList, list, me, now, matchesQuery],
  );

  // Линза «Все сотрудники» (админ): группируем задачи активного списка по исполнителю.
  const staffGroups: StaffGroup[] = useMemo(
    () =>
      lens === "staff"
        ? groupByAssignee(list, activeList, me, now)
            .map((g) => ({ ...g, tasks: g.tasks.filter(matchesQuery) }))
            .filter((g) => g.tasks.length > 0)
        : [],
    [lens, activeList, list, me, now, matchesQuery],
  );

  const toggle = useCallback(async (t: Task) => {
    const next = isDone(t) ? "open" : "done";
    setTasks((prev) => prev?.map((x) => (x.id === t.id ? { ...x, status: next } : x)) ?? null);
    try {
      await updateTask(t.id, { status: next });
    } catch {
      load();
    }
  }, [load]);

  const remove = useCallback(async (t: Task) => {
    setTasks((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
    try {
      await deleteTask(t.id);
    } catch {
      load();
      throw new Error("delete failed");
    }
  }, [load]);

  // Быстрое добавление в духе Reminders: контекстно по активному списку.
  const quickAdd = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const input: { title: string; assignee_telegram_id?: number; due_date?: string; priority?: string } = { title: trimmed };
    if (me) input.assignee_telegram_id = me.telegram_id;
    if (activeList === "today") input.due_date = todayISO(new Date());
    try {
      await createTask(input);
    } finally {
      load();
    }
  }, [me, activeList, load]);

  return {
    tasks, me, loading: tasks === null,
    activeList, setActiveList, lens, setLens, query, setQuery,
    counts, visible, marketGroups, staffGroups, now,
    toggle, remove, quickAdd, reload: load,
  };
}
