"use client";
import { useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { Market, PriDot } from "../ui";
import { DashBlock, Row, SubHead, StatusPill, fmtDate, norm } from "./shared";
import type { DashboardData } from "./useDashboardData";
import type { Task } from "@/types";

// Левая колонка главного экрана: личные задачи текущего пользователя, сгруппированные
// по сроку — «Сегодня» (просрочено + сегодня), «На неделе», и счётчик «N без срока».
// Шапка → вкладка «Задачи» (доска). Источник: groupMine(splitByOwner().mine).

const pri = (t: Task) => (t.priority as "high" | "med" | "low" | null) ?? null;

function TaskItem({ t, onOpen }: { t: Task; onOpen: () => void }) {
  return (
    <Row onClick={onOpen}>
      <PriDot pri={pri(t)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-ink" style={{ fontSize: 14, letterSpacing: "-0.01em" }}>
          {t.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <StatusPill status={norm(t.status)} />
          <Market code={t.country} />
          {fmtDate(t.due_date) && (
            <span className="inline-flex items-center gap-1 text-ink-mute" style={{ fontSize: 11.5 }}>
              <RoyIcon name="cal" size={11} />
              {fmtDate(t.due_date)}
            </span>
          )}
        </div>
      </div>
    </Row>
  );
}

export function PersonalTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { push, setTab } = useRoyNav();
  const { loading, today, week, noDate } = data;
  const empty = today.length === 0 && week.length === 0 && noDate.length === 0;
  const open = (id: string) => push({ view: "taskDetail", params: { id } });

  return (
    <DashBlock
      title="Мои задачи"
      icon="task"
      tint="var(--status-open)"
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
          {today.map((t) => <TaskItem key={t.id} t={t} onOpen={() => open(t.id)} />)}
        </>
      )}
      {week.length > 0 && (
        <>
          <SubHead count={week.length}>На неделе</SubHead>
          {week.map((t) => <TaskItem key={t.id} t={t} onOpen={() => open(t.id)} />)}
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
