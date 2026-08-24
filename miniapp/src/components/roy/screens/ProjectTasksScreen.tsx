"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { NavHeader, SectionLabel } from "../ui";
import { RoyIcon } from "../icons";
import { MobileTaskRow } from "../MobileTaskRow";
import { fetchProjects, fetchTasks, createTask, updateTask, deleteTask } from "@/lib/api";
import type { Project, Task } from "@/types";

// Задачи одного проекта: тот же чек-лист и те же жесты, что на экране «Задачи»
// (MobileTaskRow). Порядок секций — рабочий: сначала то, что в работе, готовое сворачивается
// вниз. Колонок канбана нет намеренно (решение владельца 2026-08-22).

const WORK = [
  { status: "in_progress", ru: "В работе", en: "In progress" },
  { status: "open", ru: "Открыто", en: "Open" },
] as const;

const isDone = (t: Task) => t.status === "done";
// Бэклог — всё, что не open/in_progress/done (та же трактовка, что на доске в SprintBoard).
const isBacklog = (t: Task) => !isDone(t) && t.status !== "open" && t.status !== "in_progress";

export function ProjectTasksScreen({ id }: { id: string }) {
  const { pop, push, toast, tasksVersion } = useRoyNav();
  const dt = useDt();
  const [project, setProject] = useState<Project | null>(null);
  const [subs, setSubs] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() => {
    fetchProjects()
      .then((all) => {
        setProject(all.find((p) => p.id === id) ?? null);
        setSubs(all.filter((p) => p.parent_id === id));
      })
      .catch(() => setProject(null));
    fetchTasks()
      .then((all) => setTasks(all.filter((t) => t.project_id === id)))
      .catch(() => setTasks([]));
  }, [id]);

  // tasksVersion — общий счётчик правок задач (карточка задачи бампает его при сохранении).
  useEffect(load, [load, tasksVersion]);

  const groups = useMemo(() => {
    const list = tasks ?? [];
    return {
      work: WORK.map((c) => ({ ...c, tasks: list.filter((t) => t.status === c.status) })).filter((g) => g.tasks.length),
      backlog: list.filter(isBacklog),
      done: list.filter(isDone),
    };
  }, [tasks]);

  const toggle = async (t: Task) => {
    const next = isDone(t) ? "open" : "done";
    setTasks((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    try {
      await updateTask(t.id, { status: next });
    } catch {
      toast(dt("Не удалось обновить", "Couldn't update"));
      load();
    }
  };

  const remove = async (t: Task) => {
    setTasks((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    try {
      await deleteTask(t.id);
      toast(dt("Задача удалена", "Task deleted"));
    } catch {
      toast(dt("Не удалось удалить", "Couldn't delete"));
      load();
    }
  };

  // Быстрое добавление прямо в проект: полноэкранная форма «Новая задача» проект не спрашивает,
  // поэтому задача, созданная там, оказалась бы вне проекта — а человек ждёт обратного.
  const add = async () => {
    const v = title.trim();
    if (!v) return;
    setTitle("");
    try {
      await createTask({ title: v, project_id: id, status: "open" });
      load();
    } catch {
      toast(dt("Не удалось создать", "Couldn't create"));
    }
  };

  const rows = (list: Task[]) =>
    list.map((t) => <MobileTaskRow key={t.id} task={t} showAssignee onToggle={() => toggle(t)} onRemove={() => remove(t)} />);

  const total = (tasks ?? []).length;
  const done = groups.done.length;

  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={project?.name ?? dt("Проект", "Project")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28">
        <div className="pb-2 text-ink-mute" style={{ fontSize: 12.5 }}>
          {done}/{total} {dt("задач готово", "tasks done")}
        </div>

        {/* Подпроекты — сразу под шапкой: с телефона это единственный способ в них попасть. */}
        {subs.length > 0 && (
          <div className="mb-3 space-y-1.5">
            <SectionLabel>{dt("Подпроекты", "Subprojects")}</SectionLabel>
            {subs.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => push({ view: "project", params: { id: s.id } })}
                className="flex w-full items-center gap-2 rounded-[14px] border border-line bg-surface px-3.5 text-left transition-colors active:bg-surface-2"
                style={{ minHeight: 44 }}
              >
                <RoyIcon name="board" size={16} className="shrink-0 text-ink-mute" />
                <span className="min-w-0 flex-1 truncate text-ink" style={{ fontSize: 14 }}>{s.name}</span>
                <RoyIcon name="cright" size={16} className="shrink-0 text-ink-mute" />
              </button>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mb-3 flex items-center gap-2 rounded-[14px] border border-line-2 bg-surface px-3.5" style={{ minHeight: 46 }}>
          <RoyIcon name="plus" size={17} className="shrink-0 text-ink-mute" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={dt("Новая задача в проекте", "New task in project")}
            enterKeyHint="done"
            className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
            style={{ fontSize: 15 }}
          />
        </form>

        {tasks === null && [0, 1, 2].map((i) => <div key={i} className="roy-shim mb-2.5" style={{ height: 59, borderRadius: 18 }} />)}

        {tasks !== null && total === 0 && (
          <div className="py-10 text-center text-sm text-ink-soft">{dt("В проекте пока нет задач", "No tasks in this project yet")}</div>
        )}

        {groups.work.map((g) => (
          <section key={g.status} className="mb-3 space-y-2.5">
            <SectionLabel>{dt(g.ru, g.en)} · {g.tasks.length}</SectionLabel>
            {rows(g.tasks)}
          </section>
        ))}

        {groups.backlog.length > 0 && (
          <section className="mb-3 space-y-2.5">
            <SectionLabel>{dt("Бэклог", "Backlog")} · {groups.backlog.length}</SectionLabel>
            {rows(groups.backlog)}
          </section>
        )}

        {groups.done.length > 0 && (
          <section className="space-y-2.5">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="flex w-full items-center gap-1.5 text-left text-ink-mute"
              style={{ minHeight: 44, fontSize: 11.5 }}
            >
              <RoyIcon name={showDone ? "cleft" : "cright"} size={13} />
              <span className="font-bold uppercase" style={{ letterSpacing: "0.05em" }}>
                {dt("Готовые", "Done")} · {groups.done.length}
              </span>
            </button>
            {showDone && rows(groups.done)}
          </section>
        )}
      </div>
    </div>
  );
}
