"use client";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  BoardPlanTask,
  SprintBoardData,
  SprintCycle,
  SprintCycleItem,
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
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import { MoveDialog } from "../MoveDialog";
import { ReasonDialog } from "../ReasonDialog";
import { useStoredFlag } from "../useStoredFlag";
import { shiftBetweenDrafts } from "../shiftTask";
import { BoardFilters } from "./BoardFilters";
import { PastColumn, SprintColumn } from "./BoardColumn";
import type { BoardCtx, DragPayload } from "./boardCtx";
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
// «взять в спринт», сверка, снятие; перетаскивание повторяет пункты меню «⋯».

type Moving = { item: SprintCycleItem; cycleId: string; target: SprintCycle };
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
    onAddTask: (groupId: string) => void;
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
  const [openPast, setOpenPast] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<Moving | null>(null);
  const [reasonFor, setReasonFor] = useState<ReasonFor | null>(null);
  const [history, setHistory] = useState(false);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

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

  const take = useCallback(
    (taskId: string, target: SprintCycle) =>
      run(async () => {
        const added = await addTasksToSprintCycle(target.id, [taskId]);
        if (added < 1) {
          throw new Error(
            dt(
              "Задача не добавлена: она уже в этом спринте или недоступна",
              "The task was not added: it is already in this sprint or unavailable",
            ),
          );
        }
      }, dt("Не удалось взять в спринт", "Could not take into the sprint")),
    [run, dt],
  );

  // Между запланированными — без причины (планирование, а не срыв): снять в одном, взять в другом.
  // Не взялось в цель — возвращаем в прежний, чтобы задача не пропала из плана.
  const shift = useCallback(
    (taskId: string, fromCycleId: string, target: SprintCycle) =>
      run(
        () =>
          shiftBetweenDrafts(
            taskId,
            fromCycleId,
            target.id,
            dt(
              "Не удалось переставить — задача осталась на месте",
              "Could not shift — the task stayed where it was",
            ),
          ),
        dt("Не удалось переставить", "Could not shift"),
      ),
    [run, dt],
  );

  const ctx: BoardCtx = {
    users,
    cycles,
    planById,
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
    menuActions: (taskId, item, cycleId): TaskMenuActions => ({
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
      move: (target) => item && cycleId && setMoving({ item, cycleId, target }),
      shift: (target) => cycleId && void shift(taskId, cycleId, target),
      take: (target) => void take(taskId, target),
      remove: () => {
        if (!cycleId) return;
        void run(
          () => removeTaskFromSprintCycle(cycleId, taskId),
          dt("Не удалось убрать", "Could not remove"),
        );
      },
    }),
    addReason: (cycleId, item) => setReasonFor({ item, cycleId }),
    dragging,
    dragStart: (payload) => (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", payload.taskId);
      setDragging(payload);
    },
    dragEnd: () => {
      setDragging(null);
      setOverId(null);
    },
    canDrag,
  };

  /** Можно ли бросить несомую карточку в этот спринт: те же правила, что в меню «⋯». */
  function canDrop(c: SprintCycle): boolean {
    if (!dragging || c.status === "accepted") return false;
    if (dragging.kind === "plan") {
      return !planById.get(dragging.taskId)?.cycle_ids.includes(c.id);
    }
    const from = cycles.find((x) => x.id === dragging.fromCycleId);
    return c.id !== dragging.fromCycleId && c.status === "draft" && !!from &&
      from.status !== "accepted";
  }

  function dropHandlers(c: SprintCycle) {
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!canDrop(c)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overId !== c.id) setOverId(c.id);
      },
      onDragLeave: () => setOverId((cur) => (cur === c.id ? null : cur)),
      onDrop: (e: DragEvent<HTMLElement>) => {
        if (!dragging || !canDrop(c)) return;
        e.preventDefault();
        const payload = dragging;
        setDragging(null);
        setOverId(null);
        if (payload.kind === "plan") {
          void take(payload.taskId, c);
          return;
        }
        const from = cycles.find((x) => x.id === payload.fromCycleId);
        if (from?.status === "active") {
          const item = data?.cycles.find((x) => x.cycle.id === from.id)?.items
            .find((i) => i.id === payload.itemId);
          if (item) setMoving({ item, cycleId: from.id, target: c });
        } else {
          void shift(payload.taskId, payload.fromCycleId, c);
        }
      },
    };
  }

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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="sprint-board">
      <BoardFilters
        value={filter}
        onChange={setFilter}
        people={people}
        attentionCount={attentionCount}
        onHistory={() =>
          setHistory(true)}
      />
      {(err || loadErr) && (
        <p className="mx-4 mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive lg:mx-5">
          {err ?? loadErr}
        </p>
      )}
      <div
        data-testid="board-scroll"
        className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden pb-3 lg:snap-none"
      >
        <MasterPlanColumn
          groups={data.plan.groups}
          cycles={cycles}
          ctx={ctx}
          hideDone={hideDone}
          onHideDone={setHideDone}
          onAddTask={onAddTask}
        />
        {data.cycles.map((entry) =>
          entry.cycle.status === "accepted"
            ? (
              <PastColumn
                key={entry.cycle.id}
                entry={entry}
                ctx={ctx}
                open={openPast.has(entry.cycle.id)}
                onToggle={() =>
                  setOpenPast((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.cycle.id)) next.delete(entry.cycle.id);
                    else next.add(entry.cycle.id);
                    return next;
                  })}
              />
            )
            : (
              <SprintColumn
                key={entry.cycle.id}
                entry={entry}
                ctx={ctx}
                busy={busy}
                onCloseSprint={onCloseSprint}
                drop={{
                  valid: canDrop(entry.cycle),
                  over: overId === entry.cycle.id,
                  handlers: dropHandlers(entry.cycle),
                }}
              />
            )
        )}
        <NewSprint
          cycles={cycles}
          space={space}
          busy={busy}
          onCreate={(input) =>
            void run(
              () =>
                createSprintCycle(input),
              dt("Не удалось создать спринт", "Could not create the sprint"),
            )}
        />
      </div>

      <MoveDialog
        item={moving?.item ?? null}
        cycleId={moving?.cycleId ?? ""}
        cycles={moving ? [moving.target] : []}
        onClose={() => setMoving(null)}
        onDone={async () => {
          await reload();
          onChanged();
        }}
      />
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
