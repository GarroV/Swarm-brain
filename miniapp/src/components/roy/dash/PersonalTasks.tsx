"use client";
import { useState } from "react";
import { useRoyNav, useDt } from "../nav";
import { DashBlock, SubHead, DashTaskRow, norm } from "./shared";
import { TaskModal } from "@/components/TaskModal";
import type { DashboardData } from "./useDashboardData";

// Левая колонка главного экрана (верхняя половина): личные задачи ТЕКУЩЕГО дня.
//
// Раньше здесь работал КАСКАД «не держать пустой блок»: сегодня → если пусто, неделя → если
// пусто, все мои. Каскад СНЯТ по решению владельца 03.09.2026 (issue #217: «задачи сокращаем
// список в половину, и при этом показываем там только то что сегодня») — блок показывает
// ровно один ярус, «Сегодня», и при пустом дне честно говорит, что на сегодня задач нет,
// вместо подмены ярусом «Ближайшие», о которой человек не просил.
//
// Просроченное остаётся здесь же: ярус «Сегодня» = срок ≤ сегодня (groupMine), прятать
// просрочку нельзя — она и есть то, что требует внимания в первую очередь.
// «+ ещё N» ведёт на доску: остальные задачи не должны исчезнуть с главной.
// Строки рисуются общим `DashTaskRow` (= тот же `TaskRow`, что и на доске) — единый вид.

export function PersonalTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { openTasks, bumpTasks } = useRoyNav();
  const dt = useDt();
  const [creating, setCreating] = useState(false);
  const { tasksState, today, week, mine } = data;

  // Только активные — завершённые на дашборде не показываем (для них есть список «Готовые»).
  const active = (ts: typeof mine) => ts.filter((t) => norm(t.status) !== "done");
  const aToday = active(today);
  const aMine = active(mine);

  const tier = { label: dt("Сегодня", "Today"), tasks: aToday };
  // «+ ещё N» считаем от ВСЕХ моих активных: на сегодня пусто, но 110 задач в работе — это
  // не «пусто», и ссылка на доску обязана остаться.
  const moreCount = aMine.length - aToday.length;
  const empty = aMine.length === 0;
  const emptyDay = aToday.length === 0 && aMine.length > 0;

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
        {emptyDay && (
          <div className="py-6 text-center text-ink-soft" style={{ fontSize: 12.5 }}>
            {dt("На сегодня задач нет", "Nothing due today")}
          </div>
        )}
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
