"use client";
import type { MouseEvent, ReactNode } from "react";
import type { Task } from "@/types";
import type { TaskLabel } from "@/lib/api";
import { PriDot, Market } from "@/components/roy/ui";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
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
  /** Все метки воркспейса — из них показываем те, в чьих списках состоит задача (task.label_ids). */
  labels?: TaskLabel[];
};

// Строка задачи в стиле macOS Reminders: крупный круглый чекбокс, заголовок, чипы (рынок/срок/важное),
// аватар исполнителя. Непрозрачный фон — чтобы корректно работать внутри SwipeRow на мобайле.
export function TaskRow({ task, onToggle, showAssignee = true, now = new Date(), trailing, labels = [] }: TaskRowProps) {
  const dt = useDt();
  const done = isDone(task);
  const overdue = isOverdue(task, now);
  const due = fmtDue(task.due_date, dt("ru-RU", "en-US"));
  // Пинг показываем, только пока он ЖДЁТ: отзвонивший (reminded_at) сгорел, и висящая
  // дата напоминания вводила бы в заблуждение — «напомнят», хотя уже напомнили.
  const ping = done || task.reminded_at ? null : fmtDue(task.remind_date, dt("ru-RU", "en-US"));
  const high = task.priority === "high";
  const fromMeeting = Boolean(task.meeting_id);
  const hasAssignee = showAssignee && (task.assignees?.length ?? 0) > 0;
  // Списки, в которых состоит задача (личные смарт-метки) — показываем чипами на карточке.
  const taskLabels = done ? [] : labels.filter((l) => task.label_ids?.includes(l.id));

  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? dt("Снять отметку", "Mark as not done") : dt("Отметить выполненной", "Mark as done")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e: MouseEvent) => { e.stopPropagation(); onToggle(); }}
        // Кружок остаётся мелким (плотность строки), а нажимается зона 40x44 — псевдоэлемент
        // ::after, поэтому вёрстка не сдвигается. Вправо зона растянута меньше: там начинается
        // заголовок, и тап по нему должен открывать задачу, а не переключать галочку.
        className="relative mt-px flex shrink-0 items-center justify-center rounded-full border-2 transition-colors after:absolute after:-left-3 after:-right-1.5 after:-top-3 after:-bottom-3 after:content-['']"
        style={{
          width: 20,
          height: 20,
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
        {/* Мета-ряд рендерится ВСЕГДА (даже без чипов) с фикс. min-height — чтобы hover-действия
            (trailing, opacity-0→hover) не «выпадали» новой строкой и список не дёргался: место под
            них зарезервировано, ряды одинаковой высоты. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 min-h-[20px]">
          {/* Дата — у левого края (первой), затем остальные чипы. */}
          {due && (
            <span className="inline-flex items-center gap-1" style={{ fontSize: 11.5, color: overdue ? "var(--pri-high)" : "var(--ink-soft)", fontWeight: overdue ? 600 : 400 }}>
              <RoyIcon name="cal" size={11} />
              {due}
            </span>
          )}
          {ping && (
            // Ближайший пинг — рядом со сроком: видно «когда напомнят», не открывая карточку.
            <span
              className="inline-flex items-center gap-1 font-semibold"
              style={{ fontSize: 10.5, color: "var(--accent-ink)", background: "var(--accent-soft)", borderRadius: 6, padding: "1px 6px" }}
              title={dt("Напомним в этот день", "You'll be reminded on this day")}
            >
              <RoyIcon name="bell" size={10} />
              {ping}
            </span>
          )}
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
          {/* Списки задачи (личные смарт-метки) — как выбранные на карточке. */}
          {taskLabels.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 10.5, borderRadius: 6, padding: "1px 6px", color: l.color ?? "var(--ink-soft)", background: l.color ? `color-mix(in srgb, ${l.color} 14%, transparent)` : "var(--surface-2)", border: `1px solid ${l.color ? `color-mix(in srgb, ${l.color} 35%, transparent)` : "var(--line-2)"}` }}>
              <RoyIcon name={l.icon as RoyIconName} size={10} /> {l.name}
            </span>
          ))}
          {!done && high && (
            <span className="inline-flex items-center gap-1 font-semibold" style={{ fontSize: 10.5, color: "var(--pri-high)", background: "color-mix(in srgb, var(--pri-high) 12%, transparent)", borderRadius: 6, padding: "1px 6px" }}>
              <RoyIcon name="flag" size={10} />
              {dt("Важное", "Important")}
            </span>
          )}
          {trailing}
        </div>
      </div>
    </div>
  );
}
