"use client";
import { nestBy } from "@/lib/subtasks";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DirectionNode, InitiativeNode } from "@/lib/initiatives";
import { isBareDirection } from "@/lib/initiatives";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { fmtDay } from "./format";
import { type RowHandlers, SPRINT_COLS, SprintRow } from "./SprintRow";

// Список спринта — главный экран доски инициатив: направление → инициатива → задачи.
// Он же второй вид того же состава, что канбан (TaskKanban): одна задача, одна правда,
// разный способ смотреть. Канбан отвечает на «что в работе», список — на «где мы по
// инициативам», и на кросс-командном проекте спрашивают именно второе.
//
// Вид — таблица стенда (screens-work.js → sprintByInitiative): общая шапка колонок, над
// группами подпись направления капсом, у инициативы одна строка-заголовок «имя · владелец ·
// X из Y» без рамки вокруг (рамка в рамке делала экран тесным).

/** Строка «+ задача» внутри инициативы. Открывает СТАНДАРТНУЮ карточку задачи с уже
 *  проставленной инициативой (решение владельца 19.09.2026: «при добавлении давай вызывать
 *  нашу стандартную менюшку добавления задачи»). */
function AddTaskRow({ projectId, onAdd }: {
  projectId: string | null;
  onAdd: (projectId: string | null) => void;
}) {
  const dt = useDt();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAdd(projectId);
      }}
      className="w-full border-t border-line px-3 py-1.5 pl-[27px] text-left font-medium text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
      style={{ fontSize: 12.5 }}
    >
      {dt("+ задача", "+ task")}
    </button>
  );
}

/** Группа: заголовок-строка и задачи под ним. Сворачивается — на кросс-командном проекте
 *  инициатив десятки, и развёрнутые разом они превращают экран в ленту без структуры. */
function Group({ node, name, sub, due, addTo, collapsed, onToggle, unchecked, showExtra, h, onAdd }: {
  node: InitiativeNode;
  name: string;
  sub?: string | null;
  due?: string | null;
  /** Куда класть «+ задачу». У направления без инициатив — в само направление. */
  addTo?: string | null;
  collapsed: boolean;
  onToggle: () => void;
  unchecked: boolean;
  showExtra: boolean;
  h: RowHandlers;
  onAdd?: (projectId: string | null) => void;
}) {
  const dt = useDt();
  const { done, total } = node.progress;
  const bad = node.items.filter((i) => i.check_status === "problem").length;
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-baseline gap-2.5 border-b border-line px-3 pb-1.5 pt-2 text-left"
      >
        <RoyIcon
          name="cright"
          size={10}
          strokeWidth={2.4}
          className={cn("shrink-0 self-center text-ink-mute transition-transform", !collapsed && "rotate-90")}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          {node.project?.emoji && <span>{node.project.emoji}</span>}
          <span className="min-w-0 truncate font-semibold text-ink" style={{ fontSize: 13.5 }}>{name}</span>
          {sub && <span className="shrink-0 truncate text-ink-mute" style={{ fontSize: 12 }}>{sub}</span>}
          {due && (
            <span className="shrink-0 text-ink-mute" style={{ fontSize: 12 }}>
              · {dt("до", "due")} {fmtDay(due)}
            </span>
          )}
        </span>
        {bad > 0 && (
          <span className="shrink-0 font-semibold text-pri-high" style={{ fontSize: 12 }}>
            {dt(`проблема: ${bad}`, `problem: ${bad}`)}
          </span>
        )}
        <span
          className={cn("shrink-0 font-mono", total > 0 && done === total ? "text-status-done" : "text-ink-mute")}
          style={{ fontSize: 12 }}
        >
          {dt(`${done} из ${total}`, `${done} of ${total}`)}
        </span>
      </button>
      {!collapsed && (
        <div>
          {nestBy(node.items, (i) => i.task_id, (i) => h.parentOf?.(i) ?? null).map(({ item, depth }) => (
            <SprintRow key={item.id} item={item} depth={depth} unchecked={unchecked} showExtra={showExtra} h={h} />
          ))}
          {onAdd && <AddTaskRow projectId={addTo !== undefined ? addTo : node.project?.id ?? null} onAdd={onAdd} />}
        </div>
      )}
    </div>
  );
}

