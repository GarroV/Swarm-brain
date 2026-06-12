"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchMe, fetchTasks, updateTask, deleteTask } from "@/lib/api";
import type { Me, Task } from "@/types";
import { TaskCard } from "@/components/TaskCard";
import { TaskModal } from "@/components/TaskModal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const STATUSES = ["open", "in_progress", "done"] as const;
type Status = (typeof STATUSES)[number];

const TAB_LABELS: Record<Status, string> = {
  open: "Открыто",
  in_progress: "В работе",
  done: "Готово",
};

const SWIPE_THRESHOLD = 60;

function useTabSwipe(activeStatus: Status, setActiveStatus: (s: Status) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      start.current = null;

      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;

      const idx = STATUSES.indexOf(activeStatus);
      if (dx < 0 && idx < STATUSES.length - 1) setActiveStatus(STATUSES[idx + 1]);
      else if (dx > 0 && idx > 0) setActiveStatus(STATUSES[idx - 1]);
    },
  };
}

export function KanbanBoard() {
  const [me, setMe] = useState<Me | null>(null);
  const [tasksByStatus, setTasksByStatus] = useState<Record<Status, Task[]>>({
    open: [],
    in_progress: [],
    done: [],
  });
  const [activeStatus, setActiveStatus] = useState<Status>("open");
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<401 | 403 | null>(null);
  const [modalTask, setModalTask] = useState<Task | "new" | null>(null);
  const swipeHandlers = useTabSwipe(activeStatus, setActiveStatus);

  const loadTasks = useCallback(async () => {
    try {
      const [open, in_progress, done] = await Promise.all([
        fetchTasks("open"),
        fetchTasks("in_progress"),
        fetchTasks("done"),
      ]);
      setTasksByStatus({ open, in_progress, done });
    } catch {
      // On polling error, keep existing data visible
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch((err: unknown) => {
        const status = (err as { status?: number }).status;
        if (status === 401) setAuthError(401);
        else if (status === 403) setAuthError(403);
      });
  }, []);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 10_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadTasks();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTasks]);

  if (authError === 401) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-center">
        <p className="text-destructive text-base">
          Нет доступа. Откройте приложение из Telegram.
        </p>
      </div>
    );
  }

  if (authError === 403) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-center">
        <p className="text-destructive text-base">
          Воркспейс не назначен. Обратитесь к админу.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">
          {me ? `Привет, ${me.name.split(" ")[0]}` : "Задачи"}
        </h1>
      </div>

      <Tabs
        value={activeStatus}
        onValueChange={(v) => setActiveStatus(v as Status)}
        className="flex-1 flex flex-col min-h-0"
        onTouchStart={swipeHandlers.onTouchStart}
        onTouchEnd={swipeHandlers.onTouchEnd}
      >
        <TabsList className="mx-4 grid grid-cols-3">
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {TAB_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>

        {STATUSES.map((s) => (
          <TabsContent
            key={s}
            value={s}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3 mt-0"
          >
            {loading && s === activeStatus ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                Загрузка…
              </p>
            ) : tasksByStatus[s].length === 0 && s === activeStatus ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                Нет задач
              </p>
            ) : (
              tasksByStatus[s].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onEdit={() => setModalTask(task)}
                  onStatusChange={async (newStatus) => {
                    await updateTask(task.id, { status: newStatus });
                    loadTasks();
                  }}
                  onDelete={async () => {
                    await deleteTask(task.id);
                    loadTasks();
                  }}
                />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>

      <div className="p-4">
        <Button className="w-full" onClick={() => setModalTask("new")}>
          + Новая задача
        </Button>
      </div>

      <TaskModal
        task={modalTask !== null && modalTask !== "new" ? modalTask : undefined}
        open={modalTask !== null}
        onClose={() => setModalTask(null)}
        onSaved={loadTasks}
      />
    </div>
  );
}
