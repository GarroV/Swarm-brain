"use client";
import { type DragEvent, useCallback, useEffect, useState } from "react";
import type { SprintBoardData, SprintCycle, SprintCycleItem } from "@/types";
import {
  type DraggedTask,
  type DropTarget,
  type GroupingProject,
  type HoverMode,
  hoverMode,
  resolveDrop,
  type SubtaskBlock,
  subtaskBlock,
} from "@/lib/sprintGrouping";
import { useDt } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import {
  type BoardCtx,
  type CardDnd,
  type DragHandlers,
  type DragPayload,
  PLAN_COL,
  type UnlinkZone,
} from "./boardCtx";
import type { RowInfo } from "../useRowDrag";

// Перетаскивание на доске (нативный HTML5-DnD, как раньше) плюс подзадачи и группы — решение
// владельца 22.10.2026, п.15. Правила «что сделает бросок» не здесь: их даёт ядро
// lib/sprintGrouping.ts (`resolveDrop`, `subtaskBlock`, `hoverMode`), те же, что в «Списке».
// Здесь жест: над какой карточкой держат, сколько, куда бросили.
//
//  * внутри одной колонки (и в мастер-плане): бросок на карточку сразу — группа; подержали 0,7 с —
//    подзадача (зелёная рамка и силуэт «↳ Название»); нельзя — красная рамка и причина;
//  * в другую колонку — только действие со спринтом (взять / переставить / перенести с причиной),
//    подзадачу между колонками не делаем;
//  * подзадачу тащат — внизу её колонки зона «Отвязать от «…»»;
//  * у краёв колонок во время перетаскивания идёт автопрокрутка.

const EDGE = 56;
const SPEED = 16;

type Hover = { taskId: string; colKey: string; since: number };

