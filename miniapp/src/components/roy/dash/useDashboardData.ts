"use client";
import { useEffect, useMemo, useState } from "react";
import { useRoyNav } from "../nav";
import { fetchTasks, fetchMeetings, fetchEntries, fetchAgentMeetings } from "@/lib/api";
import { splitByOwner, groupMine, recentEntries, sortMeetingsApprovalFirst } from "./myTasks";
import type { Task, Entry } from "@/types";

// Единый источник данных desktop-главного экрана «Рой». Грузит tasks / meetings /
// entries / agentMeetings параллельно (graceful: ошибка любого fetch → []),
// берёт `me` из nav-контекста и прогоняет всё через чистые хелперы (myTasks.ts).
// Все панели читают один этот хук — без дублирования запросов.

export type DashboardData = {
  loading: boolean;
  /** «мои» задачи (assignee = me) */
  mine: Task[];
  /** задачи команды (assignee ≠ me, либо все — если me нет) */
  team: Task[];
  /** мои задачи с дедлайном сегодня/просрочено */
  today: Task[];
  /** мои задачи с дедлайном в пределах недели */
  week: Task[];
  /** мои задачи без срока (или дальше недели) */
  noDate: Task[];
  /** всё за последние 24ч (заметки + встречи/расшифровки), от новых к старым */
  materials: Entry[];
  /** встречи: неподтверждённые первыми */
  meetingsApprovalFirst: Entry[];
  /** число неподтверждённых встреч (для бейджа «на согласовании») */
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
  const { me } = useRoyNav();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [meetings, setMeetings] = useState<Entry[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  useEffect(() => {
    fetchTasks().then(setTasks).catch(() => setTasks([]));
    fetchMeetings().then(setMeetings).catch(() => setMeetings([]));
    fetchEntries().then(setEntries).catch(() => setEntries([]));
    fetchAgentMeetings("awaiting_review")
      .then((list) => setReviewCount(list.length))
      .catch(() => setReviewCount(0));
  }, []);

  const meId = me?.telegram_id ?? null;

  return useMemo<DashboardData>(() => {
    const loading = tasks == null || meetings == null || entries == null || reviewCount == null;

    // meId нет → все задачи в «команду», личные секции пусты (graceful).
    const { mine, team } = meId == null
      ? { mine: [] as Task[], team: tasks ?? [] }
      : splitByOwner(tasks ?? [], meId);

    const { today, week, noDate } = groupMine(mine, localTodayISO());

    // «Добавлено за сутки» — лента ВСЕГО, что попало в базу за 24ч: заметки/доки/ссылки
    // (fetchEntries, entry_type=note) + встречи/расшифровки (fetchMeetings, entry_type=meeting).
    // fetchEntries на бэкенде отдаёт только note → встречи добавляем явно, иначе свежие
    // Granola-встречи не видны в ленте, хотя пользователь их там ждёт.
    const materials = recentEntries([...(entries ?? []), ...(meetings ?? [])], Date.now());

    const meetingsApprovalFirst = sortMeetingsApprovalFirst(meetings ?? []);
    const pendingMeetings = (meetings ?? []).filter((m) => m.metadata?.confirmed !== true).length;

    return {
      loading,
      mine,
      team,
      today,
      week,
      noDate,
      materials,
      meetingsApprovalFirst,
      pendingMeetings,
      reviewCount: reviewCount ?? 0,
    };
  }, [tasks, meetings, entries, reviewCount, meId]);
}
