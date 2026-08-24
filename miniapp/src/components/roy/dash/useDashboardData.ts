"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoyNav } from "../nav";
import { fetchTasks, fetchMeetings, fetchEntries, fetchAgentMeetings } from "@/lib/api";
import { splitByLens, groupMine, recentEntries } from "./myTasks";
import type { Task, Entry, AgentMeeting } from "@/types";

// Единый источник данных desktop-главного экрана «Рой». Грузит tasks / meetings /
// entries / agentMeetings параллельно и прогоняет всё через чистые хелперы (myTasks.ts).
// Все панели читают один этот хук — без дублирования запросов.
//
// ⚠️ Флаг загрузки — ПОФАЗОВЫЙ, один на источник (issue #81). Раньше был один общий
// (`tasks == null || meetings == null || …`), и панель ждала не свои данные, а самый
// медленный из пяти запросов: «Мои задачи» сидели в скелетоне, пока не вернётся
// agent-meetings. Хуже того, таймаута не было — один зависший запрос держал ВЕСЬ экран
// в скелетоне навсегда, без данных и без ошибки.

/** Сколько ждать ответ, прежде чем показать «не загрузилось · повторить» вместо скелетона.
 *  Живой запрос этим не отменяется: если ответ придёт позже, панель его покажет. */
const SLICE_TIMEOUT_MS = 12_000;

type Slice<T> = {
  /** null — ещё грузим (или повторяем); массив — данные пришли */
  list: T[] | null;
  /** true — ответа не дождались (таймаут) или запрос упал */
  failed: boolean;
  /** повторить загрузку этого куска */
  reload: () => void;
};

// Один независимый кусок данных дашборда. Держит своё состояние, свой таймаут и свою
// кнопку «повторить» — сосед по экрану на него не влияет.
function useSlice<T>(load: () => Promise<T[]>, deps: unknown[]): Slice<T> {
  const [list, setList] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setList(null);
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    // Таймаут не отменяет запрос: медленный ответ всё равно приедет и вытеснит ошибку —
    // отменённый fetch пришлось бы гнать заново, а данные уже в пути.
    const timer = setTimeout(() => { if (alive) setFailed(true); }, SLICE_TIMEOUT_MS);
    load()
      .then((data) => { if (alive) { setList(data); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { list, failed, reload };
}

export type PanelState = {
  /** показывать скелетон: данных нет и ошибки нет */
  loading: boolean;
  /** показывать «не загрузилось · повторить» вместо пустоты */
  failed: boolean;
  /** повторная загрузка источников этой панели */
  retry: () => void;
};

export type DashboardData = {
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
  /** встречи на согласовании (только свои, даже у админа) */
  pendingList: Entry[];
  /** недавние опубликованные (подтверждённые) встречи */
  recentMeetings: Entry[];
  /** число встреч на согласовании (= pendingList.length; для бейджа) */
  pendingMeetings: number;
  /** число черновиков desktop-agent на вычитке */
  reviewCount: number;
  /** состояние загрузки ПО ПАНЕЛЯМ — каждая ждёт только свои источники */
  tasksState: PanelState;
  materialsState: PanelState;
  meetingsState: PanelState;
};

// Локальная дата пользователя в формате YYYY-MM-DD. groupMine сравнивает дедлайны
// как UTC-полночь, поэтому передаём именно локальную календарную дату (en-CA даёт
// "YYYY-MM-DD" в локали пользователя), а не toISOString (тот сдвигает по UTC).
function localTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

// Панель готова, когда пришли ВСЕ её источники; сломана, если сломался любой из них.
function panelState(slices: Array<{ list: unknown[] | null; failed: boolean }>, retry: () => void): PanelState {
  const failed = slices.some((s) => s.failed && s.list == null);
  return { loading: !failed && slices.some((s) => s.list == null), failed, retry };
}

export function useDashboardData(): DashboardData {
  const { me, tasksVersion } = useRoyNav();

  // tasksVersion в deps: после сохранения/удаления задачи в окне-редакторе списки задач на
  // главной («Мои»/«Команда») перезапрашиваются (общий рефреш без per-caller колбэков).
  const tasks = useSlice<Task>(fetchTasks, [tasksVersion]);
  const meetings = useSlice<Entry>(() => fetchMeetings(), []);
  const entries = useSlice<Entry>(fetchEntries, []);
  // Очередь «на согласовании» — ТОЛЬКО свои (даже у админа): чужое непубликованное приватно,
  // в него не лезем. Сводка по участникам — отдельный агрегированный счётчик в админ-панели.
  const pending = useSlice<Entry>(() => fetchMeetings({ confirmed: false }), []);
  const review = useSlice<AgentMeeting>(() => fetchAgentMeetings("awaiting_review"), []);

  const meId = me?.telegram_id ?? null;

  const retryMaterials = useCallback(() => { entries.reload(); meetings.reload(); }, [entries, meetings]);
  const retryMeetings = useCallback(() => { pending.reload(); meetings.reload(); review.reload(); }, [pending, meetings, review]);

  return useMemo<DashboardData>(() => {
    // Линза «team» от личности не зависит (общая задача общая для всех), поэтому me = null
    // просто оставляет личные секции пустыми — без прежнего фолбэка «всё в команду», который
    // при неопознанном пользователе показывал ему ЛИЧНЫЕ задачи коллег.
    const { mine, team } = splitByLens(tasks.list ?? [], meId == null ? null : { telegram_id: meId });

    const { today, week, noDate } = groupMine(mine, localTodayISO());

    // «Добавлено за сутки» — лента ВСЕГО, что попало в базу за 24ч: заметки/доки/ссылки
    // (fetchEntries, entry_type=note) + встречи/расшифровки (fetchMeetings, entry_type=meeting).
    // fetchEntries на бэкенде отдаёт только note → встречи добавляем явно, иначе свежие
    // Granola-встречи не видны в ленте, хотя пользователь их там ждёт.
    const materials = recentEntries([...(entries.list ?? []), ...(meetings.list ?? [])], Date.now());

    const pendingList = pending.list ?? [];
    // «Недавние» — только опубликованные (подтверждённые) из видимых; pending показываем
    // отдельной секцией, поэтому здесь их исключаем (иначе свои pending задвоились бы).
    const recentMeetings = (meetings.list ?? []).filter((m) => m.metadata?.confirmed === true);

    return {
      mine,
      team,
      today,
      week,
      noDate,
      materials,
      pendingList,
      recentMeetings,
      pendingMeetings: pendingList.length,
      reviewCount: review.list?.length ?? 0,
      tasksState: panelState([tasks], tasks.reload),
      materialsState: panelState([entries, meetings], retryMaterials),
      meetingsState: panelState([pending, meetings, review], retryMeetings),
    };
  }, [tasks, meetings, entries, pending, review, meId, retryMaterials, retryMeetings]);
}
