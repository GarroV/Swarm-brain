"use client";
import { useEffect, useMemo, useState } from "react";
import { useRoyNav, useDt } from "../nav";
import { NavHeader } from "../ui";
import { TaskModal } from "@/components/TaskModal";
import { fetchTask } from "@/lib/api";
import { matchesLens, matchesList, DEFAULT_STATUSES } from "@/lib/smartLists";
import { tomorrowLocalISO } from "@/lib/dateRange";
import { readSavedTasksView } from "@/components/tasks/useReminderTasks";
import type { Task } from "@/types";

// Маршруты `taskDetail` (адрес/пуш о комментарии) и `newTask` (кнопка «+», старые ссылки) — это
// ТОЛЬКО точки входа в единый редактор TaskModal, а не отдельные экраны со своей вёрсткой и
// логикой полей (#600: человек с телефона видел три разных карточки одной задачи, а правка
// мобильной формы шла мимо истории и полей карточки). Маршрут остаётся ради адресов и
// sessionStorage (royUrl), содержимое — одно окно TaskModal поверх пустой шапки.
const TASK_ROUTE_COPY = {
  task: { ru: "Задача", en: "Task" },
  newTask: { ru: "Новая задача", en: "New task" },
  loadError: { ru: "Не удалось загрузить задачу.", en: "Could not load task." },
  created: { ru: "Задача создана", en: "Task created" },
} as const;

export function TaskRoute({ id }: { id?: string }) {
  const { me, pop, setTab, openTasks, bumpTasks, toast } = useRoyNav();
  const dt = useDt();
  const [task, setTask] = useState<Task | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setTask(null);
    setFailed(false);
    fetchTask(id)
      .then((t) => { if (alive) setTask(t); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [id]);

  // Срок обязателен и по умолчанию завтрашний (решение владельца 21.09.2026, #440): задача без
  // срока не попадала ни в «Сегодня», ни в «Ближайшие». Держим на мобильном «+» как было.
  const prefill = useMemo(() => ({ due_date: tomorrowLocalISO() }), []);

  // Созданная задача, не попадающая в активный вид списка, выглядела потерянной (создал →
  // вернулся в «Сегодня» → пусто). Проверяем тем же правилом, которым живёт список, и при промахе
  // открываем вид, где задача видна. Период и статусы учитываем так же, как список.
  const onCreated = (created?: Task) => {
    if (!created) return;
    toast(dt(TASK_ROUTE_COPY.created.ru, TASK_ROUTE_COPY.created.en));
    bumpTasks();
    const view = readSavedTasksView();
    const lens = view?.lens ?? "mine";
    const list = view?.activeList ?? "today";
    const statuses = view?.statuses ? new Set(view.statuses) : DEFAULT_STATUSES;
    const lensOk = matchesLens(created, lens, me);
    if (lensOk && matchesList(created, list, new Date(), view?.range ?? null, statuses)) setTab("task");
    else openTasks(lensOk ? lens : "all", "all");
  };

  const editing = !!id;
  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={editing ? dt(TASK_ROUTE_COPY.task.ru, TASK_ROUTE_COPY.task.en) : dt(TASK_ROUTE_COPY.newTask.ru, TASK_ROUTE_COPY.newTask.en)} />
      {failed && <div className="px-5 py-8 text-center text-sm text-ink-soft">{dt(TASK_ROUTE_COPY.loadError.ru, TASK_ROUTE_COPY.loadError.en)}</div>}
      <TaskModal
        task={task ?? undefined}
        open={editing ? task !== null : true}
        onClose={pop}
        onSaved={editing ? bumpTasks : onCreated}
        prefill={editing ? undefined : prefill}
      />
    </div>
  );
}
