"use client";
import { useState } from "react";
import { useRoyNav, useDt } from "../nav";
import { DashBlock, SubHead, DashTaskRow, norm } from "./shared";
import { TaskModal } from "@/components/TaskModal";
import type { DashboardData } from "./useDashboardData";

// Левая колонка главного экрана: личные задачи текущего пользователя.
// КАСКАД «не держать пустой блок»: показываем первый непустой ярус — текущие (Сегодня/просрочено)
// → если нет, ближайшие (в пределах недели) → если нет, ВСЕ мои (включая без срока). Так блок
// всегда показывает задачи, а не пустоту с одним счётчиком. «+ ещё N» ведёт на доску.
// Строки рисуются общим `DashTaskRow` (= тот же `TaskRow`, что и на доске) — единый вид.

export function PersonalTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { openTasks, bumpTasks } = useRoyNav();
  const dt = useDt();
  const [creating, setCreating] = useState(false);
  const { tasksState, today, week, mine } = data;

  // Только активные — завершённые на дашборде не показываем (для них есть список «Готовые»).
  const active = (ts: typeof mine) => ts.filter((t) => norm(t.status) !== "done");
  const aToday = active(today);
  const aWeek = active(week);
  const aMine = active(mine);

  const tier =
    aToday.length > 0 ? { label: dt("Сегодня", "Today"), tasks: aToday } :
    aWeek.length > 0 ? { label: dt("Ближайшие", "Upcoming"), tasks: aWeek } :
    { label: dt("Все", "All"), tasks: aMine };
  const moreCount = aMine.length - tier.tasks.length; // не вошедшие в показанный ярус
  const empty = aMine.length === 0;

  return (
    <>
      <DashBlock
        title={dt("Мои задачи", "My tasks")}
        icon="task"
        tint="var(--accent-ink)"
        headAction={dt("Доска", "Board")}
        loading={tasksState.loading}
        failed={tasksState.failed}
        onRetry={tasksState.retry}
        errorText={dt("Не загрузилось", "Failed to load")}
        retryText={dt("Повторить", "Retry")}
        empty={empty}
        emptyText={dt("Личных задач нет", "No personal tasks")}
        onHead={() => openTasks("mine", "today")}
        onAdd={() => setCreating(true)}
        addLabel={dt("Новая задача", "New task")}
        className={className}
      >
        <SubHead count={tier.tasks.length}>{tier.label}</SubHead>
        {tier.tasks.map((t) => <DashTaskRow key={t.id} task={t} />)}
        {moreCount > 0 && (
          <button
            type="button"
            onClick={() => openTasks("mine", "all")}
            className="mt-2 block w-full rounded-[10px] py-2 text-center font-medium text-ink-mute transition-colors hover:bg-surface-2"
            style={{ fontSize: 12 }}
          >
            {dt("+ ещё", "+ more")} {moreCount}
          </button>
        )}
      </DashBlock>
      {/* Быстрое создание задачи прямо с дашборда — модал-оверлей, без ухода на доску.
          onSaved → bumpTasks: карточка «Мои задачи» перезапросит список и покажет новую. */}
      <TaskModal open={creating} onClose={() => setCreating(false)} onSaved={bumpTasks} />
    </>
  );
}
