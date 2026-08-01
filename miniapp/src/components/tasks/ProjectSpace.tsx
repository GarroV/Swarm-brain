"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Task } from "@/types";
import { fetchTasks, updateTask } from "@/lib/api";
import { useProjectCanvas } from "@/components/tasks/useProjectCanvas";
import { TaskModal } from "@/components/TaskModal";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";

type Props = { project: Project; onBack: () => void };

export function ProjectSpace({ project, onBack }: Props) {
  const dt = useDt();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setTasks(await fetchTasks({ project_id: project.id }));
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);

  const onOpenTask = useCallback((taskId: string) => setOpenTaskId(taskId), []);
  const onToggleLink = useCallback(async (taskId: string, linked: boolean) => {
    // Оптимистично: меняем локально СРАЗУ (это триггерит пересборку раскладки хука на
    // новый статус до завершения запроса — устраняет flicker при drag-to-connect, см.
    // правку useProjectCanvas: синхронный layout() в onUp убран, раскладка идёт только
    // через это обновление пропа tasks). Откат при ошибке.
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, project_linked: linked } : t)));
    try {
      await updateTask(taskId, { project_linked: linked });
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, project_linked: !linked } : t)));
    }
  }, []);

  useProjectCanvas(canvasRef, {
    hub: { id: project.id, name: project.name, color: project.color, emoji: project.emoji },
    tasks,
    onOpenTask,
    onToggleLink,
  });

  const openTask = tasks.find((t) => t.id === openTaskId);

  return (
    <div className="relative flex-1 min-h-0">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1 rounded-full bg-surface border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2">
          <RoyIcon name="cleft" size={14} /> {dt("Проекты", "Projects")}
        </button>
        <span className="text-sm font-bold text-ink">{project.name}</span>
      </div>
      <button
        onClick={() => setCreating(true)}
        className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white active:scale-95"
      >
        <RoyIcon name="plus" size={14} /> {dt("Идея", "Idea")}
      </button>
      <div className="absolute inset-0" style={{ background: "#0d0d12" }}>
        <canvas ref={canvasRef} className="h-full w-full touch-none" />
      </div>

      {openTask && (
        <TaskModal
          task={openTask}
          open
          onClose={() => setOpenTaskId(null)}
          onSaved={() => { setOpenTaskId(null); void load(); }}
        />
      )}
      {creating && (
        <TaskModal
          open
          prefill={{}}
          projectId={project.id}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
        />
      )}
    </div>
  );
}
