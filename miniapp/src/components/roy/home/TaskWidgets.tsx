"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Project } from "@/types";
import { fetchProjects, fetchTaskLabels, type TaskLabel } from "@/lib/api";
import { groupHome, hiddenCount, HOME_TEAM_LIMIT, homeTeam } from "@/lib/homeTasks";
import type { DashboardData } from "../dash/useDashboardData";
import { HomeLabel } from "../dash/shared";
import { HomeTaskTable } from "../dash/HomeTaskTable";
import { useDt, useRoyNav } from "../nav";

// Таблицы «Мои задачи» и «Задачи команды» прежней главной (decisions/2026-09-24-home-by-stand.md) —
// теперь виджеты каталога: кому они нужны, добавляет их на свою главную.

function useTaskNames() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  // Названия проектов и списков для колонок таблицы. Не пришли — в ячейке прочерк, строки те же.
  useEffect(() => {
    fetchProjects().then(setProjects).catch((e) => console.warn("[home] projects", e));
    fetchTaskLabels().then(setLabels).catch((e) => console.warn("[home] labels", e));
  }, []);
  const projectName = (t: { project_id: string | null }) => projects.find((p) => p.id === t.project_id)?.name ?? null;
  const labelNames = (t: { label_ids?: string[] | null }) =>
    (t.label_ids ?? []).map((id) => labels.find((l) => l.id === id)?.name).filter(Boolean).join(", ");
  return { projectName, labelNames };
}

export function HomeTasksWidget({ data }: { data: DashboardData }) {
  const dt = useDt();
  const { openTasks } = useRoyNav();
  const lang = dt("ru", "en") === "en" ? 1 : 0;
  const { projectName, labelNames } = useTaskNames();
  const now = useMemo(() => new Date(), [data.tasks]);
  const sections = useMemo(() => groupHome(data.mine, now, lang), [data.mine, now, lang]);
  const more = hiddenCount(data.mine, sections, now);
  const { loading, failed, retry } = data.tasksState;
  return (
    <>
      <TasksSlot loading={loading} failed={failed} retry={retry}
        empty={sections.length === 0}
        emptyTitle={dt("Задач на вас нет", "No tasks on you")}
        emptyHint={dt("Свободно — можно взять из общего списка", "You're free — pick one from the shared list")}>
        <HomeTaskTable sections={sections} projectName={projectName} labelNames={labelNames} now={now} />
      </TasksSlot>
      {more > 0 && (
        <button type="button" onClick={() => openTasks("mine", "all")}
          className="mt-2 inline-flex min-h-6 items-center font-medium text-primary hover:underline" style={{ fontSize: 12 }}>
          {dt(`Ещё ${more} в «Задачах»`, `${more} more in Tasks`)}
        </button>
      )}
    </>
  );
}

export function TeamTasksWidget({ data }: { data: DashboardData }) {
  const dt = useDt();
  const { openTasks } = useRoyNav();
  const { projectName, labelNames } = useTaskNames();
  const now = useMemo(() => new Date(), [data.tasks]);
  const team = useMemo(() => homeTeam(data.team, now), [data.team, now]);
  const { loading, failed, retry } = data.tasksState;
  return (
    <>
      <TasksSlot loading={loading} failed={failed} retry={retry}
        empty={team.length === 0}
        emptyTitle={dt("Ничьих задач нет", "No unassigned tasks")}
        emptyHint={dt("У каждой общей задачи есть исполнитель", "Every shared task has an owner")}>
        <HomeTaskTable
          sections={[{ key: "team", label: "", tasks: team.slice(0, HOME_TEAM_LIMIT) }]}
          projectName={projectName} labelNames={labelNames} showLabels={false} now={now} />
      </TasksSlot>
      {team.length > 0 && (
        <button type="button" onClick={() => openTasks("team", "all")}
          className="mt-2 inline-flex min-h-6 items-center font-medium text-primary hover:underline" style={{ fontSize: 12 }}>
          {dt("все задачи команды", "all team tasks")}
        </button>
      )}
    </>
  );
}

function TasksSlot({ loading, failed, retry, empty, emptyTitle, emptyHint, children }: {
  loading: boolean; failed: boolean; retry: () => void; empty: boolean;
  emptyTitle: string; emptyHint: string; children: ReactNode;
}) {
  const dt = useDt();
  if (loading) return <div className="space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 34, borderRadius: 8 }} />)}</div>;
  if (failed) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 text-ink-soft" style={{ fontSize: 13 }}>
        {dt("Не загрузилось", "Failed to load")}
        <button type="button" onClick={retry} className="font-medium text-primary hover:underline">{dt("Повторить", "Retry")}</button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-[10px] border border-line bg-surface px-4 py-5 text-center">
        <div className="font-medium text-ink" style={{ fontSize: 13.5 }}>{emptyTitle}</div>
        <div className="mt-0.5 text-ink-mute" style={{ fontSize: 12.5 }}>{emptyHint}</div>
      </div>
    );
  }
  return <>{children}</>;
}

