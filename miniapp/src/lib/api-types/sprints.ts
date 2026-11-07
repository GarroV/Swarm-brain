import type { SprintCycle } from "@/types";

// Состав живых спринтов держим ссылками на mockTasks — тогда перетаскивание карточки в канбане
// меняет ту же строку, что видит доска проектов (в проде это и есть одна строка).
/**
 * Строка состава в моках: хранится узко (связь + план), остальное собирается из живой задачи —
 * иначе демо показывало бы копию, разъехавшуюся с задачей. Поля переноса приходится хранить:
 * они принадлежат СОСТАВУ, а не задаче, и у задачи их взять неоткуда.
 */
export type MockItemRow = {
  id: string;
  task_id: string;
  in_plan: boolean;
  carry_count?: number;
  carried_manual?: boolean;
  carry_reason?: string | null;
  frozen?: boolean;
  /** Снимок переноса (22.10.2026): куда ушла строка-цель, кто, когда, срок на момент ухода. */
  moved?: {
    to_row: string | null;
    at: string;
    by: number | null;
    reason: string | null;
    due_before: string | null;
  };
};

/**
 * Итог приёмки. Следующий спринт создаёт САМА приёмка одной транзакцией с переносом хвостов —
 * `next_cycle_id` из старой версии больше не передаётся и сервером игнорируется.
 */
export type AcceptResult = {
  cycle: SprintCycle;
  next: SprintCycle | null;
  frozen: number;
  carried: number;
  carried_manual: number;
  carried_auto: number;
};

export type MockProjectMove = {
  task_id: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};
