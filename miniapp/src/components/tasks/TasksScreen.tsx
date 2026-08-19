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
  // Таймлайн временно скрыт по решению владельца 2026-08-19 — интерфейс требует доработки.
  // Код (TimelineView) оставлен для возможного возврата. Чтобы вернуть: раскомментировать строку ниже.
  // { id: "timeline", label: "Таймлайн", icon: "timeline" },
  { id: "sprint", label: "Проекты", icon: "board" },
  // Старые проекты (react-flow дерево) временно отключены по решению владельца 2026-08-06 —
  // код (ProjectsGrid/ProjectTree/treeGeom) оставлен для возможного возврата. Работа по проектам
  // теперь ведётся секциями на доске «Проекты» (таб выше). Чтобы вернуть: раскомментировать строку ниже.
  // { id: "projects", label: "Старые проекты", icon: "graph" },
];

// Запоминаем вкладку (Задачи/Таймлайн/Проекты), чтобы рефреш страницы не сбрасывал на «Задачи»
// (владелец 2026-08-19: «рефреш скидывает на экран задач, надо оставаться там же»). Тот же
// паттерн, что у верхней вкладки в RoyApp.tsx (roy_tab) — sessionStorage, не переживает закрытие
// вкладки браузера, только рефреш.
const VIEW_KEY = "roy_tasks_view";
const VALID_VIEWS: readonly View[] = ["list", "timeline", "sprint", "projects"];

function readInitialView(): View {
  if (typeof window === "undefined") return "list";
  try {
    const saved = window.sessionStorage.getItem(VIEW_KEY);
    if (VALID_VIEWS.includes(saved as View)) return saved as View;
  } catch { /* приватный режим/квота — не критично */ }
  return "list";
}

export function TasksScreen() {
  const [view, setViewState] = useState<View>(readInitialView);
  const setView = (v: View) => {
    setViewState(v);
    try { window.sessionStorage.setItem(VIEW_KEY, v); } catch { /* приватный режим/квота — не критично */ }
  };

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
