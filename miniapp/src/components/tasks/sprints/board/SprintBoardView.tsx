"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BoardPlanTask,
  Project,
  SprintBoardData,
  SprintCycle,
  SprintCycleItem,
  Task,
  User,
} from "@/types";
import {
  addTasksToSprintCycle,
  createSprintCycle,
  fetchSprintBoard,
  patchSprintCycleItem,
  removeTaskFromSprintCycle,
  updateTask,
} from "@/lib/api";
import type { ResolvedDrop } from "@/lib/sprintGrouping";
import { useDt } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import { cn } from "@/lib/utils";
import { ReasonDialog } from "../ReasonDialog";
import { useStoredFlag } from "../useStoredFlag";
import { useDragGroups } from "../useDragGroups";
import type { RowInfo } from "../useRowDrag";
import { useTaskDialogs } from "../useTaskDialogs";
import { shiftBetweenDrafts } from "../shiftTask";
import { BoardFilters } from "./BoardFilters";
import { SprintColumn } from "./BoardColumn";
import type { BoardCtx } from "./boardCtx";
import { useBoardDnd } from "./useBoardDnd";
import {
  type BoardFilter,
  isClosedStatus,
  itemNeedsAttention,
  namesOf,
  nextCycleDraft,
  NO_FILTER,
  planTaskNeedsAttention,
  snapshotNeedsReason,
} from "./boardModel";
import { HistoryDialog } from "./HistoryDialog";
import { MasterPlanColumn } from "./MasterPlanColumn";
import type { TaskMenuActions } from "./TaskMenu";

// Вид «Доска спринтов» (решение владельца 22.10.2026, docs/decisions/2026-10-22-sprint-board-direction.md):
// слева закреплённый мастер-план со всеми задачами пространства, справа спринты слева направо —
// прошлые полосками, идущий, запланированные и «+ Спринт». Данные — одним запросом
// GET /sprint-cycles/board. Действия — те же, что в «Списке»: перенос из идущего (окно с причиной),
// «взять в спринт», сверка, снятие; перетаскивание повторяет пункты меню «⋯». Принятые спринты в
// ряду колонок не показываются (владелец 22.10.2026) — вход к ним «История спринтов». Подзадачи
// лесенкой и связывание перетаскиванием — п.15 решения, жест в `useBoardDnd.tsx`.

/** «Отменить» после связывания, отвязки и перехода в группу: плашка внизу на шесть секунд. */
type Undo = { message: string; restore: () => Promise<void> };
const UNDO_MS = 6000;
type ReasonFor = { item: SprintCycleItem; cycleId: string };

const todayIso = () => new Date().toISOString().slice(0, 10);

function NewSprint({ cycles, space, busy, onCreate }: {
  cycles: readonly SprintCycle[];
  space: string | null;
  busy: boolean;
  onCreate: (
    input: {
      name: string;
      start_date: string;
      end_date: string;
      tab_id: string | null;
    },
  ) => void;
}) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" });
  const draft = () => nextCycleDraft(cycles, todayIso());
  const submit = () => {
    if (!form.name.trim() || !form.start_date || !form.end_date) return;
    onCreate({ ...form, name: form.name.trim(), tab_id: space });
    setOpen(false);
  };
  const input =
    "h-[30px] rounded-[7px] border border-line bg-surface px-2 text-ink outline-none focus:border-accent-line";
  return (
    <section
      className="flex h-full shrink-0 snap-start flex-col pr-4"
      aria-label={dt("Новый спринт", "New sprint")}
    >
      {open
        ? (
          <div
            className="flex w-[calc(100vw-3.5rem)] flex-col gap-2 rounded-[12px] border border-line bg-surface-2 p-3 sm:w-[250px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <span className="font-semibold text-ink" style={{ fontSize: 13 }}>
              {dt("Новый спринт", "New sprint")}
            </span>
            <input
              autoFocus
              aria-label={dt("Название спринта", "Sprint name")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={input}
              style={{ fontSize: 12.5 }}
            />
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label={dt("Начало", "Start")}
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })}
                className={cn(input, "min-w-0 flex-1")}
                style={{ fontSize: 12 }}
              />
              <input
                type="date"
                aria-label={dt("Конец", "End")}
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className={cn(input, "min-w-0 flex-1")}
                style={{ fontSize: 12 }}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={busy || !form.name.trim() || !form.start_date ||
                  !form.end_date}
                className="h-[30px] rounded-full bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-50"
                style={{ fontSize: 12.5 }}
              >
                {dt("Создать", "Create")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2 text-ink-soft hover:text-ink"
                style={{ fontSize: 12.5 }}
              >
                {dt("Отмена", "Cancel")}
              </button>
            </div>
          </div>
        )
        : (
          <button
            type="button"
            onClick={() => {
              setForm(draft());
              setOpen(true);
            }}
            className="w-[calc(100vw-3.5rem)] rounded-[12px] border border-dashed border-line-2 px-3 py-3 text-ink-mute transition-colors hover:border-accent-line hover:text-ink sm:w-[160px]"
            style={{ fontSize: 13 }}
          >
            {dt("+ Спринт", "+ Sprint")}
          </button>
        )}
    </section>
  );
}

