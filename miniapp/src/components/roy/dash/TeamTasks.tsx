"use client";
import { useRoyNav } from "../nav";
import { DashBlock, DashTaskRow, norm } from "./shared";
import type { DashboardData } from "./useDashboardData";

// Право-низ главного экрана: задачи команды (assignee ≠ текущий пользователь).
// Тот же `DashTaskRow` (= `TaskRow`), что и на доске/в «Моих» — единый вид; исполнитель
// показывается аватаром (showAssignee). Шапка → вкладка «Задачи» (доска).
// Источник: splitByOwner().team. Показываем только незавершённые — то, что в работе.

export function TeamTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { setTab } = useRoyNav();
  const { loading, team } = data;
  // Активные задачи команды: незавершённые требуют внимания.
  const active = team.filter((t) => norm(t.status) !== "done");

  return (
    <DashBlock
      title="Задачи команды"
      icon="team"
      tint="var(--tag-link)"
      headAction="Доска"
      loading={loading}
      empty={active.length === 0}
      emptyText="Активных задач команды нет"
      onHead={() => setTab("task")}
      className={className}
    >
      {active.map((t) => (
        <DashTaskRow key={t.id} task={t} showAssignee />
      ))}
    </DashBlock>
  );
}
