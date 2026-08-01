"use client";
import { useEffect, useState } from "react";
import type { Project } from "@/types";
import dynamic from "next/dynamic";
import { fetchProjects, createProject } from "@/lib/api";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

// react-flow — только на клиенте (SSR/static export не рендерит canvas-измерения)
const ProjectTree = dynamic(() => import("@/components/tasks/ProjectTree").then((m) => m.ProjectTree), { ssr: false });

export function ProjectsGrid() {
  const dt = useDt();
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const load = async () => setProjects(await fetchProjects());
  useEffect(() => { void load(); }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const p = await createProject({ name: trimmed });
    setName(""); setAdding(false);
    setProjects((prev) => [...prev, p]);
    setActive(p);
  };

  if (active) return (
    <div className="relative flex-1 min-h-0">
      <button
        onClick={() => { setActive(null); void load(); }}
        className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full bg-surface border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2"
      >
        <RoyIcon name="cleft" size={14} /> {dt("Проекты", "Projects")}
      </button>
      <ProjectTree />
    </div>
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setActive(p)}
            className="flex flex-col items-start rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-2 active:scale-[0.98]"
          >
            <span className="mb-1 h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? "#5b8def" }} />
            <span className="font-semibold text-ink">{p.emoji ? `${p.emoji} ` : ""}{p.name}</span>
            <span className="mt-1 text-xs text-ink-mute">
              {dt("задач", "tasks")}: {p.task_count ?? 0} · {dt("в бэклоге", "backlog")}: {p.backlog_count ?? 0}
            </span>
          </button>
        ))}
        {adding ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-2 bg-surface p-4">
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") setAdding(false); }}
              placeholder={dt("Название проекта", "Project name")}
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-[var(--accent-ink)]"
            />
            <div className="flex gap-2">
              <button onClick={() => void submit()} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white">{dt("Создать", "Create")}</button>
              <button onClick={() => setAdding(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft">{dt("Отмена", "Cancel")}</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-[92px] items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-2 text-sm text-ink-mute transition-colors hover:bg-surface active:scale-[0.98]"
          >
            <RoyIcon name="plus" size={16} /> {dt("Новый проект", "New project")}
          </button>
        )}
      </div>
    </div>
  );
}
