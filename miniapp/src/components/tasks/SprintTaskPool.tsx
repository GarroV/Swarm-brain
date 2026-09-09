"use client";
import { useMemo, useState } from "react";
import type { Project, Task } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { Button } from "@/components/ui/button";
import { useDt } from "@/components/roy/nav";

// Пул «Задачи» экрана спринтов. Роль колонки «Бэклог», которой в спринтовом канбане нет
// (решение владельца 2026-09-08: «backlog заменим на слово задачи»): слева лежат задачи
// воркспейса, ещё не взятые в спринт, справа — то, что в спринте.
//
// Своим файлом, а не внутри SprintsScreen: у пула свои фильтры и свой выбор, и вместе они
// вышли бы за предел размера файла (issue #265).

const ALL = "__all__";
const fieldCls =
  "w-full min-h-9 rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute dark:backdrop-blur-sm";

/** Подпись проекта в фильтре: у подпроекта — «Группа › Имя», иначе неотличимы тёзки. */
function projectLabel(p: Project, all: Project[]): string {
  if (!p.parent_id) return p.name;
  const parent = all.find((x) => x.id === p.parent_id);
  return parent ? `${parent.name} › ${p.name}` : p.name;
}

export function SprintTaskPool({ tasks, projects, disabled, adding, onAdd }: {
  /** Задачи, доступные к добавлению: экран уже убрал взятые в спринт и закрытые. */
  tasks: Task[];
  projects: Project[];
  disabled?: boolean;
  adding?: boolean;
  onAdd: (taskIds: string[]) => void;
}) {
  const dt = useDt();
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState<string>(ALL);
  const [assignee, setAssignee] = useState<string>(ALL);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const assignees = useMemo(() => {
    const names = new Set<string>();
    for (const t of tasks) for (const a of t.assignees) names.add(a);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, label: projectLabel(p, projects) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [projects],
  );
  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? null : null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (projectId !== ALL && t.project_id !== projectId) return false;
      if (assignee !== ALL && !t.assignees.includes(assignee)) return false;
      return true;
    });
  }, [tasks, query, projectId, assignee]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function submit(ids: string[]) {
    if (ids.length === 0) return;
    onAdd(ids);
    setPicked(new Set());
  }

  return (
    <div className="flex flex-col min-h-0 w-72 shrink-0 rounded-2xl border border-line bg-surface/40 dark:backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
        <RoyIcon name="task" size={14} strokeWidth={1.9} />
        <span className="text-sm font-bold text-ink">{dt("Задачи", "Tasks")}</span>
        <span className="ml-auto text-xs text-ink-soft">{visible.length}</span>
      </div>

      <div className="space-y-1.5 p-2 border-b border-line">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={dt("Поиск по названию", "Search by title")} className={fieldCls} />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={fieldCls}>
          <option value={ALL}>{dt("Все проекты", "All projects")}</option>
          {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={fieldCls}>
          <option value={ALL}>{dt("Все исполнители", "All assignees")}</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {visible.length === 0 && (
          <p className="py-6 text-center text-xs text-ink-soft/70">
            {tasks.length === 0
              ? dt("Свободных задач нет — всё уже в спринте", "No free tasks — everything is in the sprint")
              : dt("Под фильтры ничего не попало", "Nothing matches the filters")}
          </p>
        )}
        {visible.map((t) => {
          const on = picked.has(t.id);
          const project = projectName(t.project_id);
          return (
            <div key={t.id}
              className={`group flex items-start gap-2 rounded-lg border p-2 transition-colors ${on ? "border-primary bg-primary/10" : "border-line bg-card hover:border-line-2"}`}>
              <input type="checkbox" checked={on} disabled={disabled}
                onChange={() => toggle(t.id)}
                className="mt-0.5 size-3.5 shrink-0 accent-[var(--primary)]"
                title={dt("Выбрать", "Select")} />
              <button type="button" disabled={disabled} onClick={() => toggle(t.id)} className="flex-1 text-left">
                <p className="text-sm leading-snug text-ink">{t.title}</p>
                <p className="mt-0.5 text-[11px] text-ink-soft">
                  {project ?? dt("без проекта", "no project")}
                  {t.assignees.length > 0 && ` · ${t.assignees.join(", ")}`}
                </p>
              </button>
              {/* Добавить одну, не собирая выбор: частый случай — «эту тоже возьмём». */}
              <button type="button" disabled={disabled} onClick={() => submit([t.id])}
                title={dt("Добавить в спринт", "Add to sprint")}
                className="rounded-full p-1 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-2 hover:text-ink disabled:opacity-0">
                <RoyIcon name="plus" size={13} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      {picked.size > 0 && (
        <div className="flex items-center gap-2 border-t border-line p-2">
          <Button size="sm" className="h-9 flex-1 text-xs" disabled={disabled || adding}
            onClick={() => submit([...picked])}>
            {adding
              ? dt("Добавляем…", "Adding…")
              : `${dt("Добавить", "Add")} ${picked.size}`}
          </Button>
          <button onClick={() => setPicked(new Set())} className="px-2 text-xs text-ink-soft">
            {dt("Снять выбор", "Clear")}
          </button>
        </div>
      )}
    </div>
  );
}
