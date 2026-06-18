"use client";
import type { MouseEvent, ReactNode } from "react";
import type { Task } from "@/types";
import { PriDot, Market, Avatar } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";
import { isDone, isOverdue } from "@/lib/smartLists";
import { displayName } from "@/lib/utils";

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

type TaskRowProps = {
  task: Task;
  onToggle: () => void;
  showAssignee?: boolean;
  now?: Date;
  /** Десктоп: кнопки изменить/удалить, показываются по hover контейнера (group). */
  trailing?: ReactNode;
};

// Строка задачи в стиле macOS Reminders: крупный круглый чекбокс, заголовок, чипы (рынок/срок/важное),
// аватар исполнителя. Непрозрачный фон — чтобы корректно работать внутри SwipeRow на мобайле.
export function TaskRow({ task, onToggle, showAssignee = true, now = new Date(), trailing }: TaskRowProps) {
  const done = isDone(task);
  const overdue = isOverdue(task, now);
  const due = fmtDue(task.due_date);
  const high = task.priority === "high";
  const assignee = task.assignees?.[0];

  return (
    <div className="flex items-start gap-3 bg-background px-1 py-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Снять отметку" : "Отметить выполненной"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e: MouseEvent) => { e.stopPropagation(); onToggle(); }}
        className="mt-0.5 flex shrink-0 items-center justify-center rounded-full border-2 transition-colors"
        style={{
          width: 22,
          height: 22,
          borderColor: done ? "var(--status-done)" : "var(--line-2)",
          background: done ? "var(--status-done)" : "transparent",
        }}
      >
        {done && <RoyIcon name="check" size={13} strokeWidth={2.4} className="text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {!done && high && <PriDot pri="high" />}
          <span
            className="truncate font-semibold text-ink"
            style={{
              fontSize: 14.5,
              letterSpacing: "-0.01em",
              textDecoration: done ? "line-through" : "none",
              opacity: done ? 0.5 : 1,
            }}
          >
            {task.title}
          </span>
        </div>
        {(task.country || due || high) && !done && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Market code={task.country} />
            {due && (
              <span
                className="inline-flex items-center gap-1"
                style={{ fontSize: 12, color: overdue ? "var(--pri-high)" : "var(--ink-soft)", fontWeight: overdue ? 600 : 400 }}
              >
                <RoyIcon name="cal" size={12} />
                {due}
              </span>
            )}
            {high && (
              <span
                className="inline-flex items-center gap-1 font-semibold"
                style={{ fontSize: 11, color: "var(--pri-high)", background: "color-mix(in srgb, var(--pri-high) 12%, transparent)", borderRadius: 7, padding: "2px 7px" }}
              >
                <RoyIcon name="flag" size={11} />
                Важное
              </span>
            )}
          </div>
        )}
      </div>

      {showAssignee && assignee && <Avatar size={26}>{initials(assignee)}</Avatar>}
      {trailing}
    </div>
  );
}
