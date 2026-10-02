// Строка ленты уведомлений (колокольчик) — тип отдельно от API-клиента, чтобы чистая логика
// (homeNews) и её тесты не тянули в граф браузерный api.ts (issue #383).
import type { MaintenanceNotice } from "./maintenance";

export type SwarmNotification = {
  id: string;
  /** maintenance — плановые работы (заморозка, issue #609): без задачи, содержимое в payload. */
  type: "task_comment" | "task_reminder" | "maintenance";
  task_id: string | null;
  task_title: string;
  comment_id: string | null;
  content: string;
  actor_telegram_id: number | null;
  actor_name: string;
  read_at: string | null;
  created_at: string;
  payload?: MaintenanceNotice;
};
