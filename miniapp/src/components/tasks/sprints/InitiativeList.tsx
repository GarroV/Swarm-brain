"use client";
import { sprintRows } from "@/lib/sprintSubtasks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, SprintCycleItem, Task } from "@/types";
import { cn } from "@/lib/utils";
import type { DirectionNode, InitiativeNode } from "@/lib/initiatives";
import { isBareDirection } from "@/lib/initiatives";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { fmtDay } from "./format";
import { PILL_BTN } from "./atoms";
import {
  type RowDnd,
  type RowHandlers,
  SPRINT_COLS,
  SprintRow,
  SubtaskLiteRow,
  TASK_INDENT,
} from "./SprintRow";
import { resolveDrop, subtaskBlock } from "@/lib/sprintGrouping";
import { type DragView, type RowInfo, useRowDrag } from "./useRowDrag";
import type { GroupingProps } from "./useDragGroups";

/** Развёрнутые задачи с подзадачами — удобство одного зрителя, поэтому localStorage. */
const OPEN_KEY = "swarm.sprint.openSubtasks";

/** Перетаскивание в группе: строки как ручки и цели, заголовок как цель, кнопки группы спринта. */
type DndCtx = {
  rowDnd: (item: SprintCycleItem) => RowDnd | undefined;
  header: (projectId: string | null) => {
    bind: { "data-sg-header": string };
    over: boolean;
  };
  grouping: GroupingProps;
};

/** Подзадачи для строк группы: все видимые задачи, task_id состава, развёрнутость. */
type SubCtx = {
  tasks: Task[];
  sprintTaskIds: Set<string>;
  isOpen: (taskId: string) => boolean;
  toggle: (taskId: string) => void;
};

// Список спринта — главный экран доски инициатив: направление → инициатива → задачи.
// Он же второй вид того же состава, что канбан (TaskKanban): одна задача, одна правда,
// разный способ смотреть. Канбан отвечает на «что в работе», список — на «где мы по
// инициативам», и на кросс-командном проекте спрашивают именно второе.
//
// Вид — таблица стенда (screens-work.js → sprintByInitiative): общая шапка колонок, над
// группами подпись направления капсом, у инициативы одна строка-заголовок «имя · владелец ·
// X из Y» без рамки вокруг (рамка в рамке делала экран тесным).

/** Плюсик «добавить задачу» в шапке группы (владелец 07.10.2026: «небольшой плюсик … лаконично,
 *  спокойно, красиво»). Открывает СТАНДАРТНУЮ карточку задачи с уже проставленной группой
 *  (решение владельца 19.09.2026: «давай вызывать нашу стандартную менюшку»). На компьютере
 *  проявляется по наведению на шапку, на телефоне виден всегда. */
function AddTaskButton({ projectId, onAdd }: {
  projectId: string | null;
  onAdd: (projectId: string | null) => void;
}) {
  const dt = useDt();
  const label = dt("Добавить задачу", "Add a task");
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAdd(projectId);
      }}
      title={label}
      aria-label={label}
      className="ml-1 grid size-6 shrink-0 place-items-center self-center rounded-full text-ink-mute transition-[opacity,colors] hover:bg-surface-2 hover:text-ink lg:opacity-0 lg:group-hover/head:opacity-100 lg:focus-visible:opacity-100"
    >
      <RoyIcon name="plus" size={13} strokeWidth={2.2} />
    </button>
  );
}

/** Кнопки заголовка группы спринта (решение 01.10.2026): имя, «В проекты» — снять признак и
 *  показать группу на доске «Проекты», «Распустить» — задачи в родителя, группа в архив. На
 *  компьютере проявляются по наведению, на телефоне видны всегда — как хвост строки задачи. */
function GroupControls({ group, grouping }: {
  group: Project;
  grouping: GroupingProps;
}) {
  const dt = useDt();
  return (
    <span // У названия (владелец 05.10.2026: «настройки группы надо передвинуть к названию»). На
     // телефоне — своей строкой под названием: в одну строку кнопки уезжали за край экрана.
    className="order-last flex shrink-0 basis-full flex-wrap items-center gap-1.5 pb-2 pl-8 pr-2 transition-opacity lg:order-none lg:basis-auto lg:pb-0 lg:pl-0 lg:opacity-0 lg:group-hover/head:opacity-100 lg:focus-within:opacity-100">
      <button
        type="button"
        className={PILL_BTN}
        disabled={grouping.busy}
        onClick={() => grouping.onRename(group)}
      >
        {dt("Переименовать", "Rename")}
      </button>
      <button
        type="button"
        className={PILL_BTN}
        disabled={grouping.busy}
        onClick={() => grouping.onPromote(group)}
      >
        {dt("В проекты", "To projects")}
      </button>
      <button
        type="button"
        className={PILL_BTN}
        disabled={grouping.busy}
        onClick={() => grouping.onDissolve(group)}
      >
        {dt("Распустить", "Ungroup")}
      </button>
    </span>
  );
}

