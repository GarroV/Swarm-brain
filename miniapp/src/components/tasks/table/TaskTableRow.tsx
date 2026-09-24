"use client";
import type { MouseEvent } from "react";
import { cn, displayName } from "@/lib/utils";
import type { Task, User } from "@/types";
import type { TaskLabel } from "@/lib/api";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { isDone, isOverdue } from "@/lib/smartLists";
import { TaskQuickActions } from "@/components/tasks/TaskQuickActions";

// Строка таблицы задач нового вида (стенд: screens-tasks.js → taskRow). Порядок колонок —
// по тому, чем в строке ПОЛЬЗУЮТСЯ (владелец 22.09.2026): срок и быстрые действия у названия,
// дальше рынок, потом проект, исполнитель и списки — их читают глазами.

export const COLS = "minmax(260px,1fr) 88px 168px 64px minmax(110px,18%) minmax(110px,15%) minmax(90px,14%)";

const fmtDue = (iso: string, en: boolean) =>
  new Date(iso).toLocaleDateString(en ? "en-GB" : "ru-RU", { day: "numeric", month: "short" }).replace(".", "");

export function TaskTableRow({ task, now, users, markets, labels, projectName, onOpen, onToggle, onPatch, onChanged }: {
  task: Task;
  now: Date;
  users: User[];
  markets: string[];
  labels: TaskLabel[];
  projectName: string | null;
  onOpen: () => void;
  onToggle: () => void;
  onPatch: (patch: Partial<Task>) => void;
  onChanged: () => void;
}) {
  const dt = useDt();
  const done = isDone(task);
  const late = isOverdue(task, now);
  const inProgress = task.status === "in_progress";
  const who = task.assignee_telegram_ids?.[0];
  const whoName = who != null
    ? displayName(users.find((u) => u.telegram_id === who)?.name ?? task.assignees?.[0] ?? "")
    : "";
  const labelNames = (task.label_ids ?? [])
    .map((id) => labels.find((l) => l.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className="group grid cursor-pointer items-center border-b border-line transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      style={{ gridTemplateColumns: COLS, minHeight: 40, fontSize: 13.5 }}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3">
        <button
          type="button"
          onClick={(e) => { stop(e); onToggle(); }}
          aria-label={done ? dt("Вернуть в работу", "Reopen") : dt("Готово", "Done")}
          className={cn(
            "flex size-[17px] shrink-0 items-center justify-center rounded-full border-[1.6px] transition-colors",
            done ? "border-status-done bg-status-done text-white" : inProgress ? "border-primary" : "border-ink-mute hover:border-primary",
          )}
        >
          {done && <RoyIcon name="check" size={11} strokeWidth={2.6} />}
        </button>
        <span className={cn("min-w-0 truncate", done ? "text-ink-mute line-through" : "text-ink")}>{task.title}</span>
        {task.is_private && (
          <span title={dt("Личная", "Private")} className="shrink-0 text-ink-mute">
            <RoyIcon name="lock" size={12} />
          </span>
        )}
      </div>
      <div className={cn("px-2 font-mono", late ? "font-semibold text-pri-high" : "text-ink-soft")} style={{ fontSize: 12 }}>
        {task.due_date ? fmtDue(task.due_date, dt("ru", "en") === "en") : <span className="text-ink-mute">—</span>}
      </div>
      <div onClick={stop} className="flex items-center gap-0.5 px-1 opacity-60 transition-opacity group-hover:opacity-100">
        <TaskQuickActions task={task} users={users} markets={markets} labels={labels} onPatch={onPatch} onChanged={onChanged} />
      </div>
      <div className="px-2 font-mono text-ink-soft" style={{ fontSize: 12 }}>
        {task.country ?? <span className="text-ink-mute">—</span>}
      </div>
      <div className="min-w-0 truncate px-2 text-ink-soft">{projectName ?? <span className="text-ink-mute">—</span>}</div>
      <div className="min-w-0 truncate px-2 text-ink-soft">{whoName || <span className="text-ink-mute">—</span>}</div>
      <div className="min-w-0 truncate px-2 text-ink-mute" style={{ fontSize: 12.5 }}>{labelNames || "—"}</div>
    </div>
  );
}
