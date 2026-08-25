"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMe, fetchTasks, updateTask, deleteTask, createTask, fetchTaskLabels, type TaskLabel, type CreateTaskInput } from "@/lib/api";
import type { Me, Task } from "@/types";
import {
  filterTasks, countLists, groupByMarket, groupByAssignee, groupByAssigneeThenMarket, isDone, filterByLabel, countByLabel,
  type SmartListId, type Lens, type MarketGroup, type StaffGroup, type NestedStaffGroup,
} from "@/lib/smartLists";
import { resolveRange, type DateRange } from "@/lib/dateRange";
import { useRoyNav } from "@/components/roy/nav";

function todayISO(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Последний выбранный вид доски — переживает рефреш (localStorage). Читаем в ленивом
// инициализаторе useState, а НЕ в эффекте: эффект-сохранение на маунте затирал бы значение
// дефолтом раньше, чем restore применится (в dev StrictMode эффекты ещё и сдваиваются).
type SavedTasksView = { activeList?: SmartListId; activeLabelId?: string | null; lens?: Lens; byMarket?: boolean; allStaff?: boolean; range?: DateRange | null };
function readSavedView(): SavedTasksView | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem("roy_tasks_view");
    return raw ? (JSON.parse(raw) as SavedTasksView) : null;
  } catch { return null; }
}

