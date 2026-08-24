"use client";
import { useEffect, useMemo, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { RoyHeader, RoyCard, SearchBtn } from "../ui";
import { RoyIcon } from "../icons";
import { fetchProjects, fetchTasks, createProject } from "@/lib/api";
import type { Project, Task } from "@/types";

// Экран «Проекты» на мобайле. До 2026-08-22 проектов на телефоне не было вообще: доска жила
// только в десктопной TasksScreen за порогом 1024px, хотя владелец назвал проекты вторым
// приоритетом после задач. Вид — список проектов → задачи внутри (решение владельца, не канбан:
// горизонтальный свайп колонок конфликтует со свайпом строки).

const isDone = (t: Task) => t.status === "done";

function progress(tasks: Task[]): { done: number; total: number } {
  return { done: tasks.filter(isDone).length, total: tasks.length };
}

export function RoyProjectsScreen() {
  const { push } = useRoyNav();
  const dt = useDt();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
    fetchTasks().then(setTasks).catch(() => setTasks([]));
  };
  useEffect(load, []);

  // Задачи проекта = свои + задач подпроектов (на карточке верхнего уровня показываем сумму,
  // иначе у проекта-контейнера всегда 0/0 и он выглядит мёртвым).
  const byProject = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.project_id) continue;
      const list = m.get(t.project_id) ?? [];
      list.push(t);
      m.set(t.project_id, list);
    }
    return m;
  }, [tasks]);

  const tops = (projects ?? []).filter((p) => !p.parent_id);
  const subsOf = (id: string) => (projects ?? []).filter((p) => p.parent_id === id);
  const tasksOf = (p: Project): Task[] => [
    ...(byProject.get(p.id) ?? []),
    ...subsOf(p.id).flatMap((s) => byProject.get(s.id) ?? []),
  ];

  const submit = async () => {
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await createProject({ name: v });
      setName("");
      setAdding(false);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative h-full overflow-y-auto">
      <RoyHeader title={dt("Проекты", "Projects")} right={<SearchBtn onClick={() => push({ view: "ask" })} />} />

      <div className="space-y-2.5 px-5 pb-28">
        {projects === null && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 76, borderRadius: 18 }} />)}

        {projects !== null && tops.length === 0 && !adding && (
          <div className="py-10 text-center text-sm text-ink-soft">{dt("Проектов пока нет", "No projects yet")}</div>
        )}

        {tops.map((p) => {
          const { done, total } = progress(tasksOf(p));
          const subs = subsOf(p.id);
          return (
            <RoyCard key={p.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => push({ view: "project", params: { id: p.id } })}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-2"
              >
                <span
                  className="inline-flex shrink-0 items-center justify-center rounded-[12px]"
                  style={{ width: 38, height: 38, background: p.color ? `${p.color}22` : "var(--accent-soft)", color: p.color ?? "var(--accent-ink)" }}
                >
                  {p.emoji ? <span style={{ fontSize: 18 }}>{p.emoji}</span> : <RoyIcon name="board" size={19} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-ink" style={{ fontSize: 15 }}>{p.name}</span>
                    {p.is_private && <RoyIcon name="lock" size={13} className="shrink-0 text-ink-mute" />}
                  </span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-primary" style={{ width: total ? `${Math.round((done / total) * 100)}%` : 0 }} />
                    </span>
                    <span className="shrink-0 text-ink-mute" style={{ fontSize: 12 }}>{done}/{total}</span>
                  </span>
                </span>
                <RoyIcon name="cright" size={18} className="shrink-0 text-ink-mute" />
              </button>

              {subs.length > 0 && (
                <div className="border-t border-line">
                  {subs.map((s) => {
                    const sp = progress(byProject.get(s.id) ?? []);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => push({ view: "project", params: { id: s.id } })}
                        className="flex w-full items-center gap-2.5 py-2.5 pl-[62px] pr-4 text-left transition-colors active:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-ink-soft" style={{ fontSize: 14 }}>{s.name}</span>
                        <span className="shrink-0 text-ink-mute" style={{ fontSize: 12 }}>{sp.done}/{sp.total}</span>
                        <RoyIcon name="cright" size={16} className="shrink-0 text-ink-mute" />
                      </button>
                    );
                  })}
                </div>
              )}
            </RoyCard>
          );
        })}

        {/* Создание проекта — инлайн-строкой, без отдельного экрана: на телефоне это одно поле. */}
        {adding ? (
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className="flex items-center gap-2 rounded-[18px] border border-line-2 bg-surface px-4 py-3"
          >
            <RoyIcon name="board" size={18} className="shrink-0 text-ink-mute" />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (!name.trim()) setAdding(false); }}
              placeholder={dt("Название проекта", "Project name")}
              enterKeyHint="done"
              className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 15 }}
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 rounded-[18px] border border-dashed border-line-2 px-4 py-3 text-ink-mute transition-colors active:bg-surface-2"
            style={{ fontSize: 14, minHeight: 44 }}
          >
            <RoyIcon name="plus" size={17} />
            {dt("Новый проект", "New project")}
          </button>
        )}
      </div>
    </div>
  );
}
