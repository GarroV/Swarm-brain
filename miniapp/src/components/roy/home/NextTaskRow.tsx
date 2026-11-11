"use client";
import type { MouseEvent } from "react";
import type { Task } from "@/types";
import { Market } from "../ui";
import { RoyIcon } from "../icons";
import { useDt } from "../nav";
import { isDone } from "@/lib/smartLists";
import { homeDueInfo, homeToday, type HomeDateReason } from "@/lib/homeTasks";

// Строка «Ближайших задач» главной (экран «А», 09.11.2026): чекбокс · название + метка страны, под
// ним проект мелко · справа срок моноширинным — просрочено красным, сегодня янтарём, дальше серым.
// Закрытие и открытие задачи — как в остальных строках (DashTaskRow); здесь только вид.

type Props = { task: Task; project: string | null; reason: HomeDateReason | null; now: Date; onToggle: () => void };

export function NextTaskRow({ task, project, reason, now, onToggle }: Props) {
  const dt = useDt();
  const done = isDone(task);
  const info = reason ? homeDueInfo(reason, homeToday(now)) : null;
  const when = reason ? new Date(`${reason.date}T00:00:00`).toLocaleDateString(dt("ru-RU", "en-US"), { day: "numeric", month: "short" }) : "";
  const text = !info ? ""
    : info.tone === "over" ? dt(`просрочено ${-info.days} дн`, `${-info.days} d overdue`)
    : info.tone === "today" ? dt("сегодня", "today")
    : info.days === 1 ? dt("завтра", "tomorrow") : when;
  const ping = reason?.kind === "ping" && info?.tone !== "over";
  const color = info?.tone === "over" ? "var(--pri-high)" : info?.tone === "today" ? "var(--pri-med)" : "var(--ink-mute)";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <button type="button" role="checkbox" aria-checked={done}
        aria-label={done ? dt("Снять отметку", "Mark as not done") : dt("Отметить выполненной", "Mark as done")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e: MouseEvent) => { e.stopPropagation(); onToggle(); }}
        className="relative flex shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors after:absolute after:-inset-3 after:content-['']"
        style={{ width: 18, height: 18, borderColor: done ? "var(--status-done)" : "var(--line-2)", background: done ? "var(--status-done)" : "transparent" }}>
        {done && <RoyIcon name="check" size={11} strokeWidth={2.4} className="text-white" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate font-medium ${done ? "text-ink-mute line-through" : "text-ink"}`} style={{ fontSize: 13.5 }} title={task.title}>{task.title}</span>
          <Market code={task.country} />
        </div>
        {project && <div className="mt-0.5 truncate text-ink-mute" style={{ fontSize: 11.5 }}>{project}</div>}
      </div>
      {text && (
        <span className="shrink-0 whitespace-nowrap font-mono" style={{ fontSize: 12, color }}
          title={ping ? dt("Показана по напоминанию", "Shown because of its reminder") : undefined}>
          {ping ? dt("напом. ", "remind ") : ""}{text}
        </span>
      )}
    </div>
  );
}
