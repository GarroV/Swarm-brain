"use client";
import { useRoyNav, useDt } from "../nav";
import { DashBlock, DashTaskRow, norm } from "./shared";
import type { DashboardData } from "./useDashboardData";

// Право-низ главного экрана: ОБЩИЕ задачи команды — не приватные и без конкретного исполнителя
// (линза «team», то же правило, что на доске: `matchesLens` в lib/smartLists.ts). Личные задачи
// коллег сюда НЕ попадают — они их личное дело, не «команда» (владелец, 2026-08-20).
// Тот же `DashTaskRow` (= `TaskRow`), что и на доске/в «Моих» — единый вид; исполнитель
// показывается аватаром (showAssignee). Шапка → вкладка «Задачи» (доска).
// Источник: splitByLens().team. Показываем только незавершённые — то, что в работе.

export function TeamTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { openTasks } = useRoyNav();
  const dt = useDt();
  const { tasksState, team } = data;
  // Активные задачи команды: незавершённые требуют внимания.
  const active = team.filter((t) => norm(t.status) !== "done");

  return (
    <DashBlock
      title={dt("Задачи команды", "Team tasks")}
      icon="team"
      tint="var(--tag-link)"
      headAction={dt("Доска", "Board")}
      loading={tasksState.loading}
      failed={tasksState.failed}
      onRetry={tasksState.retry}
      errorText={dt("Не загрузилось", "Failed to load")}
      retryText={dt("Повторить", "Retry")}
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
