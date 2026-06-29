"use client";
import { useRoyNav } from "../nav";
import { DashBlock, SubHead, DashTaskRow } from "./shared";
import type { DashboardData } from "./useDashboardData";

// Левая колонка главного экрана: личные задачи текущего пользователя, сгруппированные
// по сроку — «Сегодня» (просрочено + сегодня), «На неделе», и счётчик «N без срока».
// Шапка → вкладка «Задачи» (доска). Источник: groupMine(splitByOwner().mine).
// Строки рисуются общим `DashTaskRow` (= тот же `TaskRow`, что и на доске) — единый вид.

export function PersonalTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { setTab } = useRoyNav();
  const { loading, today, week, noDate } = data;
  const empty = today.length === 0 && week.length === 0 && noDate.length === 0;

  return (
    <DashBlock
      title="Мои задачи"
      icon="task"
      tint="var(--accent-ink)"
      headAction="Доска"
      loading={loading}
      empty={empty}
      emptyText="Личных задач нет"
      onHead={() => setTab("task")}
      className={className}
    >
      {today.length > 0 && (
        <>
          <SubHead count={today.length}>Сегодня</SubHead>
          {today.map((t) => <DashTaskRow key={t.id} task={t} />)}
        </>
      )}
      {week.length > 0 && (
        <>
          <SubHead count={week.length}>На неделе</SubHead>
          {week.map((t) => <DashTaskRow key={t.id} task={t} />)}
        </>
      )}
      {noDate.length > 0 && (
        <button
          type="button"
          onClick={() => setTab("task")}
          className="mt-2 block w-full rounded-[10px] py-2 text-center font-medium text-ink-mute transition-colors hover:bg-surface-2"
          style={{ fontSize: 12 }}
        >
          + {noDate.length} без срока
        </button>
      )}
    </DashBlock>
  );
}