export function useBoardDnd(
  { canDrag, data, cycles, ctxPlan, onDropCard, onTake, onShift, onMove }: {
    canDrag: boolean;
    data: SprintBoardData | null;
    cycles: readonly SprintCycle[];
    ctxPlan: {
      /** Строка задачи для ядра группировки; `null` — задачи нет в плане (группировке не подлежит). */
      rowInfo: (taskId: string) => RowInfo | null;
      projects: readonly GroupingProject[];
    };
    /** Бросок карточки на карточку той же колонки решён: отдаём ядру (`useDragGroups.onDrop`). */
    onDropCard: (dragged: RowInfo, target: DropTarget, mode: HoverMode) => void;
    onTake: (taskId: string, target: SprintCycle) => void;
    onShift: (taskId: string, fromCycleId: string, target: SprintCycle) => void;
    onMove: (
      item: SprintCycleItem,
      fromCycleId: string,
      target: SprintCycle,
    ) => void;
  },
) {
  const dt = useDt();
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [unlinkOver, setUnlinkOver] = useState<string | null>(null);

  const dragCol = dragging
    ? dragging.kind === "plan" ? PLAN_COL : dragging.fromCycleId
    : null;

  /** Можно ли бросить несомую карточку в этот спринт: те же правила, что в меню «⋯». */
  const canDrop = useCallback((c: SprintCycle): boolean => {
    if (!dragging || c.status === "accepted") return false;
    if (dragging.kind === "plan") {
      const t = data?.plan.groups.flatMap((g) => g.tasks).find((x) =>
        x.id === dragging.taskId
      );
      return !t?.cycle_ids.includes(c.id);
    }
    const from = cycles.find((x) => x.id === dragging.fromCycleId);
    return c.id !== dragging.fromCycleId && c.status === "draft" && !!from &&
      from.status !== "accepted";
  }, [dragging, data, cycles]);

  // Таймер «подержали» — только пока над целью той же колонки: тикает ради рамки, решение при
  // броске считается по часам заново (hoverMode), поэтому лишний тик ничего не ломает.
  useEffect(() => {
    if (!hover) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [hover]);

  // Автопрокрутка: у левого/правого края полосы колонок и у верха/низа колонки под курсором.
  useEffect(() => {
    if (!dragging) return;
    const onOver = (e: globalThis.DragEvent) => {
      setPointer({ x: e.clientX, y: e.clientY });
      const strip = document.querySelector<HTMLElement>(
        "[data-testid=board-scroll]",
      );
      if (strip) {
        const r = strip.getBoundingClientRect();
        if (e.clientX > r.right - EDGE) strip.scrollLeft += SPEED;
        else if (e.clientX < r.left + EDGE) strip.scrollLeft -= SPEED;
      }
      const col =
        (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)
          ?.closest<HTMLElement>("[data-board-scroll]");
      if (col) {
        const r = col.getBoundingClientRect();
        if (e.clientY > r.bottom - EDGE) col.scrollTop += SPEED;
        else if (e.clientY < r.top + EDGE) col.scrollTop -= SPEED;
      }
    };
    document.addEventListener("dragover", onOver);
    return () => document.removeEventListener("dragover", onOver);
  }, [dragging]);

  const dragEnd = useCallback(() => {
    setDragging(null);
    setOverId(null);
    setHover(null);
    setPointer(null);
    setUnlinkOver(null);
  }, []);

  const dragStart = useCallback(
    (payload: DragPayload) => (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", payload.taskId);
      setDragging(payload);
    },
    [],
  );

  const draggedInfo = dragging ? ctxPlan.rowInfo(dragging.taskId) : null;

  const targetOf = (taskId: string): DropTarget | null => {
    const info = ctxPlan.rowInfo(taskId);
    return info
      ? {
        kind: "task",
        taskId,
        projectId: info.projectId,
        isSubtask: info.isSubtask,
      }
      : null;
  };

  const cardDnd = (
    taskId: string | null,
    colKey: string,
  ): CardDnd | undefined => {
    if (!canDrag || !dragging || !taskId || taskId === dragging.taskId) {
      return undefined;
    }
    const target = targetOf(taskId);
    if (!target || !draggedInfo) return undefined;
    const same = dragCol === colKey;
    const isHover = hover?.taskId === taskId && hover.colKey === colKey;
    const mode: HoverMode = isHover && same
      ? hoverMode(hover.since, now)
      : "group";
    const columnAccepts = colKey !== PLAN_COL &&
      canDrop(cycles.find((c) => c.id === colKey)!);
    let state: CardDnd["state"] = null;
    if (isHover) {
      if (!same) state = columnAccepts ? "cross" : null;
      else if (
        subtaskBlock(
          draggedInfo,
          target as Extract<DropTarget, { kind: "task" }>,
        )
      ) state = "block";
      else state = mode === "subtask" ? "sub" : "group";
    }
    const enter = () => {
      if (!isHover) setHover({ taskId, colKey, since: Date.now() });
    };
    const handlers: DragHandlers = {
      onDragOver: (e) => {
        enter();
        // Чужая колонка: решает колонка (взять / переставить / перенести), карточка лишь подсказывает.
        if (!same) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHover((cur) =>
          cur?.taskId === taskId && cur.colKey === colKey ? null : cur
        );
      },
      onDrop: (e) => {
        if (!same) return;
        e.preventDefault();
        e.stopPropagation();
        const m = hover?.taskId === taskId && hover.colKey === colKey
          ? hoverMode(hover.since, Date.now())
          : "group";
        const dragged = draggedInfo;
        dragEnd();
        onDropCard(dragged, target, m);
      },
    };
    return {
      handlers,
      state,
      silhouette: state === "sub" ? draggedInfo.title : null,
    };
  };

  const unlink = useCallback(() => {
    const info = draggedInfo;
    dragEnd();
    if (!info || info.parentId === null) return;
    // Бросок подзадачи на заголовок её группы — вытащить обратно (ядро: resolveDrop, #807).
    onDropCard(info, { kind: "header", projectId: info.projectId }, "group");
  }, [draggedInfo, dragEnd, onDropCard]);

  const unlinkZone = (colKey: string): UnlinkZone | null => {
    if (
      !canDrag || !dragging || !draggedInfo || draggedInfo.parentId === null ||
      dragCol !== colKey
    ) return null;
    const parent = ctxPlan.rowInfo(draggedInfo.parentId);
    return {
      parentTitle: parent?.title ?? "",
      over: unlinkOver === colKey,
      handlers: {
        onDragOver: (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          if (unlinkOver !== colKey) setUnlinkOver(colKey);
        },
        onDragLeave: () =>
          setUnlinkOver((cur) => (cur === colKey ? null : cur)),
        onDrop: (e) => {
          e.preventDefault();
          e.stopPropagation();
          unlink();
        },
      },
    };
  };

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
        dragEnd();
        if (payload.kind === "plan") {
          onTake(payload.taskId, c);
          return;
        }
        const from = cycles.find((x) => x.id === payload.fromCycleId);
        if (from?.status === "active") {
          const item = data?.cycles.find((x) => x.cycle.id === from.id)?.items
            .find((i) => i.id === payload.itemId);
          if (item) onMove(item, from.id, c);
        } else {
          onShift(payload.taskId, payload.fromCycleId, c);
        }
      },
    };
  }

  // Подсказка у курсора: что случится, если отпустить сейчас.
  const hintText =
    ((): { text: string; tone: "info" | "ok" | "bad" } | null => {
      if (!dragging || !draggedInfo) return null;
      if (unlinkOver) {
        return {
          text: dt("Отпустите — отвязать", "Release to unlink"),
          tone: "info",
        };
      }
      if (!hover) return null;
      const target = targetOf(hover.taskId);
      const tInfo = ctxPlan.rowInfo(hover.taskId);
      if (!target || !tInfo) return null;
      const same = dragCol === hover.colKey;
      if (!same) {
        const c = cycles.find((x) => x.id === hover.colKey);
        return c && canDrop(c)
          ? {
            text: dt(
              `Бросить — в «${c.name}» (спринтом). Подзадачу между колонками не делаем.`,
              `Drop — into “${c.name}” (as a sprint action). Subtasks are not made across columns.`,
            ),
            tone: "info",
          }
          : null;
      }
      const block = subtaskBlock(
        draggedInfo,
        target as Extract<DropTarget, { kind: "task" }>,
      );
      const group = resolveDrop(draggedInfo, target, "group", ctxPlan.projects);
      const groupText = group.kind === "none" ? "" : dt(
        `Бросить — в группу с «${tInfo.title}». `,
        `Drop — into a group with “${tInfo.title}”. `,
      );
      if (block) {
        return {
          text: dt(
            `Подзадачей нельзя: ${blockText(block, draggedInfo, tInfo, true)}.${
              groupText ? ` ${groupText}` : ""
            }`,
            `Cannot be a subtask: ${
              blockText(block, draggedInfo, tInfo, false)
            }.${groupText ? ` ${groupText}` : ""}`,
          ).trim(),
          tone: "bad",
        };
      }
      if (hoverMode(hover.since, now) === "subtask") {
        return {
          text: dt(
            `Отпустите — станет подзадачей «${tInfo.title}»`,
            `Release — it becomes a subtask of “${tInfo.title}”`,
          ),
          tone: "ok",
        };
      }
      return {
        text: `${groupText}${dt("Подержите — подзадача.", "Hold — subtask.")}`,
        tone: "info",
      };
    })();

  const hint = hintText && pointer
    ? (
      <div
        role="status"
        data-testid="dnd-hint"
        className={cn(
          "pointer-events-none fixed z-[120] max-w-[280px] rounded-[8px] border bg-[var(--popover)] px-2.5 py-1.5 shadow-lg",
          hintText.tone === "bad" && "border-pri-high text-pri-high",
          hintText.tone === "ok" && "border-status-done text-status-done",
          hintText.tone === "info" && "border-primary/50 text-ink",
        )}
        style={{
          left: Math.min(pointer.x + 14, innerWidth - 296),
          top: pointer.y + 16,
          fontSize: 12.5,
        }}
      >
        {hintText.text}
      </div>
    )
    : null;

  const ctxPart: Pick<
    BoardCtx,
    "dragging" | "dragStart" | "dragEnd" | "canDrag" | "cardDnd" | "unlinkZone"
  > = { dragging, dragStart, dragEnd, canDrag, cardDnd, unlinkZone };

  return { ctxPart, canDrop, dropHandlers, overId, hint, dragging };
}

function blockText(
  block: SubtaskBlock,
  dragged: DraggedTask & { title: string },
  target: { title: string },
  ru: boolean,
): string {
  switch (block) {
    case "target-subtask":
      return ru
        ? `«${target.title}» сама подзадача — вложенность одна`
        : `“${target.title}” is itself a subtask — one level only`;
    case "has-kids":
      return ru
        ? `у «${dragged.title}» свои подзадачи — вложенность одна`
        : `“${dragged.title}” has its own subtasks — one level only`;
    case "already":
      return ru ? "уже её подзадача" : "already its subtask";
    default:
      return ru ? "это та же задача" : "it is the same task";
  }
}