/** Строка, которую тащат, — карточкой у пальца или курсора. */
function DragGhost({ view }: { view: DragView }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[200] max-w-[280px] truncate rounded-[8px] border border-primary/60 bg-[var(--popover)] px-3 py-1.5 text-ink shadow-[0_12px_30px_-10px_rgba(0,0,0,.5)]"
      style={{ left: view.x + 14, top: view.y + 10, fontSize: 13 }}
    >
      {view.dragged.title}
    </div>,
    document.body,
  );
}

/** Группа: заголовок-строка и задачи под ним. Сворачивается — на кросс-командном проекте
 *  инициатив десятки, и развёрнутые разом они превращают экран в ленту без структуры. */
function Group(
  {
    node,
    name,
    sub,
    due,
    addTo,
    collapsed,
    onToggle,
    unchecked,
    showExtra,
    h,
    onAdd,
    subtasks: subCtx,
    dnd,
    dropTo,
    groupOf,
  }: {
    /** Направление, которое рисуется одной группой: для группы спринта без проекта. */
    groupOf?: Project | null;
    node: InitiativeNode;
    dnd?: DndCtx;
    /** Куда переносит бросок на заголовок; undefined — заголовок не цель (группировка по людям). */
    dropTo?: string | null;
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
    subtasks: SubCtx;
  },
) {
  const dt = useDt();
  const { done, total } = node.progress;
  const bad = node.items.filter((i) => i.check_status === "problem").length;
  const target = dnd && dropTo !== undefined ? dnd.header(dropTo) : null;
  // Группа без проекта — самостоятельное направление: её запись в `dir.project`, а не в узле.
  const own = groupOf ?? node.project;
  const sprintGroup = own?.sprint_group ? own : null;
  return (
    <div className="mb-2">
      <div
        {...target?.bind}
        className={cn(
          "group/head flex flex-wrap items-center border-b border-line rounded-t-[6px] transition-colors lg:flex-nowrap",
          target?.over &&
            "bg-primary/8 outline outline-2 -outline-offset-2 outline-primary/70",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-baseline gap-2.5 px-3 pb-1.5 pt-2 text-left"
        >
          <RoyIcon
            name="cright"
            size={10}
            strokeWidth={2.4}
            className={cn(
              "shrink-0 self-center text-ink-mute transition-transform",
              !collapsed && "rotate-90",
            )}
          />
          <span className="flex min-w-0 items-baseline gap-2">
            {node.project?.emoji && <span>{node.project.emoji}</span>}
            <span
              className="min-w-0 truncate font-semibold text-ink"
              style={{ fontSize: 13.5 }}
            >
              {name}
            </span>
            {sub && (
              <span
                className="shrink-0 truncate text-ink-mute"
                style={{ fontSize: 12 }}
              >
                {sub}
              </span>
            )}
            {due && (
              <span className="shrink-0 text-ink-mute" style={{ fontSize: 12 }}>
                · {dt("до", "due")} {fmtDay(due)}
              </span>
            )}
          </span>
        </button>
        {onAdd && (
          <AddTaskButton
            projectId={addTo !== undefined ? addTo : node.project?.id ?? null}
            onAdd={onAdd}
          />
        )}
        {sprintGroup && dnd && (
          <GroupControls group={sprintGroup} grouping={dnd.grouping} />
        )}
        {/* Пустое место и счётчик тоже сворачивают группу — как раньше вся строка. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-baseline justify-end gap-2.5 self-stretch px-3 pb-1.5 pt-2"
        >
          {bad > 0 && (
            <span
              className="shrink-0 font-semibold text-pri-high"
              style={{ fontSize: 12 }}
            >
              {dt(`проблема: ${bad}`, `problem: ${bad}`)}
            </span>
          )}
          <span
            className={cn(
              "shrink-0 font-mono",
              total > 0 && done === total
                ? "text-status-done"
                : "text-ink-mute",
            )}
            style={{ fontSize: 12 }}
          >
            {dt(`${done} из ${total}`, `${done} of ${total}`)}
          </span>
        </button>
      </div>
      {!collapsed && (
        <div>
          {node.items.length === 0 && (
            <div
              className="px-3 py-2 text-ink-mute"
              style={{ paddingLeft: TASK_INDENT + 20, fontSize: 12.5 }}
            >
              {dt(
                "Пусто — перетащите сюда задачи",
                "Empty — drag tasks here",
              )}
            </div>
          )}
          {sprintRows(node.items, {
            idOf: (i) => i.task_id,
            parentOf: (i) => h.parentOf?.(i) ?? null,
            tasks: subCtx.tasks,
            sprintTaskIds: subCtx.sprintTaskIds,
            isOpen: subCtx.isOpen,
          }).map((row) =>
            row.kind === "task"
              ? (
                <SubtaskLiteRow
                  key={`t-${row.task.id}`}
                  task={row.task}
                  inSprint={row.inSprint}
                  onOpen={h.onOpenTask}
                />
              )
              : (
                <SprintRow
                  key={row.item.id}
                  dnd={dnd?.rowDnd(row.item)}
                  item={row.item}
                  depth={row.depth}
                  unchecked={unchecked}
                  showExtra={showExtra}
                  h={h}
                  parent={row.parent}
                  kids={row.kids
                    ? {
                      done: row.kids.done,
                      total: row.kids.total,
                      open: subCtx.isOpen(row.kids.taskId),
                      onToggle: () => subCtx.toggle(row.kids!.taskId),
                    }
                    : undefined}
                />
              )
          )}
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
  tasks = [],
  grouping,
  ...h
}: {
  board: DirectionNode[];
  /** Есть — строки перетаскиваются: на задачу — группа (подержать — подзадача), на заголовок —
   *  перенос. Нет — список не тащится (принятый спринт, группировка по людям). */
  grouping?: GroupingProps;
  /** Все видимые задачи — из них подзадачи строк (#478); отдельного запроса нет. */
  tasks?: Task[];
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
  const ownerName = (id: number) =>
    users.find((u) => u.telegram_id === id)?.name ?? String(id);

  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [openKids, setOpenKids] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) setOpenKids(new Set(JSON.parse(raw) as string[]));
    } catch { /* нет хранилища — просто всё свёрнуто */ }
  }, []);
  const toggleKids = useCallback((taskId: string) => {
    setOpenKids((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch { /* не запомнили — не беда */ }
      return next;
    });
  }, []);
  // Бросок «подзадачей» раскрывает родителя: новая подзадача должна оказаться на виду там, где
  // её показал силуэт, а не спрятаться под свёрнутым шевроном.
  const openKid = useCallback((taskId: string) => {
    setOpenKids((prev) => {
      if (prev.has(taskId)) return prev;
      const next = new Set(prev).add(taskId);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch { /* не запомнили — не беда */ }
      return next;
    });
  }, []);
  const sprintTaskIds = useMemo(() => {
    const ids = new Set<string>();
    const add = (items: SprintCycleItem[]) =>
      items.forEach((i) => i.task_id && ids.add(i.task_id));
    board.forEach((d) => d.initiatives.forEach((ini) => add(ini.items)));
    return ids;
  }, [board]);
  const sub: SubCtx = useMemo(
    () => ({
      tasks,
      sprintTaskIds,
      isOpen: (id: string) => openKids.has(id),
      toggle: toggleKids,
    }),
    [tasks, sprintTaskIds, openKids, toggleKids],
  );

  // Строки, которые можно тащить и на которые можно бросать: живые задачи состава.
  const rows = useMemo(() => {
    const kids = new Set(tasks.map((t) => t.parent_id).filter(Boolean));
    const map = new Map<string, RowInfo>();
    board.forEach((d) =>
      d.initiatives.forEach((ini) =>
        ini.items.forEach((i) => {
          if (!i.task_id || i.removed || i.hidden) return;
          const parentId = h.parentOf?.(i) ?? null;
          map.set(i.task_id, {
            taskId: i.task_id,
            projectId: i.project_id ?? null,
            parentId,
            isSubtask: parentId !== null,
            hasKids: kids.has(i.task_id),
            title: i.title,
          });
        })
      )
    );
    return map;
  }, [board, tasks, h]);
  const drag = useRowDrag({
    enabled: !!grouping && !grouping.busy,
    rows,
    onDrop: (dragged, target, mode) => {
      if (!grouping) return;
      const action = resolveDrop(dragged, target, mode, grouping.projects);
      if (action.kind === "subtask") openKid(action.parentTaskId);
      grouping.onDrop(dragged, target, mode);
    },
  });
  const view = drag.view;

  const dnd: DndCtx | undefined = grouping && {
    grouping,
    rowDnd: (item) => {
      const id = item.task_id;
      const row = id ? rows.get(id) : undefined;
      if (!id || !row) return undefined;
      let state: RowDnd["state"] = null;
      if (view?.dragged.taskId === id) state = { kind: "source" };
      else if (view && view.targetKey === `task:${id}`) {
        const target = {
          kind: "task" as const,
          taskId: id,
          projectId: row.projectId,
          isSubtask: row.isSubtask,
        };
        if (view.mode === "subtask") {
          state = {
            kind: "subtask",
            title: view.dragged.title,
            block: subtaskBlock(view.dragged, target),
          };
        } else {
          const action = resolveDrop(
            view.dragged,
            target,
            "group",
            grouping.projects,
          );
          // Цель уже в группе — бросок не собирает новую, а добавляет к ней: подпись говорит,
          // к какой, чтобы «Сгруппировать» не обещало окно названия, которого не будет.
          if (action.kind === "create") state = { kind: "group", join: null };
          else if (action.kind === "move") {
            state = {
              kind: "group",
              join: grouping.projects.find((p) =>
                p.id === action.projectId
              )?.name ?? "",
            };
          }
        }
      }
      return {
        bind: drag.rowProps(id),
        state,
        onMenu: () => grouping.onMenu(row, [...rows.values()]),
      };
    },
    header: (projectId) => {
      const bind = drag.headerProps(projectId);
      const over = !!view &&
        view.targetKey === `header:${bind["data-sg-header"]}` &&
        resolveDrop(
            view.dragged,
            { kind: "header", projectId },
            "group",
            grouping.projects,
          ).kind !== "none";
      return { bind, over };
    },
  };

  const common = { unchecked, showExtra, h, onAdd, subtasks: sub, dnd };

  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <div
        role="row"
        // px-1 — тот же отступ, что у строк ниже: без него шапка шире строк, и столбцы
        // разъезжались (владелец 05.10.2026: «шапка не бьётся со столбами»).
        className="sticky top-0 z-10 grid items-center rounded-t-[10px] border-b border-line bg-surface-2 px-1 font-semibold uppercase text-ink-mute"
        style={{
          gridTemplateColumns: SPRINT_COLS,
          height: 32,
          fontSize: 10.5,
          letterSpacing: "0.08em",
        }}
      >
        <span className="px-3" style={{ paddingLeft: TASK_INDENT + 20 }}>
          {dt("Задача", "Task")}
        </span>
        <span className="px-2">{dt("Срок", "Due")}</span>
        <span className="px-2">{dt("Рынок", "Market")}</span>
        <span className="px-2">{dt("Сверка", "Check")}</span>
        <span className="px-2">{dt("Исполнитель", "Assignee")}</span>
        <span />
      </div>
      {view && <DragGhost view={view} />}
      <div className="px-1 pb-2">
        {board.map((dir) => {
          const dirName = dir.project?.name ?? noneLabel ??
            dt("Без направления", "No direction");
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
                dropTo={dir.project?.id ?? null}
                groupOf={dir.project ?? null}
                collapsed={closed.has(dirKey)}
                onToggle={() => toggle(dirKey)}
                {...common}
              />
            );
          }
          return (
            <section key={dirKey}>
              <div
                {...dnd?.header(dir.project?.id ?? null).bind}
                className={cn(
                  "rounded-[6px] px-3 pb-1 pt-4 font-semibold uppercase text-ink-mute",
                  dnd?.header(dir.project?.id ?? null).over &&
                    "bg-primary/8 text-primary",
                )}
                style={{ fontSize: 10.5, letterSpacing: "0.1em" }}
              >
                {dir.project?.emoji ? `${dir.project.emoji} ` : ""}
                {dirName}
              </div>
              {dir.initiatives.map((ini) => {
                const key = `${dirKey}/${ini.project?.id ?? ""}`;
                const owner = ini.project?.owner_telegram_id
                  ? ownerName(ini.project.owner_telegram_id)
                  : null;
                return (
                  <Group
                    key={key}
                    node={ini}
                    name={ini.project?.name ?? dt("Общее", "General")}
                    sub={owner}
                    due={ini.project?.end_date ?? null}
                    dropTo={ini.project?.id ?? dir.project?.id ?? null}
                    collapsed={closed.has(key)}
                    onToggle={() => toggle(key)}
                    {...common}
                  />
                );
              })}
            </section>
          );
        })}
        {
          /* «Без направления» пуст — его заголовка на экране нет, и вынуть задачу из группы
            было бы некуда. Пока тащат, на его месте зона броска. */
        }
        {view && dnd && !board.some((d) => !d.project) && (
          <div
            {...dnd.header(null).bind}
            className={cn(
              "mx-2 mt-3 rounded-[8px] border border-dashed border-line px-3 py-2.5 text-center text-ink-mute transition-colors",
              dnd.header(null).over &&
                "border-primary/70 bg-primary/8 text-primary",
            )}
            style={{ fontSize: 12.5 }}
          >
            {noneLabel ?? dt("Без направления", "No direction")}
          </div>
        )}
      </div>
    </div>
  );
}

/** Скелет загрузки: пустой экран и «задач нет» обязаны выглядеть по-разному. */
export function BoardSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border border-line bg-surface/40"
        />
      ))}
    </div>
  );
}