/**
 * Доска: направления сверху, внутри инициативы, внутри задачи.
 *
 * `unchecked` приходит снаружи, а не считается здесь: «с дня сверки» знает экран спринта,
 * а строка задачи не должна знать про календарь ритуала.
 */
export function InitiativeList({
  board,
  unchecked = false,
  showExtra = false,
  users = [],
  noneLabel,
  onAdd,
  ...h
}: {
  board: DirectionNode[];
  /** Подпись группы-остатка. По умолчанию «Без направления»; при группировке по людям —
   *  «Без исполнителя»: остаток называется по тому, чего в нём нет. */
  noneLabel?: string;
  unchecked?: boolean;
  showExtra?: boolean;
  users?: { telegram_id: number; name: string }[];
  /** Есть — внутри каждой инициативы появляется строка «+ задача». Нет — доска только читается
   *  (принятый спринт, чужое пространство). */
  onAdd?: (projectId: string | null) => void;
} & RowHandlers) {
  const dt = useDt();
  const [closed, setClosed] = useState<Set<string>>(new Set());

  // Ответственный инициативы хранится telegram_id — показываем человека, а не число.
  const ownerName = (id: number) => users.find((u) => u.telegram_id === id)?.name ?? String(id);

  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const common = { unchecked, showExtra, h, onAdd };

  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <div
        role="row"
        className="sticky top-0 z-10 grid items-center rounded-t-[10px] border-b border-line bg-surface-2 font-semibold uppercase text-ink-mute"
        style={{ gridTemplateColumns: SPRINT_COLS, height: 32, fontSize: 10.5, letterSpacing: "0.08em" }}
      >
        <span className="px-3 pl-[27px]">{dt("Задача", "Task")}</span>
        <span className="px-2">{dt("Срок", "Due")}</span>
        <span className="px-2">{dt("Рынок", "Market")}</span>
        <span className="px-2">{dt("Сверка", "Check")}</span>
        <span className="px-2">{dt("Исполнитель", "Assignee")}</span>
        <span />
      </div>
      <div className="px-1 pb-2">
        {board.map((dir) => {
          const dirName = dir.project?.name ?? noneLabel ?? dt("Без направления", "No direction");
          const dirKey = dir.project?.id ?? "__none__";
          // Направление без инициатив (и каждый человек при группировке по людям) —
          // сразу группа: подпись капсом над одной группой с тем же именем была бы эхом.
          if (isBareDirection(dir)) {
            return (
              <Group
                key={dirKey}
                node={dir.initiatives[0]}
                name={dirName}
                addTo={dir.project?.id ?? null}
                collapsed={closed.has(dirKey)}
                onToggle={() => toggle(dirKey)}
                {...common}
              />
            );
          }
          return (
            <section key={dirKey}>
              <div
                className="px-3 pb-1 pt-4 font-semibold uppercase text-ink-mute"
                style={{ fontSize: 10.5, letterSpacing: "0.1em" }}
              >
                {dir.project?.emoji ? `${dir.project.emoji} ` : ""}
                {dirName}
              </div>
              {dir.initiatives.map((ini) => {
                const key = `${dirKey}/${ini.project?.id ?? ""}`;
                const owner = ini.project?.owner_telegram_id ? ownerName(ini.project.owner_telegram_id) : null;
                return (
                  <Group
                    key={key}
                    node={ini}
                    name={ini.project?.name ?? dt("Общее", "General")}
                    sub={owner}
                    due={ini.project?.end_date ?? null}
                    collapsed={closed.has(key)}
                    onToggle={() => toggle(key)}
                    {...common}
                  />
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Скелет загрузки: пустой экран и «задач нет» обязаны выглядеть по-разному. */
export function BoardSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl border border-line bg-surface/40" />
      ))}
    </div>
  );
}

