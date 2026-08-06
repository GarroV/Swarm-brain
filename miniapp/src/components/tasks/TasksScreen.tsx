"use client";
import { useState } from "react";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { RemindersTasks } from "@/components/tasks/RemindersTasks";
import { TimelineView } from "@/components/tasks/TimelineView";
import { SprintBoard } from "@/components/tasks/SprintBoard";
import { ProjectsGrid } from "@/components/tasks/ProjectsGrid";

type View = "list" | "timeline" | "sprint" | "projects";

const VIEWS: Array<{ id: View; label: string; icon: RoyIconName }> = [
  { id: "list", label: "Задачи", icon: "task" },
  { id: "timeline", label: "Таймлайн", icon: "timeline" },
  { id: "sprint", label: "Спринт", icon: "board" },
  { id: "projects", label: "Проекты", icon: "graph" },
];

export function TasksScreen() {
  const [view, setView] = useState<View>("list");

  return (
    <div className="flex flex-col h-full">
      {/* Переключатель видов — лайн-арт RoyIcon + стеклянные чипы */}
      <div className="flex gap-1.5 px-3 pt-3 pb-2 overflow-x-auto shrink-0">
        {VIEWS.map(({ id, label, icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                active
                  ? "bg-primary text-white"
                  : "bg-surface text-ink-soft border border-line hover:bg-surface-2 dark:backdrop-blur-sm"
              }`}
            >
              <RoyIcon name={icon} size={14} strokeWidth={1.9} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {view === "list" && <RemindersTasks />}
        {view === "timeline" && <TimelineView />}
        {view === "sprint" && <SprintBoard />}
        {view === "projects" && <ProjectsGrid />}
      </div>
    </div>
  );
}
