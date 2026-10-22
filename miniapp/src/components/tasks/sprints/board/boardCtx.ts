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

/** Ключ колонки мастер-плана для перетаскивания; у колонки спринта ключ — id спринта. */
export const PLAN_COL = "plan";

export type DragHandlers = {
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
};

/**
 * Карточка как цель броска (подзадачи и группы перетаскиванием, решение владельца 22.10.2026, п.15).
 * `state` красит рамку: group — бросок сразу даст группу, sub — подержали, станет подзадачей
 * (силуэт под целью), block — подзадачей нельзя (красная), cross — другая колонка, это действие
 * со спринтом.
 */
export type CardDnd = {
  handlers: DragHandlers;
  state: "group" | "sub" | "block" | "cross" | null;
  /** Название тащимой — для силуэта «↳ …» под целью в режиме подзадачи. */
  silhouette: string | null;
};

/** Зона «Отвязать от «…»» внизу колонки, из которой тащат подзадачу. */
export type UnlinkZone = {
  parentTitle: string;
  over: boolean;
  handlers: DragHandlers;
};

/** Всё, что колонкам и карточкам нужно от доски: данные для подписей и действия. */
export type BoardCtx = {
  users: readonly User[];
  /** Все спринты пространства слева направо. */
  cycles: readonly SprintCycle[];
  planById: ReadonlyMap<string, BoardPlanTask>;
  /** Подзадачи задачи мастер-плана (все, независимо от колонки). */
  kidsOf: (taskId: string) => readonly BoardPlanTask[];
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
  /** Карточка как цель броска; `undefined` — ничего не тащат или тащат на телефоне. */
  cardDnd: (taskId: string | null, colKey: string) => CardDnd | undefined;
  /** Зона отвязки колонки или `null`. */
  unlinkZone: (colKey: string) => UnlinkZone | null;
};
