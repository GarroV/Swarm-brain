"use client";
import { useRoyNav, useDt } from "../nav";
import { DashBlock, DashTaskRow, norm } from "./shared";
import type { DashboardData } from "./useDashboardData";

// Право-низ главного экрана: задачи команды (assignee ≠ текущий пользователь).
// Тот же `DashTaskRow` (= `TaskRow`), что и на доске/в «Моих» — единый вид; исполнитель
// показывается аватаром (showAssignee). Шапка → вкладка «Задачи» (доска).
// Источник: splitByOwner().team. Показываем только незавершённые — то, что в работе.

export function TeamTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { openTasks } = useRoyNav();
  const dt = useDt();
  const { loading, team } = data;
  // Активные задачи команды: незавершённые требуют внимания.
  const active = team.filter((t) => norm(t.status) !== "done");

  return (
    <DashBlock
      title={dt("Задачи команды", "Team tasks")}
      icon="team"
      tint="var(--tag-link)"
      headAction={dt("Доска", "Board")}
      loading={loading}
      empty={active.length === 0}
      emptyText={dt("Активных задач команды нет", "No active team tasks")}
      onHead={() => openTasks("team", "all")}
      className={className}
    >
      {active.map((t) => (
        <DashTaskRow key={t.id} task={t} showAssignee />
      ))}
    </DashBlock>
  );
}