export function SprintBoardView(
  {
    space,
    users,
    reloadKey,
    canDrag,
    onOpenTask,
    onAddTask,
    onCloseSprint,
    onChanged,
  }: {
    space: string | null;
    users: readonly User[];
    /** Растёт, когда экран поменял данные мимо доски (карточка задачи, приёмка). */
    reloadKey: number;
    canDrag: boolean;
    onOpenTask: (taskId: string) => void;
    /** Завести задачу стандартной карточкой; `cycleId` — спринт, в который она попадёт, без него — только в план. */
    onAddTask: (groupId: string | null, cycleId?: string) => void;
    onCloseSprint: (cycleId: string) => void;
    /** Доска что-то изменила: остальной экран перечитывает свои данные. */
    onChanged: () => void;
  },
) {
  const dt = useDt();
  const [data, setData] = useState<SprintBoardData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<BoardFilter>(NO_FILTER);
  const [hideDone, setHideDone] = useStoredFlag(
    "swarm.sprints.planHideDone",
    false,
  );
  const [reasonFor, setReasonFor] = useState<ReasonFor | null>(null);
  const [history, setHistory] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await fetchSprintBoard(space));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(
        e instanceof Error
          ? e.message
          : dt("Не удалось загрузить доску", "Could not load the board"),
      );
    }
  }, [space, dt]);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload, reloadKey]);

  const cycles = useMemo(() => data?.cycles.map((c) => c.cycle) ?? [], [data]);
  const planById = useMemo(() => {
    const m = new Map<string, BoardPlanTask>();
    for (const g of data?.plan.groups ?? []) {
      for (const t of g.tasks) m.set(t.id, t);
    }
    return m;
  }, [data]);

  const namesFor = useCallback(
    (taskId: string | null, fallback: readonly string[]): string[] => {
      const t = taskId ? planById.get(taskId) : undefined;
      return t
        ? namesOf(t.assignees, t.assignee_telegram_ids, users)
        : [...fallback];
    },
    [planById, users],
  );

  const people = useMemo(() => {
    const names = new Set<string>();
    for (const t of planById.values()) {
      for (const n of namesFor(t.id, t.assignees)) {
        names.add(n);
      }
    }
    for (const c of data?.cycles ?? []) {
      for (const i of c.items) {
        for (const n of namesFor(i.task_id, i.assignees)) names.add(n);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [data, planById, namesFor]);

  // Что просит внимания: считаем задачу один раз, даже если она и в плане, и в спринте.
  const attentionCount = useMemo(() => {
    const keys = new Set<string>();
    for (const t of planById.values()) {
      if (planTaskNeedsAttention(t)) keys.add(`t:${t.id}`);
    }
    for (const c of data?.cycles ?? []) {
      for (const i of c.items) {
        if (itemNeedsAttention(i)) keys.add(`t:${i.task_id ?? i.id}`);
      }
      for (const i of c.moved) {
        if (snapshotNeedsReason(i)) keys.add(`s:${i.id}`);
      }
    }
    return keys.size;
  }, [data, planById]);

  /** Действие с сервером: занято на время, ошибка — вслух, потом доска и остальной экран перечитываются. */
  const run = useCallback(
    async (fn: () => Promise<unknown>, failed: string) => {
      setBusy(true);
      try {
        await fn();
        setErr(null);
        await reload();
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : failed);
        await reload();
      } finally {
        setBusy(false);
      }
    },
    [reload, onChanged],
  );

  const isClosed = (t: BoardPlanTask) => isClosedStatus(t.status);

  const kidsMap = useMemo(() => {
    const m = new Map<string, BoardPlanTask[]>();
    for (const t of planById.values()) {
      if (!t.parent_id) continue;
      m.set(t.parent_id, [...(m.get(t.parent_id) ?? []), t]);
    }
    return m;
  }, [planById]);
  const kidsOf = useCallback(
    (taskId: string): readonly BoardPlanTask[] => kidsMap.get(taskId) ?? [],
    [kidsMap],
  );
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data?.plan.groups ?? []) {
      for (const t of g.tasks) m.set(t.id, g.id);
    }
    return m;
  }, [data]);

  /** Задача для ядра группировки (lib/sprintGrouping.ts); `null` — её нет в мастер-плане. */
  const rowInfo = useCallback((taskId: string): RowInfo | null => {
    const t = planById.get(taskId);
    if (!t) return null;
    return {
      taskId,
      title: t.title,
      projectId: groupOf.get(taskId) ?? null,
      parentId: t.parent_id,
      hasKids: kidsOf(taskId).length > 0,
      isSubtask: t.parent_id !== null,
    };
  }, [planById, groupOf, kidsOf]);

  /** Подзадачи колонки родителя: живые незакрытые строки того же спринта. */
  const kidItems = useCallback(
    (taskId: string, cycleId: string): SprintCycleItem[] => {
      const ids = new Set(kidsOf(taskId).map((k) => k.id));
      const entry = data?.cycles.find((c) => c.cycle.id === cycleId);
      return (entry?.items ?? []).filter((i) =>
        !!i.task_id && ids.has(i.task_id) && !i.moved && !i.removed &&
        !isClosedStatus(i.status)
      );
    },
    [data, kidsOf],
  );

  // Взять из мастер-плана: подзадачи колонки едут с родителем — открытые и ещё не стоящие ни в
  // одном незакрытом спринте (те, что уже запланированы, не трогаем).
  const take = useCallback(
    (taskId: string, target: SprintCycle) =>
      run(async () => {
        const kids = kidsOf(taskId).filter((k) =>
          !isClosed(k) && !k.cycle_ids.some((id) =>
            cycles.find((c) => c.id === id)?.status !== "accepted"
          )
        ).map((k) => k.id);
        const added = await addTasksToSprintCycle(target.id, [taskId, ...kids]);
        if (added < 1) {
          throw new Error(
            dt(
              "Задача не добавлена: она уже в этом спринте или недоступна",
              "The task was not added: it is already in this sprint or unavailable",
            ),
          );
        }
      }, dt("Не удалось взять в спринт", "Could not take into the sprint")),
    [run, dt, kidsOf, cycles],
  );

  // Между запланированными — без причины (планирование, а не срыв): снять в одном, взять в другом.
  // Не взялось в цель — возвращаем в прежний, чтобы задача не пропала из плана. Подзадачи колонки
  // переезжают за родителем.
  const shift = useCallback(
    (taskId: string, fromCycleId: string, target: SprintCycle) =>
      run(
        async () => {
          const failed = dt(
            "Не удалось переставить — задача осталась на месте",
            "Could not shift — the task stayed where it was",
          );
          await shiftBetweenDrafts(taskId, fromCycleId, target.id, failed);
          for (const k of kidItems(taskId, fromCycleId)) {
            await shiftBetweenDrafts(
              k.task_id!,
              fromCycleId,
              target.id,
              failed,
            );
          }
        },
        dt("Не удалось переставить", "Could not shift"),
      ),
    [run, dt, kidItems],
  );

  const afterDialog = useCallback(async () => {
    await reload();
    onChanged();
  }, [reload, onChanged]);

  const taskDialogs = useTaskDialogs({
    cycles,
    onDone: afterDialog,
    onPlace: (mode, taskId, fromCycleId, target) => {
      if (mode === "take") void take(taskId, target);
      else if (fromCycleId) void shift(taskId, fromCycleId, target);
    },
  });

  // ── Связывание: действия и «Отменить» ──────────────────────────────────────────────────────
  // Ядро (useDragGroups → resolveDrop) решает и выполняет бросок; перед выполнением доска
  // запоминает прежнее состояние затронутых задач — отмена возвращает parent_id и группу.
  const showUndo = useCallback((next: Undo) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(next);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }, []);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const groupProjects = useMemo(
    () =>
      (data?.plan.groups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        parent_id: null,
        sprint_group: true,
      })) as unknown as Project[],
    [data],
  );
  // ядру нужны id, parent_id, project_id и название — всё это есть в мастер-плане
  const planTasks = useMemo(
    () =>
      [...planById.values()].map((t) => ({
        id: t.id,
        title: t.title,
        parent_id: t.parent_id,
        project_id: groupOf.get(t.id) ?? null,
      })) as unknown as Task[],
    [planById, groupOf],
  );

  const onResolved = useCallback(
    (dragged: RowInfo, action: ResolvedDrop) => {
      if (action.kind !== "subtask" && action.kind !== "move") return;
      const ids = [
        dragged.taskId,
        ...(action.kind === "move"
          ? kidsOf(dragged.taskId).map((k) => k.id)
          : []),
      ];
      const before = ids.flatMap((id) => {
        const t = planById.get(id);
        return t
          ? [{
            id,
            parent_id: t.parent_id,
            project_id: groupOf.get(id) ?? null,
          }]
          : [];
      });
      const title = dragged.title;
      const message = action.kind === "subtask"
        ? dt(
          `«${title}» теперь подзадача «${
            planById.get(action.parentTaskId)?.title ?? ""
          }»`,
          `“${title}” is now a subtask of “${
            planById.get(action.parentTaskId)?.title ?? ""
          }”`,
        )
        : dragged.parentId
        ? dt(
          `«${title}» отвязана от «${
            planById.get(dragged.parentId)?.title ?? ""
          }»`,
          `“${title}” unlinked from “${
            planById.get(dragged.parentId)?.title ?? ""
          }”`,
        )
        : dt(
          `«${title}» перенесена в группу «${
            data?.plan.groups.find((g) => g.id === action.projectId)?.name ?? ""
          }»`,
          `“${title}” moved to the group “${
            data?.plan.groups.find((g) => g.id === action.projectId)?.name ?? ""
          }”`,
        );
      showUndo({
        message,
        restore: async () => {
          for (const b of before) {
            await updateTask(b.id, {
              parent_id: b.parent_id,
              project_id: b.project_id,
            });
          }
        },
      });
    },
    [planById, groupOf, kidsOf, data, dt, showUndo],
  );

  const { grouping, dialogs: groupDialogs } = useDragGroups({
    projects: groupProjects,
    tasks: planTasks,
    space,
    reload: afterDialog,
    onError: setErr,
    onResolved,
  });

  const dnd = useBoardDnd({
    canDrag,
    data,
    cycles,
    ctxPlan: { rowInfo, projects: groupProjects },
    onDropCard: grouping.onDrop,
    onTake: (taskId, target) => void take(taskId, target),
    onShift: (taskId, from, target) => void shift(taskId, from, target),
    onMove: (item, from, target) =>
      taskDialogs.openMove(
        item,
        from,
        kidItems(item.task_id ?? "", from),
        target.id,
      ),
  });

  const ctx: BoardCtx = {
    users,
    cycles,
    planById,
    kidsOf,
    filter,
    namesFor,
    openTask: onOpenTask,
    toggleDone: (taskId, status) => {
      void run(
        () =>
          updateTask(taskId, {
            status: isClosedStatus(status) ? "open" : "done",
          }),
        dt("Не удалось отметить", "Could not mark"),
      );
    },
    menuActions: (taskId, item, cycleId): TaskMenuActions => {
      const plan = planById.get(taskId);
      const info = rowInfo(taskId);
      const ref = {
        id: taskId,
        title: item?.title ?? plan?.title ?? "",
        due: item?.due_date ?? plan?.due_date ?? null,
      };
      const parent = plan?.parent_id ? planById.get(plan.parent_id) : undefined;
      return {
        open: () => onOpenTask(taskId),
        check: (status) => {
          if (!cycleId) return;
          void run(
            () =>
              patchSprintCycleItem(cycleId, taskId, {
                check_status: status,
                ...(status === null ? { check_note: null } : {}),
              }),
            dt("Не удалось отметить", "Could not mark"),
          );
        },
        move: () =>
          item && cycleId &&
          taskDialogs.openMove(item, cycleId, kidItems(taskId, cycleId)),
        place: (mode) =>
          taskDialogs.openPlace(mode, ref, plan?.cycle_ids ?? [], cycleId),
        span: () =>
          taskDialogs.openSpan(
            ref,
            plan?.cycle_ids.filter((id) =>
              cycles.find((c) => c.id === id)?.status !== "accepted"
            ),
          ),
        journey: () => taskDialogs.openJourney(ref),
        remove: () => {
          if (!cycleId) return;
          void run(
            () => removeTaskFromSprintCycle(cycleId, taskId),
            dt("Не удалось убрать", "Could not remove"),
          );
        },
        group: info
          ? () =>
            grouping.onMenu(
              info,
              [...planById.keys()].flatMap((id) => {
                const r = rowInfo(id);
                return r ? [r] : [];
              }),
            )
          : undefined,
        unlink: info && parent
          ? {
            parentTitle: parent.title,
            run: () =>
              grouping.onDrop(
                info,
                { kind: "header", projectId: info.projectId },
                "group",
              ),
          }
          : undefined,
      };
    },
    addReason: (cycleId, item) => setReasonFor({ item, cycleId }),
    ...dnd.ctxPart,
  };

  const isDesktop = useIsDesktop();

  if (!data) {
    return (
      <p
        className="px-5 py-10 text-center text-sm text-ink-soft/70"
        role={loadErr ? "alert" : "status"}
      >
        {loadErr ?? dt("Загрузка доски…", "Loading the board…")}
      </p>
    );
  }

  // Мастер-план на компьютере стоит рядом с полосой колонок, а не внутри неё: колонки при прокрутке
  // обрезаются у её края, и скруглённые углы плана ничем не перекрыты.
  const masterPlan = (
    <MasterPlanColumn
      groups={data.plan.groups}
      cycles={cycles}
      ctx={ctx}
      hideDone={hideDone}
      onHideDone={setHideDone}
      onAddTask={(groupId) => onAddTask(groupId)}
    />
  );

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="sprint-board"
    >
      <BoardFilters
        value={filter}
        onChange={setFilter}
        people={people}
        attentionCount={attentionCount}
        onHistory={() => setHistory(true)}
      />
      {(err || loadErr) && (
        <p className="mx-4 mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive lg:mx-5">
          {err ?? loadErr}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        {isDesktop && masterPlan}
        <div
          data-testid="board-scroll"
          className="flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden pb-3 lg:snap-none"
        >
          {!isDesktop && masterPlan}
          {
            /* Принятые спринты в ряду не показываем: вход к ним — «История спринтов». */
          }
          {data.cycles.filter((entry) => entry.cycle.status !== "accepted").map(
            (
              entry,
            ) => (
              <SprintColumn
                key={entry.cycle.id}
                entry={entry}
                ctx={ctx}
                busy={busy}
                onCloseSprint={onCloseSprint}
                onAddTask={(groupId) => onAddTask(groupId, entry.cycle.id)}
                drop={{
                  valid: dnd.canDrop(entry.cycle),
                  over: dnd.overId === entry.cycle.id,
                  handlers: dnd.dropHandlers(entry.cycle),
                }}
              />
            ),
          )}
          <NewSprint
            cycles={cycles}
            space={space}
            busy={busy}
            onCreate={(input) =>
              void run(
                () => createSprintCycle(input),
                dt("Не удалось создать спринт", "Could not create the sprint"),
              )}
          />
        </div>
      </div>

      {taskDialogs.node}
      {groupDialogs}
      {dnd.hint}
      {undo && (
        <div
          role="status"
          data-testid="undo-bar"
          className="pointer-events-auto absolute bottom-4 left-1/2 z-[110] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-[var(--popover)] py-1.5 pl-4 pr-2 shadow-lg"
          style={{ fontSize: 13 }}
        >
          <span className="min-w-0 truncate text-ink">{undo.message}</span>
          <button
            type="button"
            onClick={() => {
              const u = undo;
              setUndo(null);
              void run(u.restore, dt("Не удалось отменить", "Could not undo"));
            }}
            className="shrink-0 rounded-full px-3 py-1 font-semibold text-accent-ink hover:bg-accent-soft"
          >
            {dt("Отменить", "Undo")}
          </button>
        </div>
      )}
      <ReasonDialog
        item={reasonFor?.item ?? null}
        cycleId={reasonFor?.cycleId ?? ""}
        onClose={() => setReasonFor(null)}
        onDone={async () => {
          await reload();
          onChanged();
        }}
      />
      <HistoryDialog
        open={history}
        cycles={cycles}
        ctx={ctx}
        onClose={() => setHistory(false)}
      />
    </div>
  );
}
