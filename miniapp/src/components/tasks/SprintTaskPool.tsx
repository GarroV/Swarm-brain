"use client";
import { useMemo, useState } from "react";
import type { Project, Task } from "@/types";
import { RoyIcon } from "@/components/roy/icons";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDt } from "@/components/roy/nav";
import {
  POOL_ALL, POOL_NO_PROJECT, filterPoolTasks, projectLabel, projectOptions,
} from "@/lib/sprintPool";

// Пул «Задачи» экрана спринтов. Роль колонки «Бэклог», которой в спринтовом канбане нет
// (решение владельца 2026-09-08: «backlog заменим на слово задачи»): слева лежат задачи
// воркспейса, ещё не взятые в спринт, справа — то, что в спринте.
//
// Своим файлом, а не внутри SprintsScreen: у пула свои фильтры и свой выбор, и вместе они
// вышли бы за предел размера файла (issue #265). Правило отбора — чистыми функциями в
// `lib/sprintPool.ts` под тестами; здесь только разметка и состояние.
//
// Списки — общий `ui/select` (base-ui), как в TaskModal и настройках, а НЕ нативный `<select>`:
// нативный на macOS раскрывается системным меню поверх интерфейса и выглядит чужеродно
// (замечание владельца 09.09.2026 по первому прогону на проде).

const fieldCls =
  "w-full min-h-9 rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute dark:backdrop-blur-sm";
const triggerCls =
  "w-full min-h-9 h-9 rounded-[10px] border-line bg-surface px-2.5 text-sm text-ink data-[size=default]:h-9 dark:backdrop-blur-sm dark:bg-surface";

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
  const [projectId, setProjectId] = useState<string>(POOL_ALL);
  const [assignee, setAssignee] = useState<string>(POOL_ALL);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const assignees = useMemo(() => {
    const names = new Set<string>();
    for (const t of tasks) for (const a of t.assignees) names.add(a);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const options = useMemo(() => projectOptions(projects), [projects]);
  const hasUnassignedProject = useMemo(() => tasks.some((t) => !t.project_id), [tasks]);
  const projectName = (id: string | null) => {
    const p = id ? projects.find((x) => x.id === id) : null;
    return p ? projectLabel(p, projects) : null;
  };

  // Подпись в свёрнутом виде: без неё base-ui показывает СЫРОЕ значение («__all__»),
  // пока меню ни разу не открывали и пункты ещё не смонтированы.
  const projectValueLabel = (v: unknown) => {
    const id = String(v ?? POOL_ALL);
    if (id === POOL_NO_PROJECT) return dt("Без проекта", "No project");
    return options.find((o) => o.id === id)?.label ?? dt("Все проекты", "All projects");
  };
  const assigneeValueLabel = (v: unknown) => {
    const name = String(v ?? POOL_ALL);
    return name === POOL_ALL ? dt("Все исполнители", "All assignees") : name;
  };

  const visible = useMemo(
    () => filterPoolTasks(tasks, projects, { query, projectId, assignee }),
    [tasks, projects, query, projectId, assignee],
  );

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

        {/* Проект: выбор ГРУППЫ приносит и её подпроекты — иначе у группы видно только «Общее». */}
        <Select value={projectId} onValueChange={(v) => setProjectId(String(v))}>
          <SelectTrigger className={triggerCls} aria-label={dt("Проект", "Project")}>
            <SelectValue>{projectValueLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={POOL_ALL}>{dt("Все проекты", "All projects")}</SelectItem>
            {hasUnassignedProject && (
              <SelectItem value={POOL_NO_PROJECT}>{dt("Без проекта", "No project")}</SelectItem>
            )}
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id} className={o.child ? "pl-7" : undefined}>
                {o.child ? `› ${o.label}` : o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={assignee} onValueChange={(v) => setAssignee(String(v))}>
          <SelectTrigger className={triggerCls} aria-label={dt("Исполнитель", "Assignee")}>
            <SelectValue>{assigneeValueLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={POOL_ALL}>{dt("Все исполнители", "All assignees")}</SelectItem>
            {assignees.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
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
