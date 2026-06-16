"use client";
import { useState, useEffect, useCallback, type DragEvent } from "react";
import { fetchMe, fetchTasks, updateTask, deleteTask } from "@/lib/api";
import type { Me, Task } from "@/types";
import { TaskModal } from "@/components/TaskModal";
import { displayName } from "@/lib/utils";
import { RoyCard, PriDot, Market, Avatar, STATUS_META } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";

const STATUSES = ["open", "in_progress", "done"] as const;
type Status = (typeof STATUSES)[number];

const COLUMNS: { status: Status; label: string }[] = [
  { status: "open", label: "Открыто" },
  { status: "in_progress", label: "В работе" },
  { status: "done", label: "Готово" },
];

const norm = (s: string): Status => (s === "progress" ? "in_progress" : (s as Status));
const pri = (t: Task) => (t.priority as "high" | "med" | "low" | null) ?? null;

function fmtDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function initials(name: string): string {
  const n = displayName(name);
  if (n === "—" || n.startsWith("#")) return "?";
  return n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function KanbanBoard() {
  const [me, setMe] = useState<Me | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<401 | 403 | null>(null);
  const [modalTask, setModalTask] = useState<Task | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await fetchTasks());
    } catch {
      /* keep existing on polling error */
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

  const move = async (id: string, status: Status) => {
    const cur = tasks.find((t) => t.id === id);
    if (!cur || norm(cur.status) === status) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await updateTask(id, { status });
    } catch {
      loadTasks();
    }
  };

  const remove = async (t: Task) => {
    if (!window.confirm(`Удалить «${t.title}»?`)) return;
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await deleteTask(t.id);
    } catch {
      loadTasks();
    }
  };

  const onDrop = (e: DragEvent, status: Status) => {
    e.preventDefault();
    setOverCol(null);
    const id = e.dataTransfer.getData("text/plain") || dragId;
    if (id) move(id, status);
  };

  if (authError === 401) {
    return <CenterMsg>Нет доступа. Откройте приложение из Telegram.</CenterMsg>;
  }
  if (authError === 403) {
    return <CenterMsg>Воркспейс не назначен. Обратитесь к админу.</CenterMsg>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <h1 className="font-bold text-ink" style={{ fontSize: 26, letterSpacing: "-0.02em" }}>
          {me ? `Привет, ${me.name.split(" ")[0]}` : "Задачи"}
        </h1>
        <button
          type="button"
          onClick={() => setModalTask("new")}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 font-semibold text-white transition-transform active:scale-[0.97]"
          style={{ fontSize: 13.5 }}
        >
          <RoyIcon name="plus" size={16} strokeWidth={2.3} />
          Новая задача
        </button>
      </header>

      <div className="min-h-0 flex-1 px-4 pb-4">
        <div className="grid h-full grid-cols-3 gap-3">
          {COLUMNS.map((col) => {
            const meta = STATUS_META[col.status];
            const colTasks = tasks.filter((t) => norm(t.status) === col.status);
            const isOver = overCol === col.status;
            return (
              <div
                key={col.status}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.status); }}
                onDragLeave={() => setOverCol((c) => (c === col.status ? null : c))}
                onDrop={(e) => onDrop(e, col.status)}
                className="flex min-h-0 flex-col rounded-[16px] border bg-surface-2/50 transition-colors"
                style={{ borderColor: isOver ? meta.color : "var(--line)" }}
              >
                <div className="flex shrink-0 items-center gap-2 px-3.5 py-3">
                  <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: meta.color }} />
                  <span className="font-bold text-ink" style={{ fontSize: 14 }}>{col.label}</span>
                  <span className="ml-auto font-semibold text-ink-mute" style={{ fontSize: 12.5 }}>{colTasks.length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                  {loading && tasks.length === 0 && [0, 1].map((i) => <div key={i} className="roy-shim" style={{ height: 76, borderRadius: 14 }} />)}
                  {!loading && colTasks.length === 0 && (
                    <p className="py-8 text-center text-ink-mute" style={{ fontSize: 12.5 }}>пусто</p>
                  )}
                  {colTasks.map((t) => (
                    <RoyCard
                      key={t.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; setDragId(t.id); }}
                      onDragEnd={() => setDragId(null)}
                      className="group cursor-grab rounded-[14px] p-3 active:cursor-grabbing"
                      style={{ opacity: dragId === t.id ? 0.5 : 1 }}
                    >
                      <p className="line-clamp-2 font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
                        {t.title}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        {pri(t) && <PriDot pri={pri(t)} />}
                        <Market code={t.country} />
                        {fmtDue(t.due_date) && (
                          <span className="inline-flex items-center gap-1 text-ink-mute" style={{ fontSize: 11.5 }}>
                            <RoyIcon name="cal" size={11} />
                            {fmtDue(t.due_date)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2">
                        {t.assignees?.[0] ? (
                          <span className="inline-flex items-center gap-1.5 text-ink-soft" style={{ fontSize: 11.5 }}>
                            <Avatar size={20}>{initials(t.assignees[0])}</Avatar>
                            <span className="max-w-[110px] truncate">{displayName(t.assignees[0])}</span>
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <IconBtn label="Изменить" onClick={() => setModalTask(t)} color="var(--status-open)">
                            <RoyIcon name="pencil" size={15} strokeWidth={1.9} />
                          </IconBtn>
                          <IconBtn label="Удалить" onClick={() => remove(t)} color="var(--pri-high)">
                            <RoyIcon name="trash" size={15} strokeWidth={1.9} />
                          </IconBtn>
                        </span>
                      </div>
                    </RoyCard>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
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

function IconBtn({ label, onClick, color, children }: { label: string; onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex items-center justify-center rounded-[8px] p-1.5 transition-colors hover:bg-surface-2 active:scale-[0.92]"
      style={{ color }}
    >
      {children}
    </button>
  );
}

function CenterMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <p className="text-base" style={{ color: "var(--pri-high)" }}>{children}</p>
    </div>
  );
}
