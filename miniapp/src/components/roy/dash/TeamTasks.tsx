"use client";
import { useRoyNav } from "../nav";
import { Avatar, Market } from "../ui";
import { DashBlock, Row, StatusPill, initials, norm } from "./shared";
import type { DashboardData } from "./useDashboardData";
import type { Task } from "@/types";

// Право-низ главного экрана: задачи команды (assignee ≠ текущий пользователь).
// Строка: аватар исполнителя, заголовок, статус-пилюля. Шапка → вкладка «Задачи» (доска).
// Источник: splitByOwner().team. Показываем только незавершённые — то, что в работе.

function TeamRow({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const assignee = t.assignees?.[0];
  return (
    <Row onClick={onOpen}>
      {assignee ? (
        <Avatar size={26}>{initials(assignee)}</Avatar>
      ) : (
        <span className="inline-block shrink-0 rounded-full bg-surface-2" style={{ width: 26, height: 26 }} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-ink" style={{ fontSize: 13.5, letterSpacing: "-0.01em" }}>
          {t.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <StatusPill status={norm(t.status)} />
          <Market code={t.country} />
        </div>
      </div>
    </Row>
  );
}

export function TeamTasks({ data, className }: { data: DashboardData; className?: string }) {
  const { push, setTab } = useRoyNav();
  const { loading, team } = data;
  // Активные задачи команды: незавершённые требуют внимания.
  const active = team.filter((t) => norm(t.status) !== "done");

  return (
    <DashBlock
      title="Задачи команды"
      icon="team"
      tint="var(--status-prog)"
      headAction="Доска"
      loading={loading}
      empty={active.length === 0}
      emptyText="Активных задач команды нет"
      onHead={() => setTab("task")}
      className={className}
    >
      {active.map((t) => (
        <TeamRow key={t.id} t={t} onOpen={() => push({ view: "taskDetail", params: { id: t.id } })} />
      ))}
    </DashBlock>
  );
}
