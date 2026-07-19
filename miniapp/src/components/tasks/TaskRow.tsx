"use client";
import type { MouseEvent, ReactNode } from "react";
import type { Task } from "@/types";
import { PriDot, Market, AvatarStack } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { isDone, isOverdue } from "@/lib/smartLists";

function fmtDue(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

type TaskRowProps = {
  task: Task;
  onToggle: () => void;
  showAssignee?: boolean;
  now?: Date;
  /** Десктоп: кнопки изменить/удалить в мета-ряду (рядом с датой), показываются по hover строки (group). */
  trailing?: ReactNode;
};

// Строка задачи в стиле macOS Reminders: крупный круглый чекбокс, заголовок, чипы (рынок/срок/важное),
// аватар исполнителя. Непрозрачный фон — чтобы корректно работать внутри SwipeRow на мобайле.
export function TaskRow({ task, onToggle, showAssignee = true, now = new Date(), trailing }: TaskRowProps) {
  const dt = useDt();
  const done = isDone(task);
  const overdue = isOverdue(task, now);
  const due = fmtDue(task.due_date, dt("ru-RU", "en-US"));
  const high = task.priority === "high";
  const fromMeeting = Boolean(task.meeting_id);
  const hasAssignee = showAssignee && (task.assignees?.length ?? 0) > 0;
  const showMeta = !done && (Boolean(task.country || due || high) || fromMeeting || hasAssignee);

  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? dt("Снять отметку", "Mark as not done") : dt("Отметить выполненной", "Mark as done")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e: MouseEvent) => { e.stopPropagation(); onToggle(); }}
        className="mt-px flex shrink-0 items-center justify-center rounded-full border-2 transition-colors"
        style={{
          width: 19,
          height: 19,
          borderColor: done ? "var(--status-done)" : "var(--line-2)",
          background: done ? "var(--status-done)" : "transparent",
        }}
      >
        {done && <RoyIcon name="check" size={11} strokeWidth={2.4} className="text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {!done && high && <PriDot pri="high" />}
          <span
            className="truncate font-semibold text-ink"
            style={{
              fontSize: 14,
              letterSpacing: "-0.01em",
              textDecoration: done ? "line-through" : "none",
              opacity: done ? 0.5 : 1,
            }}
          >
            {task.title}
          </span>
        </div>
        {showMeta ? (
          // Есть чипы (дата/рынок/важное) — кнопки изменить/удалить встают в тот же ряд, рядом с датой.
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {hasAssignee && (
              // Чья задача — ИМЕНЕМ, а не только аватаром-инициалами (видно в линзах «Команда»/«Все»).
              <span className="inline-flex items-center gap-1 font-semibold text-ink-soft bg-surface-2 border border-line-2" style={{ fontSize: 10.5, borderRadius: 6, padding: "1px 6px" }}>
                <RoyIcon name="team" size={10} />
                {task.assignees[0]}{task.assignees.length > 1 ? ` +${task.assignees.length - 1}` : ""}
              </span>
            )}
            {fromMeeting && (
              <span className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 10.5, color: "var(--meet-ink)", background: "var(--meet-soft)", borderRadius: 6, padding: "1px 6px" }}>
                <RoyIcon name="meet" size={10} /> {dt("Встреча", "Meeting")}
              </span>
            )}
            <Market code={task.country} />
            {due && (
              <span
                className="inline-flex items-center gap-1"
                style={{ fontSize: 11.5, color: overdue ? "var(--pri-high)" : "var(--ink-soft)", fontWeight: overdue ? 600 : 400 }}
              >
                <RoyIcon name="cal" size={11} />
                {due}
              </span>
            )}
            {high && (
              <span
                className="inline-flex items-center gap-1 font-semibold"
                style={{ fontSize: 10.5, color: "var(--pri-high)", background: "color-mix(in srgb, var(--pri-high) 12%, transparent)", borderRadius: 6, padding: "1px 6px" }}
              >
                <RoyIcon name="flag" size={10} />
                {dt("Важное", "Important")}
              </span>
            )}
            {trailing}
          </div>
        ) : trailing ? (
          // Чипов нет — не держим пустой ряд: кнопки появляются отдельной строкой только по hover.
          <div className="mt-1 hidden items-center gap-2 group-hover:flex">{trailing}</div>
        ) : null}
      </div>

      {showAssignee && task.assignees?.length > 0 && <AvatarStack names={task.assignees} size={22} />}
    </div>
  );
}
