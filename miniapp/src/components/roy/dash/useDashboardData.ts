"use client";
import { useEffect, useMemo, useState } from "react";
import { useRoyNav } from "../nav";
import { fetchTasks, fetchMeetings, fetchEntries, fetchAgentMeetings } from "@/lib/api";
import { splitByLens, groupMine, recentEntries } from "./myTasks";
import type { Task, Entry } from "@/types";

// Единый источник данных desktop-главного экрана «Рой». Грузит tasks / meetings /
// entries / agentMeetings параллельно (graceful: ошибка любого fetch → []),
// берёт `me` из nav-контекста и прогоняет всё через чистые хелперы (myTasks.ts).
// Все панели читают один этот хук — без дублирования запросов.

export type DashboardData = {
  loading: boolean;
  /** «мои» задачи (assignee = me) */
  mine: Task[];
  /** ОБЩИЕ задачи команды: не приватные и без конкретного исполнителя (линза «team») */
  team: Task[];
  /** мои задачи с дедлайном сегодня/просрочено */
  today: Task[];
  /** мои задачи с дедлайном в пределах недели */
  week: Task[];
  /** мои задачи без срока (или дальше недели) */
  noDate: Task[];
  /** всё за последние 24ч (заметки + встречи/расшифровки), от новых к старым */
  materials: Entry[];
  /** встречи на согласовании (админ — весь воркспейс, иначе свои) */
  pendingList: Entry[];
  /** недавние опубликованные (подтверждённые) встречи */
  recentMeetings: Entry[];
  /** число встреч на согласовании (= pendingList.length; для бейджа) */
  pendingMeetings: number;
  /** число черновиков desktop-agent на вычитке */
  reviewCount: number;
};

// Локальная дата пользователя в формате YYYY-MM-DD. groupMine сравнивает дедлайны
// как UTC-полночь, поэтому передаём именно локальную календарную дату (en-CA даёт
// "YYYY-MM-DD" в локали пользователя), а не toISOString (тот сдвигает по UTC).
function localTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

export function useDashboardData(): DashboardData {
  const { me, tasksVersion } = useRoyNav();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [meetings, setMeetings] = useState<Entry[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [pending, setPending] = useState<Entry[] | null>(null);

  // tasksVersion в deps: после сохранения/удаления задачи в окне-редакторе списки задач на
  // главной («Мои»/«Команда») перезапрашиваются (общий рефреш без per-caller колбэков).
  useEffect(() => {
    fetchTasks().then(setTasks).catch(() => setTasks([]));
  }, [tasksVersion]);

  useEffect(() => {
    fetchMeetings().then(setMeetings).catch(() => setMeetings([]));
    fetchEntries().then(setEntries).catch(() => setEntries([]));
    fetchAgentMeetings("awaiting_review")
      .then((list) => setReviewCount(list.length))
      .catch(() => setReviewCount(0));
  }, []);

  // Очередь «на согласовании» — ТОЛЬКО свои (даже у админа): чужое непубликованное приватно,
  // в него не лезем. Сводка по участникам — отдельный агрегированный счётчик в админ-панели.
  useEffect(() => {
    fetchMeetings({ confirmed: false })
      .then(setPending)
      .catch(() => setPending([]));
  }, []);

  const meId = me?.telegram_id ?? null;

  return useMemo<DashboardData>(() => {
    const loading = tasks == null || meetings == null || entries == null || reviewCount == null || pending == null;

    // Линза «team» от личности не зависит (общая задача общая для всех), поэтому me = null
    // просто оставляет личные секции пустыми — без прежнего фолбэка «всё в команду», который
    // при неопознанном пользователе показывал ему ЛИЧНЫЕ задачи коллег.
    const { mine, team } = splitByLens(tasks ?? [], meId == null ? null : { telegram_id: meId });

    const { today, week, noDate } = groupMine(mine, localTodayISO());

    // «Добавлено за сутки» — лента ВСЕГО, что попало в базу за 24ч: заметки/доки/ссылки
    // (fetchEntries, entry_type=note) + встречи/расшифровки (fetchMeetings, entry_type=meeting).
    // fetchEntries на бэкенде отдаёт только note → встречи добавляем явно, иначе свежие
    // Granola-встречи не видны в ленте, хотя пользователь их там ждёт.
    const materials = recentEntries([...(entries ?? []), ...(meetings ?? [])], Date.now());

    const pendingList = pending ?? [];
    // «Недавние» — только опубликованные (подтверждённые) из видимых; pending показываем
    // отдельной секцией, поэтому здесь их исключаем (иначе свои pending задвоились бы).
    const recentMeetings = (meetings ?? []).filter((m) => m.metadata?.confirmed === true);
    const pendingMeetings = pendingList.length;

    return {
      loading,
      mine,
      team,
      today,
      week,
      noDate,
      materials,
      pendingList,
      recentMeetings,
      pendingMeetings,
      reviewCount: reviewCount ?? 0,
    };
  }, [tasks, meetings, entries, reviewCount, pending, meId]);
}