// Общее состояние Reminders-списка для десктопа и мобайла: загрузка, линза, активный
// смарт-список, локальный поиск, оптимистичные мутации (toggle/удаление/быстрое добавление).
export function useReminderTasks() {
  const { taskView } = useRoyNav();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  // Начальный вид: приоритет — вход с дашборда (taskView), иначе сохранённый в localStorage
  // (чтобы рефреш НЕ сбрасывал на «Сегодня»). Дашбордный вход — без активной метки.
  const [activeList, setActiveList] = useState<SmartListId>(() => taskView?.list ?? readSavedView()?.activeList ?? "today");
  const [lens, setLens] = useState<Lens>(() => taskView?.lens ?? readSavedView()?.lens ?? "mine");
  // «По рынкам» и «Все сотрудники» — независимые тумблеры (не значения lens), см. smartLists.ts.
  // «Все сотрудники» (только админ) переопределяет охват на линзу «staff» = буквально все, включая
  // чужие личные, независимо от lens (владелец 2026-08-19: «если включен тумблер всё сотрудники —
  // подтягиваются задачи всех сотрудников»).
  const [byMarket, setByMarket] = useState<boolean>(() => readSavedView()?.byMarket ?? false);
  const [allStaffRaw, setAllStaff] = useState<boolean>(() => readSavedView()?.allStaff ?? false);
  // Гард «Все сотрудники» — ЗДЕСЬ, а не только в UI: спрятать чип недостаточно, состояние живёт в
  // localStorage (`roy_tasks_view.allStaff`) и переживает потерю админства/правку хранилища вручную,
  // а включённый тумблер даёт охват «staff» = чужие личные задачи. Пока личность неизвестна
  // (`me == null`) считаем НЕ админом — fail-closed.
  const allStaff = allStaffRaw && !!me?.is_admin;
  const effLens: Lens = allStaff ? "staff" : lens;
  // Период — модификатор поверх активного списка (см. lib/dateRange.ts). Восстанавливаем через
  // resolveRange: пресет пересчитывается ОТ СЕГОДНЯ, иначе сохранённая «эта неделя» через неделю
  // молча показывала бы прошлую. Произвольный диапазон берётся как есть.
  const [range, setRange] = useState<DateRange | null>(() => resolveRange(readSavedView()?.range));
  const [query, setQuery] = useState("");
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(() => (taskView ? null : readSavedView()?.activeLabelId ?? null));

  // Сохраняем выбранный вид (список/метка/линза/тумблеры), чтобы он пережил рефреш страницы.
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        // allStaff сохраняем ЭФФЕКТИВНЫЙ (у не-админа протухший true вычищается из хранилища),
        // но пока `me` не загрузился — оставляем как было, иначе первый рендер стёр бы выбор админа.
        const staffToSave = me == null ? allStaffRaw : allStaff;
        window.localStorage.setItem("roy_tasks_view", JSON.stringify({ activeList, activeLabelId, lens, byMarket, allStaff: staffToSave, range }));
      }
    } catch { /* storage недоступен — игнор */ }
  }, [activeList, activeLabelId, lens, byMarket, allStaff, allStaffRaw, me, range]);

  // Оптимистично добавленные задачи (по реальному id из ответа POST/PATCH). Держим их поверх
  // серверной выборки, пока сервер не вернёт их в списке — иначе фоновый поллинг «моргает»
  // только что добавленной задачей (GET, стартовавший за миг до коммита, вернёт список без неё).
  const pendingRef = useRef<Map<string, Task>>(new Map());
  const mergePending = useCallback((server: Task[]): Task[] => {
    const pend = pendingRef.current;
    if (pend.size === 0) return server;
    const ids = new Set(server.map((t) => t.id));
    const extra: Task[] = [];
    for (const [id, task] of pend) {
      if (ids.has(id)) pend.delete(id); // сервер подтвердил — снимаем оптимистичную
      else extra.push(task);            // ещё не в выборке — держим
    }
    return extra.length ? [...extra, ...server] : server;
  }, []);

  // Момент последней мутации: фон делает паузу ~4с после действия, чтобы не «откатить» только
  // что изменённое (запись успевает закоммититься до следующего фонового GET).
  const lastMutationRef = useRef(0);
  const markMutation = useCallback(() => { lastMutationRef.current = Date.now(); }, []);

  // Фон каждые 10с тянет ТОЛЬКО задачи (они меняются). Профиль и метки — редкие: грузим на
  // маунте и при возврате фокуса, а не в поллинге (меньше вызовов Edge Function, меньше «дыхания»).
  const loadTasks = useCallback(async () => {
    try { setTasks(mergePending(await fetchTasks())); } catch { /* оставляем текущее при ошибке */ }
  }, [mergePending]);
  const loadMeta = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([fetchMe(), fetchTaskLabels()]);
      setMe(m);
      setLabels(l);
    } catch { /* оставляем текущее */ }
  }, []);
  const load = useCallback(async () => { await Promise.all([loadTasks(), loadMeta()]); }, [loadTasks, loadMeta]);
  const reloadLabels = useCallback(() => { fetchTaskLabels().then(setLabels).catch(() => {}); }, []);
  // Рефетч после мутации (модалка/строка): помечаем мутацию (пауза фона) + тянем задачи.
  const reload = useCallback(() => { markMutation(); return loadTasks(); }, [markMutation, loadTasks]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (Date.now() - lastMutationRef.current < 4_000) return; // пауза после действия — фон не моргает
      loadTasks();
    }, 10_000);
    const onVisibility = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, loadTasks]);

  // now фиксируем по данным, а не пересоздаём каждый рендер — иначе useMemo ниже (counts/visible/
  // группы) инвалидируются на каждый ввод/ховер. Меняется вместе с задачами (поллинг раз в 10с).
  const now = useMemo(() => new Date(), [tasks]);
  const list = tasks ?? [];
  // effLens — «Все сотрудники» (админ) расширяет охват до линзы «staff» независимо от Мои/Команда/Все
  // (см. объявление effLens выше). Счётчики рельса тоже считаем по нему — иначе цифры в рельсе
  // (Сегодня/Ближайшие/…) не совпадали бы с тем, что реально показано при включённом тумблере.
  const counts = useMemo(() => countLists(list, effLens, me, now, range), [list, effLens, me, now, range]);

  const matchesQuery = useCallback(
    (t: Task) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()),
    [query],
  );
  // Текстовый поиск — на исходном списке, ДО линзы/группировки: и плоский visible, и все виды
  // группировки читают из queried, поэтому фильтр по тексту работает одинаково everywhere.
  const queried = useMemo(() => list.filter(matchesQuery), [list, matchesQuery]);

  const visible: Task[] = useMemo(
    () => filterTasks(queried, activeList, effLens, me, now, range),
    [queried, activeList, effLens, me, now, range],
  );

  // Персональные списки-метки: счётчики по всем меткам + задачи активной метки.
  const labelCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of labels) m[l.id] = countByLabel(list, l.id, range);
    return m;
  }, [labels, list, range]);
  const visibleByLabel: Task[] = useMemo(
    () => (activeLabelId ? filterByLabel(queried, activeLabelId, range) : []),
    [activeLabelId, queried, range],
  );

  // Тумблер «По рынкам» (без «Все сотрудники»): группируем ТЕКУЩИЙ охват (Мои/Команда/Все) по
  // рынку. С «Все сотрудники» одновременно — см. nestedGroups ниже (вложенная группировка).
  const marketGroups: MarketGroup[] = useMemo(
    () => (byMarket && !allStaff ? groupByMarket(queried, activeList, effLens, me, now, range) : []),
    [byMarket, allStaff, activeList, queried, effLens, me, now, range],
  );

  // Тумблер «Все сотрудники» (админ) без «По рынкам»: группируем по исполнителю.
  const staffGroups: StaffGroup[] = useMemo(
    () => (allStaff && !byMarket ? groupByAssignee(queried, activeList, effLens, me, now, range) : []),
    [allStaff, byMarket, activeList, queried, effLens, me, now, range],
  );

  // Оба тумблера разом: вложенная группировка — сотрудник → рынок (владелец: «группировка по
  // сотруднику, а под ней — по рынкам», задача попадает в оба измерения без конфликта).
  const nestedGroups: NestedStaffGroup[] = useMemo(
    () => (allStaff && byMarket ? groupByAssigneeThenMarket(queried, activeList, effLens, me, now, range) : []),
    [allStaff, byMarket, activeList, queried, effLens, me, now, range],
  );

  const toggle = useCallback(async (t: Task) => {
    const next = isDone(t) ? "open" : "done";
    markMutation();
    setTasks((prev) => prev?.map((x) => (x.id === t.id ? { ...x, status: next } : x)) ?? null);
    try {
      await updateTask(t.id, { status: next });
    } catch {
      load();
    }
  }, [load, markMutation]);

  const remove = useCallback(async (t: Task) => {
    markMutation();
    setTasks((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
    try {
      await deleteTask(t.id);
    } catch {
      load();
      throw new Error("delete failed");
    }
  }, [load, markMutation]);

  // Оптимистичный локальный патч задачи (быстрые действия в строке): применяем мгновенно,
  // персист делает вызывающий; фон на паузе (markMutation) не откатит до подтверждения сервером.
  const patchTask = useCallback((id: string, patch: Partial<Task>) => {
    markMutation();
    setTasks((prev) => prev?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? null);
  }, [markMutation]);

  // Быстрое добавление в духе Reminders: контекстно по активному списку/метке.
  // При активной метке задача создаётся личной и сразу получает метку.
  const quickAdd = useCallback(async (title: string, labelId?: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    markMutation();
    const input: CreateTaskInput = { title: trimmed };
    if (me) input.assignee_telegram_id = me.telegram_id;
    if (activeList === "today" && !labelId) input.due_date = todayISO(new Date());
    if (labelId) input.is_private = true;
    try {
      const created = await createTask(input);
      let finalTask = created;
      if (labelId) {
        try { finalTask = await updateTask(created.id, { label_ids: [labelId] }); }
        catch { /* задача создана; метка не проставилась — не критично */ }
      }
      // Показываем созданную задачу сразу и держим поверх поллинга до подтверждения сервером.
      pendingRef.current.set(finalTask.id, finalTask);
      setTasks((prev) => [finalTask, ...(prev ?? []).filter((x) => x.id !== finalTask.id)]);
    } finally {
      loadTasks();
    }
  }, [me, activeList, loadTasks, markMutation]);

  return {
    tasks, me, loading: tasks === null,
    activeList, setActiveList, lens, setLens, effLens, query, setQuery,
    byMarket, setByMarket, allStaff, setAllStaff, range, setRange,
    counts, visible, marketGroups, staffGroups, nestedGroups, now,
    labels, activeLabelId, setActiveLabelId, labelCounts, visibleByLabel, reloadLabels,
    toggle, remove, quickAdd, patchTask, reload,
  };
}
