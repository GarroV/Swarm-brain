"use client";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useRoyNav } from "../nav";
import { RoyHeader, Segmented, RoyCard, PriDot, Market, Avatar, FAB } from "../ui";
import { RoyIcon } from "../icons";
import { SwipeRow } from "../SwipeRow";
import { fetchTasks, updateTask, deleteTask } from "@/lib/api";
import { displayName } from "@/lib/utils";
import type { Task } from "@/types";

const SEGS = [
  { id: "open", label: "Открыто" },
  { id: "in_progress", label: "В работе" },
  { id: "done", label: "Готово" },
];

const norm = (s: string) => (s === "progress" ? "in_progress" : s);
const pri = (t: Task) => (t.priority as "high" | "med" | "low" | null) ?? null;

function fmtDue(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return null;
  }
}
function initials(name: string): string {
  const n = displayName(name);
  if (n === "—" || n.startsWith("#")) return "?";
  return n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function RoyTasksScreen() {
  const { push, toast } = useRoyNav();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [seg, setSeg] = useState("open");

  const load = useCallback(() => {
    fetchTasks()
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = (id: string) => (tasks ?? []).filter((t) => norm(t.status) === id).length;
  const items = (tasks ?? []).filter((t) => norm(t.status) === seg);
  const done = (t: Task) => norm(t.status) === "done";

  const toggle = async (t: Task, e: MouseEvent) => {
    e.stopPropagation();
    const next = done(t) ? "open" : "done";
    setTasks((prev) => prev?.map((x) => (x.id === t.id ? { ...x, status: next } : x)) ?? null);
    try {
      await updateTask(t.id, { status: next });
    } catch {
      load();
    }
  };

  const remove = async (t: Task) => {
    setTasks((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
    try {
      await deleteTask(t.id);
      toast("Задача удалена");
    } catch {
      toast("Не удалось удалить");
      load();
    }
  };

  return (
    <div className="relative h-full overflow-y-auto">
      <RoyHeader title="Задачи" />
      <div className="px-5 pb-3">
        <Segmented items={SEGS.map((s) => ({ ...s, count: counts(s.id) }))} value={seg} onChange={setSeg} />
      </div>
      <div className="space-y-2.5 px-5 pb-28">
        {tasks == null && [0, 1, 2].map((i) => <div key={i} className="roy-shim" style={{ height: 64, borderRadius: 18 }} />)}
        {tasks && items.length === 0 && (
          <div className="py-10 text-center text-sm text-ink-soft">{seg === "done" ? "Пусто — всё разобрано" : "Здесь пока пусто"}</div>
        )}
        {items.map((t) => (
          <SwipeRow
            key={t.id}
            onTap={() => push({ view: "taskDetail", params: { id: t.id } })}
            actions={[
              { icon: "pencil", label: "Изменить", color: "var(--status-open)", onClick: () => push({ view: "newTask", params: { id: t.id } }) },
              { icon: "trash", label: "Удалить", color: "var(--pri-high)", onClick: () => remove(t) },
            ]}
          >
            <RoyCard className="flex items-center gap-3 px-4 py-3.5">
              <span
                role="checkbox"
                aria-checked={done(t)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => toggle(t, e)}
                className="flex shrink-0 items-center justify-center rounded-full border-2"
                style={{
                  width: 22,
                  height: 22,
                  borderColor: done(t) ? "var(--status-done)" : "var(--line-2)",
                  background: done(t) ? "var(--status-done)" : "transparent",
                }}
              >
                {done(t) && <RoyIcon name="check" size={13} strokeWidth={2.4} className="text-white" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <PriDot pri={pri(t)} />
                  <span
                    className="truncate font-semibold text-ink"
                    style={{ fontSize: 14.5, letterSpacing: "-0.01em", textDecoration: done(t) ? "line-through" : "none", opacity: done(t) ? 0.55 : 1 }}
                  >
                    {t.title}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Market code={t.country} />
                  {fmtDue(t.due_date) && (
                    <span className="inline-flex items-center gap-1 text-ink-soft" style={{ fontSize: 12 }}>
                      <RoyIcon name="cal" size={12} />
                      {fmtDue(t.due_date)}
                    </span>
                  )}
                </div>
              </div>
              {t.assignees?.[0] && <Avatar size={28}>{initials(t.assignees[0])}</Avatar>}
            </RoyCard>
          </SwipeRow>
        ))}
      </div>
      <FAB onClick={() => push({ view: "newTask" })} />
    </div>
  );
}
