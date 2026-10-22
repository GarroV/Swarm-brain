import type { DragEvent } from "react";
import type {
  BoardPlanTask,
  SprintCycle,
  SprintCycleItem,
  User,
} from "@/types";
import type { BoardFilter } from "./boardModel";
import type { TaskMenuActions } from "./TaskMenu";

/** Что несут над доской: задача мастер-плана или строка спринта. Нужно, чтобы понять, куда её можно бросить. */
export type DragPayload =
  | { kind: "plan"; taskId: string }
  | { kind: "item"; taskId: string; itemId: string; fromCycleId: string };

/** Всё, что колонкам и карточкам нужно от доски: данные для подписей и действия. */
export type BoardCtx = {
  users: readonly User[];
  /** Все спринты пространства слева направо. */
  cycles: readonly SprintCycle[];
  planById: ReadonlyMap<string, BoardPlanTask>;
  filter: BoardFilter;
  /** Исполнители строки: из плана (с людьми по telegram_id), иначе подписи самой строки. */
  namesFor: (taskId: string | null, fallback: readonly string[]) => string[];
  openTask: (taskId: string) => void;
  toggleDone: (taskId: string, status: string) => void;
  /** `item` и `cycleId` — строка и её спринт, когда меню открыли на карточке спринта. */
  menuActions: (
    taskId: string,
    item?: SprintCycleItem,
    cycleId?: string,
  ) => TaskMenuActions;
  addReason: (cycleId: string, item: SprintCycleItem) => void;
  /** Тащат карточку (только компьютер). */
  dragging: DragPayload | null;
  dragStart: (payload: DragPayload) => (e: DragEvent<HTMLElement>) => void;
  dragEnd: () => void;
  canDrag: boolean;
};
