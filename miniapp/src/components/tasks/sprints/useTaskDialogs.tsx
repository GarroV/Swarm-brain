"use client";
import { useMemo, useState } from "react";
import type { SprintCycle, SprintCycleItem } from "@/types";
import { MoveDialog } from "./MoveDialog";
import { TargetDialog } from "./TargetDialog";
import { SpanDialog } from "./SpanDialog";
import { JourneyDialog } from "./JourneyDialog";

// Окна, которые открывает меню «⋯» (перенос, «взять / переставить», «Спринты задачи…», «Ход
// задачи»), — в одном месте, чтобы «Список» и доска не расходились: у обоих одно меню, значит и
// окна одни. Хозяин даёт только спринты пространства и то, что делать после (перечитать данные,
// взять / переставить).

type TaskRef = { id: string; title: string; due: string | null };

type Dialog =
  | {
    kind: "move";
    item: SprintCycleItem;
    cycleId: string;
    kids: SprintCycleItem[];
    targetId: string | null;
  }
  | {
    kind: "place";
    mode: "take" | "shift";
    task: TaskRef;
    /** Спринт, из которого переставляют (shift). */
    fromCycleId?: string;
    /** Спринты, где задача уже живёт: туда её брать не нужно. */
    liveIn: readonly string[];
  }
  | { kind: "span"; task: TaskRef; current?: readonly string[] }
  | { kind: "journey"; task: TaskRef };

export function useTaskDialogs(
  { cycles, onDone, onPlace }: {
    /** Все спринты пространства. */
    cycles: readonly SprintCycle[];
    /** Окно что-то изменило: перечитать данные. */
    onDone: () => void | Promise<void>;
    onPlace: (
      mode: "take" | "shift",
      taskId: string,
      fromCycleId: string | undefined,
      target: SprintCycle,
    ) => void;
  },
) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const planned = useMemo(
    () =>
      cycles.filter((c) => c.status === "draft")
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [cycles],
  );

  const placeCycles = dialog?.kind === "place"
    ? dialog.mode === "take"
      ? cycles.filter((c) =>
        c.status !== "accepted" && !dialog.liveIn.includes(c.id)
      )
      : planned.filter((c) => c.id !== dialog.fromCycleId)
    : [];

  const node = (
    <>
      <MoveDialog
        item={dialog?.kind === "move" ? dialog.item : null}
        cycleId={dialog?.kind === "move" ? dialog.cycleId : ""}
        cycles={planned}
        kids={dialog?.kind === "move" ? dialog.kids : []}
        initialTargetId={dialog?.kind === "move" ? dialog.targetId : null}
        onClose={close}
        onDone={onDone}
      />
      <TargetDialog
        mode={dialog?.kind === "place" ? dialog.mode : null}
        title={dialog?.kind === "place" ? dialog.task.title : ""}
        due={dialog?.kind === "place" ? dialog.task.due : null}
        cycles={placeCycles}
        onClose={close}
        onPick={(target) => {
          if (dialog?.kind !== "place") return;
          const { mode, task, fromCycleId } = dialog;
          close();
          onPlace(mode, task.id, fromCycleId, target);
        }}
      />
      <SpanDialog
        task={dialog?.kind === "span" ? dialog.task : null}
        cycles={cycles}
        current={dialog?.kind === "span" ? dialog.current : undefined}
        onClose={close}
        onDone={onDone}
      />
      <JourneyDialog
        task={dialog?.kind === "journey" ? dialog.task : null}
        onClose={close}
      />
    </>
  );

  return {
    node,
    openMove: (
      item: SprintCycleItem,
      cycleId: string,
      kids: SprintCycleItem[] = [],
      targetId: string | null = null,
    ) => setDialog({ kind: "move", item, cycleId, kids, targetId }),
    openPlace: (
      mode: "take" | "shift",
      task: TaskRef,
      liveIn: readonly string[],
      fromCycleId?: string,
    ) => setDialog({ kind: "place", mode, task, liveIn, fromCycleId }),
    openSpan: (task: TaskRef, current?: readonly string[]) =>
      setDialog({ kind: "span", task, current }),
    openJourney: (task: TaskRef) => setDialog({ kind: "journey", task }),
  };
}
